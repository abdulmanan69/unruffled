/**
 * The undoable lifecycle machine: the write that has not been sent yet.
 *
 * "Deleted · Undo" is normally two unrelated pieces of software. A toast library owns the
 * button and knows nothing about a commit window; a data layer owns the mutation and cannot
 * recall it once sent. The result is the bug everyone has shipped: Undo dismisses the toast
 * and the DELETE already landed.
 *
 * The behaviours that fix it, and which are easy to get subtly wrong by hand:
 *
 * - **The window is a state, not a timer in a component.** Undo is possible in `held` and
 *   impossible in `committing`, so the affordance cannot outlive the request it cancels.
 * - **Navigation does not lose the write.** The flush subscription is an effect of `held`,
 *   so it exists exactly while there is something to lose. The port reports whether it can
 *   actually fire, and UX1007 fires when it cannot, rather than the library assuming a
 *   subscription means a flush.
 * - **Unmounting does not lose the write.** Disposing the in-flight commit does not abort
 *   it. A request on the wire is a write the user is owed, so it is left to land.
 * - **Repeats merge.** Five deletes sharing a coalesce tag are one entry with a count and
 *   one restarted window, not five toasts racing each other.
 * - **Two entries on one key never interleave.** A second, non-merging schedule flushes what
 *   is held and queues itself behind it, so one resource is never written twice at once.
 * - **Undo never sends.** `rollback` runs inside the undo transition, and the commit effect
 *   belongs to a state that transition does not enter.
 */

import { createMachine, type MachineDefinition } from "../../machine.js";
import { diagnostics } from "../../diagnostics.js";
import { globalKeyRegistry, type KeyRegistry } from "../../shared/keyRegistry.js";
import { normalizeError, type NormalizeOptions } from "../../shared/normalizeError.js";
import {
  COMMITTED_RESET_MS,
  DEFAULT_FLUSH_ON,
  DEFAULT_UNDO_WINDOW_MS,
  type FlushTrigger,
  type UndoableContext,
  type UndoableEvent,
  type UndoableProps,
  type UndoableStateValue,
} from "./types.js";

const MACHINE_ID = "undoable";

const windowOf = <T>(props: UndoableProps<T>): number => props.windowMs ?? DEFAULT_UNDO_WINDOW_MS;

const registryOf = <T>(props: UndoableProps<T>): KeyRegistry => props.registry ?? globalKeyRegistry;

const flushTriggersOf = <T>(props: UndoableProps<T>): readonly FlushTrigger[] =>
  props.flushOn ?? DEFAULT_FLUSH_ON;

/**
 * Builds normalisation options without writing `undefined` into optional fields, which
 * `exactOptionalPropertyTypes` correctly rejects.
 */
function normalizeOptions<T>(props: UndoableProps<T>, nowMs: number): NormalizeOptions {
  const online = props.online?.();
  return {
    nowMs,
    ...(online === undefined ? {} : { online }),
    ...(props.classify === undefined ? {} : { classify: props.classify }),
    ...(props.messages === undefined ? {} : { messages: props.messages }),
  };
}

export function createUndoableMachine<T>(): MachineDefinition<
  UndoableContext<T>,
  UndoableProps<T>,
  UndoableEvent<T>,
  UndoableStateValue
> {
  return createMachine<UndoableContext<T>, UndoableProps<T>, UndoableEvent<T>, UndoableStateValue>({
    id: MACHINE_ID,
    initial: "idle",

    context: () => ({
      items: [],
      tag: null,
      queued: [],
      expiresAt: null,
      failure: null,
      release: null,
    }),

    states: {
      idle: {
        on: {
          SCHEDULE: {
            target: "held",
            actions: ["acquireKey", "openWindow", "announceScheduled", "reportUnflushable"],
          },
        },
      },

      /**
       * The window is open and nothing has been sent. This is the only state in which undo
       * exists, which is what makes the affordance honest.
       */
      held: {
        tags: ["held", "reversible"],
        effects: ["windowTimer", "leaveWatch"],
        on: {
          SCHEDULE: [
            // A repeat: append and restart. Deliberately a self-transition, so the entry
            // keeps its identity and the open subscriptions are not torn down and rebuilt
            // once per keypress during a burst.
            { guard: "sharesTag", actions: ["mergeItem", "announceScheduled"] },
            // Anything else would be a second entry on the same key. Flush what is held and
            // queue the newcomer behind it: two writes to one resource that overlap land in
            // whatever order the network decides.
            { target: "committing", actions: ["queueItem", "beginCommit"] },
          ],
          UNDO: {
            target: "idle",
            actions: ["rollbackItems", "releaseKey", "announceUndone", "notifyUndone", "clearEntry"],
          },
          EXPIRE: { target: "committing", actions: ["beginCommit"] },
          FLUSH: { target: "committing", actions: ["beginCommit"] },
        },
      },

      /**
       * The commit is in flight. Undo is gone, which is the truthful thing to render: there
       * is nothing left to cancel.
       */
      committing: {
        tags: ["busy"],
        effects: ["commitRequest"],
        on: {
          RESOLVE: { target: "committed", actions: ["releaseKey"] },
          REJECT: { target: "failed", actions: ["releaseKey", "recordFailure"] },
          SCHEDULE: { actions: ["queueItem"] },
        },
      },

      committed: {
        tags: ["settled"],
        entry: ["announceCommitted", "notifyCommitted"],
        effects: ["resetTimer"],
        // Whatever was scheduled behind the flush gets its own window as soon as the flush
        // is out of the way. Eventless, because nothing external should have to ask.
        always: {
          guard: "hasQueued",
          target: "held",
          actions: ["acquireKey", "openQueued", "reportUnflushable"],
        },
        on: {
          RESET: { target: "idle", actions: ["clearEntry"] },
          SCHEDULE: {
            target: "held",
            actions: ["acquireKey", "openWindow", "announceScheduled", "reportUnflushable"],
          },
        },
      },

      /**
       * The commit itself failed. The items are kept so a retry sends the same batch, and
       * the normalised failure is exposed so the view can say which write is still owed.
       */
      failed: {
        tags: ["settled", "failed"],
        entry: ["announceFailure", "notifyFailure"],
        on: {
          RETRY: { target: "committing", actions: ["acquireKey", "beginCommit"] },
          // `flush()` is the same request from the consumer's point of view, so it retries
          // rather than being swallowed by a state that happens to have no window open.
          FLUSH: { target: "committing", actions: ["acquireKey", "beginCommit"] },
          SCHEDULE: { actions: ["queueItem"] },
          RESET: { target: "idle", actions: ["clearEntry"] },
        },
      },
    },

    implementations: {
      guards: {
        /** True when the newcomer merges into the open entry rather than starting its own. */
        sharesTag: ({ context, props }) => props.coalesce !== undefined && context.tag === props.coalesce,

        hasQueued: ({ context }) => context.queued.length > 0,
      },

      actions: {
        /**
         * Takes the resource key for the lifetime of the entry.
         *
         * A `null` release means someone else holds it. The window still opens: refusing to
         * schedule would drop a change the user has already been shown as done, which is
         * worse than two holders of one key.
         */
        acquireKey: ({ props, assign }) => {
          if (props.key === undefined) return;
          assign({ release: registryOf(props).acquire(props.key) });
        },

        releaseKey: ({ context, assign }) => {
          context.release?.();
          assign({ release: null });
        },

        openWindow: ({ props, event, ports, assign }) => {
          if (event.type !== "SCHEDULE") return;
          assign({
            items: [event.item],
            tag: props.coalesce ?? null,
            queued: [],
            expiresAt: ports.clock.now() + windowOf(props),
            failure: null,
          });
        },

        /** Opens a window for the items that arrived while the previous batch was flushing. */
        openQueued: ({ context, props, ports, assign }) => {
          assign({
            items: context.queued,
            tag: props.coalesce ?? null,
            queued: [],
            expiresAt: ports.clock.now() + windowOf(props),
            failure: null,
          });
        },

        /**
         * Merges a repeat into the open entry and restarts the window.
         *
         * The window timer re-arms off `expiresAt` rather than being restarted here, so a
         * burst of repeats does not leave a trail of cancelled timers.
         */
        mergeItem: ({ context, props, event, ports, assign }) => {
          if (event.type !== "SCHEDULE") return;
          assign({
            items: [...context.items, event.item],
            expiresAt: ports.clock.now() + windowOf(props),
          });
        },

        queueItem: ({ context, event, assign }) => {
          if (event.type !== "SCHEDULE") return;
          assign({ queued: [...context.queued, event.item] });
        },

        /** Closes the window on the way into flight, so `canUndo` cannot survive the send. */
        beginCommit: ({ assign }) => {
          assign({ expiresAt: null, failure: null });
        },

        clearEntry: ({ assign }) => {
          assign({ items: [], tag: null, queued: [], expiresAt: null, failure: null });
        },

        rollbackItems: ({ context, props }) => {
          props.rollback?.(context.items);
        },

        recordFailure: ({ event, props, ports, assign }) => {
          if (event.type !== "REJECT") return;
          // An abort is not treated as a cancellation here, unlike in the action machine. By
          // this point the user has been told the change happened, so an abandoned commit is
          // still a lost write and has to surface as one.
          assign({ failure: normalizeError(event.error, normalizeOptions(props, ports.clock.now())) });
        },

        announceScheduled: ({ props, ports }) => {
          if (props.announce === false) return;
          const message = props.announce?.scheduled;
          if (message === undefined) return;
          ports.announcer.announce(message, "polite");
        },

        announceUndone: ({ props, ports }) => {
          if (props.announce === false) return;
          const message = props.announce?.undone;
          if (message === undefined) return;
          ports.announcer.announce(message, "polite");
        },

        announceCommitted: ({ props, ports }) => {
          if (props.announce === false) return;
          const message = props.announce?.committed;
          if (message === undefined) return;
          ports.announcer.announce(message, "polite");
        },

        announceFailure: ({ context, props, ports }) => {
          if (props.announce === false) return;
          const message = context.failure?.message;
          if (message === undefined) return;
          // Assertive: the interface has already claimed the change was made, so a user who
          // has moved on still needs to hear that it was not.
          ports.announcer.announce(message, "assertive");
        },

        notifyCommitted: ({ context, props }) => {
          props.onCommitted?.(context.items);
        },

        notifyUndone: ({ context, props }) => {
          props.onUndone?.(context.items);
        },

        notifyFailure: ({ context, props }) => {
          if (context.failure !== null) props.onCommitFailed?.(context.failure);
        },

        /**
         * Reports UX1007 when a window opens that navigation cannot flush.
         *
         * The capability is read from the port rather than inferred: core's fallback
         * navigation port returns a no-op disposer from `onLeave` and never calls the
         * handler, so a subscription is not evidence that a flush will happen. An empty
         * `flushOn` is the deliberate opt-out and stays silent, because a rule that fires on
         * a decision the consumer already made is a rule they will suppress.
         */
        reportUnflushable: ({ props, ports }) => {
          if (!__DEV__) return;
          if (flushTriggersOf(props).length === 0) return;
          if (ports.navigation.flushable()) return;
          diagnostics.report("UX1007", { machine: MACHINE_ID });
        },
      },

      effects: {
        /**
         * Closes the window when it runs out.
         *
         * Re-arms rather than firing blind, because coalescing a repeat pushes `expiresAt`
         * forward without re-entering `held`: this runtime has no re-entrant self-transition,
         * so a timer armed once would commit the batch while the merged window was still
         * open and the user could still see Undo.
         */
        windowTimer: (api) => {
          const state = { live: true, dispose: null as (() => void) | null };

          const arm = (): void => {
            const expiresAt = api.context().expiresAt;
            if (expiresAt === null) return;
            const remaining = expiresAt - api.ports.clock.now();
            if (remaining <= 0) {
              api.send({ type: "EXPIRE" });
              return;
            }
            state.dispose = api.ports.clock.after(remaining, () => {
              if (!state.live) return;
              arm();
            });
          };

          arm();

          return () => {
            state.live = false;
            state.dispose?.();
          };
        },

        /**
         * Flushes the window if the user leaves while it is open.
         *
         * An effect of `held` so the subscription exists exactly while there is a write to
         * lose, and the disposer unsubscribes: a listener that outlived the window would
         * commit a batch that had already been undone.
         */
        leaveWatch: (api) => {
          const triggers = flushTriggersOf(api.props());
          if (triggers.length === 0) return;

          return api.ports.navigation.onLeave((reason) => {
            // "manual" is the host asking outright. `flushOn` says which exits count, not
            // whether a direct request does.
            if (reason !== "manual" && !triggers.includes(reason)) return;
            api.send({ type: "FLUSH" });
          });
        },

        /**
         * Sends the deferred write.
         *
         * No disposer, and that is the decision in this file worth defending. Everywhere else
         * in the library disposal aborts the request; here it must not. The only ways out of
         * `committing` are the request settling and the service being stopped, and stopping
         * means the component unmounted mid-flight. Aborting then would discard a delete the
         * user was told had happened.
         */
        commitRequest: (api) => {
          const props = api.props();
          const items = api.context().items;

          const inFlight = api.ports.transport.run((signal) => props.commit(items, signal));
          inFlight.promise.then(
            () => {
              api.send({ type: "RESOLVE" });
            },
            (error: unknown) => {
              api.send({ type: "REJECT", error });
            },
          );
        },

        /** Returns a committed entry to idle, once it has been readable long enough to see. */
        resetTimer: (api) =>
          api.ports.clock.after(COMMITTED_RESET_MS, () => {
            api.send({ type: "RESET" });
          }),
      },
    },
  });
}
