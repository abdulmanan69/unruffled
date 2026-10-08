/**
 * The action lifecycle machine.
 *
 * This is the primitive the rest of the library is built on, and the one that justifies the
 * library existing. The behaviours encoded here are the ones every team re-derives by hand
 * and gets subtly wrong:
 *
 * - **The duplicate-submit guard is synchronous.** It is taken inside the event handler,
 *   before any await, before any validation. A guard that waits for a pending flag to
 *   propagate through a render leaves a window in which a second click is accepted, and
 *   with a form library that validates asynchronously both clicks clear validation before
 *   either one mutates.
 * - **The guard is keyed by resource, not by component.** Two buttons in two subtrees that
 *   write the same record contend. A boolean on one hook cannot express that.
 * - **A fast action never flashes a spinner, and a shown spinner never flickers.** Those
 *   are two different thresholds (`delay` and `min`) and they need two different states.
 * - **Requests abort.** Unmounting, cancelling or superseding an attempt tears down the
 *   request rather than leaving it to resolve into a dead component.
 * - **Outcomes are announced.** On by default, with the live-region requirement checked
 *   rather than assumed.
 */

import { createMachine, type MachineDefinition } from "../../machine.js";
import { diagnostics } from "../../diagnostics.js";
import { computeBackoff } from "../../shared/backoff.js";
import { globalKeyRegistry, type KeyRegistry } from "../../shared/keyRegistry.js";
import { isAbort, normalizeError, type NormalizeOptions } from "../../shared/normalizeError.js";
import {
  ANNOUNCE_THRESHOLD_MS,
  DEFAULT_PENDING,
  type ActionContext,
  type ActionEvent,
  type ActionProps,
  type ActionStateValue,
  type PendingPolicy,
} from "./types.js";

const MACHINE_ID = "action";

const policyOf = <T, A>(props: ActionProps<T, A>): PendingPolicy => ({
  ...DEFAULT_PENDING,
  ...props.pending,
});

const registryOf = <T, A>(props: ActionProps<T, A>): KeyRegistry => props.registry ?? globalKeyRegistry;

/**
 * Builds normalisation options without writing `undefined` into optional fields, which
 * `exactOptionalPropertyTypes` correctly rejects.
 */
function normalizeOptions<T, A>(props: ActionProps<T, A>, nowMs: number): NormalizeOptions {
  const online = props.online?.();
  return {
    nowMs,
    ...(online === undefined ? {} : { online }),
    ...(props.classify === undefined ? {} : { classify: props.classify }),
    ...(props.messages === undefined ? {} : { messages: props.messages }),
  };
}

/** Milliseconds the pending affordance has been visible, or 0 if it never appeared. */
function visibleFor<T, A>(context: ActionContext<T, A>, nowMs: number): number {
  return context.visibleSince === null ? 0 : nowMs - context.visibleSince;
}

/**
 * Reports UX1003 when a visible pending state outlasted the announcement threshold while no
 * live region was mounted.
 *
 * Checked at settle time rather than on a timer, so the rule fires on the evidence that the
 * wait actually happened instead of on the possibility that it might.
 */
function warnIfUnheard<T, A>(
  context: ActionContext<T, A>,
  props: ActionProps<T, A>,
  live: boolean,
  nowMs: number,
): void {
  if (!__DEV__) return;
  if (props.announce === false || live) return;
  const elapsed = visibleFor(context, nowMs);
  if (elapsed < ANNOUNCE_THRESHOLD_MS) return;
  diagnostics.report("UX1003", { machine: MACHINE_ID, data: { visibleForMs: Math.round(elapsed) } });
}

export function createActionMachine<T, A>(): MachineDefinition<
  ActionContext<T, A>,
  ActionProps<T, A>,
  ActionEvent<T, A>,
  ActionStateValue
> {
  return createMachine<ActionContext<T, A>, ActionProps<T, A>, ActionEvent<T, A>, ActionStateValue>({
    id: MACHINE_ID,
    initial: "idle",

    context: () => ({
      attempt: 0,
      visible: false,
      visibleSince: null,
      startedAt: null,
      outcome: null,
      data: null,
      failure: null,
      args: null,
      release: null,
      abort: null,
      retryAt: null,
    }),

    states: {
      idle: {
        on: {
          TRIGGER: { guard: "canStart", target: "busy", actions: ["acquireKey", "beginAttempt"] },
        },
      },

      /**
       * A request is in flight. The pending affordance may or may not be visible yet: that
       * is `context.visible`, driven by the `delay` timer, not a separate state. Splitting
       * visibility into its own state would double the state count for every machine that
       * composes this one.
       */
      busy: {
        tags: ["busy"],
        effects: ["request", "showTimer"],
        on: {
          SHOW: { actions: ["markVisible", "announcePending"] },
          RESOLVE: [
            { guard: "needsHold", target: "settling", actions: ["releaseKey", "stashSuccess"] },
            { target: "success", actions: ["releaseKey", "commitSuccess"] },
          ],
          REJECT: [
            // An abort is our own cancellation, not a failure. It must not surface, must not
            // retry, and must not be announced.
            { guard: "isAborted", target: "idle", actions: ["releaseKey", "clearAttempt"] },
            { guard: "shouldAutoRetry", target: "backoff", actions: ["releaseKey", "recordFailure"] },
            { guard: "needsHold", target: "settling", actions: ["releaseKey", "stashFailure"] },
            { target: "error", actions: ["releaseKey", "commitFailure"] },
          ],
          // A keyed duplicate is dropped silently, which is the point of the guard. An
          // unkeyed one is reported, because without a key the library cannot tell whether
          // the two triggers touch the same resource.
          TRIGGER: { guard: "isUnkeyed", actions: ["reportUnkeyedOverlap"] },
          CANCEL: { target: "idle", actions: ["abortRequest", "releaseKey", "clearAttempt"] },
        },
      },

      /**
       * The request has settled but the affordance has not been visible long enough. Holding
       * here is what stops a 160ms response from producing a 10ms spinner flicker.
       */
      settling: {
        tags: ["busy"],
        effects: ["holdTimer"],
        on: {
          MIN_ELAPSED: [
            { guard: "stashedSuccess", target: "success", actions: ["commitStashed"] },
            { target: "error", actions: ["commitStashed"] },
          ],
          CANCEL: { target: "idle", actions: ["clearAttempt"] },
        },
      },

      /** Waiting before an automatic retry. Observable so a UI can show the countdown. */
      backoff: {
        tags: ["busy", "failed"],
        effects: ["backoffTimer"],
        on: {
          RETRY: { guard: "canStart", target: "busy", actions: ["acquireKey", "beginAttempt"] },
          CANCEL: { target: "error", actions: ["commitFailure"] },
          RESET: { target: "idle", actions: ["clearAttempt"] },
        },
      },

      success: {
        tags: ["settled"],
        entry: ["announceSuccess", "notifySuccess"],
        effects: ["resetTimer"],
        on: {
          RESET: { target: "idle", actions: ["clearOutcome"] },
          TRIGGER: { guard: "canStart", target: "busy", actions: ["acquireKey", "beginAttempt"] },
        },
      },

      error: {
        tags: ["settled", "failed"],
        entry: ["announceFailure", "notifyFailure", "reportUnhandled"],
        effects: ["resetTimer"],
        on: {
          RETRY: { guard: "canStart", target: "busy", actions: ["acquireKey", "beginAttempt"] },
          TRIGGER: { guard: "canStart", target: "busy", actions: ["acquireKey", "beginAttempt"] },
          RESET: { target: "idle", actions: ["clearOutcome"] },
        },
      },
    },

    implementations: {
      guards: {
        /**
         * The synchronous duplicate guard.
         *
         * Read of the registry only. The acquire happens in the action that follows, in the
         * same synchronous drain, so no other code can interleave between the two.
         */
        canStart: ({ props }) => {
          if ((props.guard ?? "single-flight") === "allow-concurrent") return true;
          if (props.key === undefined) return true;
          return !registryOf(props).isHeld(props.key);
        },

        isUnkeyed: ({ props }) => props.key === undefined,

        isAborted: ({ event }) => event.type === "REJECT" && isAbort(event.error),

        /** True when the affordance is visible and has not yet met the minimum duration. */
        needsHold: ({ context, props, ports }) =>
          context.visible && visibleFor(context, ports.clock.now()) < policyOf(props).min,

        shouldAutoRetry: ({ context, props, ports, event }) => {
          const attempts = props.retry?.attempts ?? 0;
          if (attempts <= 0 || context.attempt > attempts) return false;
          if (event.type !== "REJECT") return false;
          return normalizeError(event.error, normalizeOptions(props, ports.clock.now())).canRetry;
        },

        stashedSuccess: ({ context }) => context.outcome?.ok === true,
      },

      actions: {
        acquireKey: ({ props, assign }) => {
          if (props.key === undefined) return;
          assign({ release: registryOf(props).acquire(props.key) });
        },

        releaseKey: ({ context, assign }) => {
          context.release?.();
          assign({ release: null });
        },

        beginAttempt: ({ context, props, event, ports, assign }) => {
          if (__DEV__ && props.destructive === true && props.reversible !== true) {
            diagnostics.report("UX1001", { machine: MACHINE_ID });
          }
          assign({
            attempt: context.attempt + 1,
            startedAt: ports.clock.now(),
            outcome: null,
            failure: null,
            retryAt: null,
            // Visibility is reset here rather than when the previous attempt settled, so
            // that a settled state still carries how long it was visible for. The UX1003
            // check reads exactly that, and clearing it on settle would blind the rule.
            visible: false,
            visibleSince: null,
            // Retrying reuses the arguments of the attempt that failed.
            ...(event.type === "TRIGGER" ? { args: event.args } : {}),
          });
        },

        markVisible: ({ ports, assign }) => {
          assign({ visible: true, visibleSince: ports.clock.now() });
        },

        announcePending: ({ props, ports }) => {
          if (props.announce === false) return;
          const message = props.announce?.pending;
          if (message === undefined) return;
          ports.announcer.announce(message, "polite");
        },

        stashSuccess: ({ event, assign }) => {
          if (event.type !== "RESOLVE") return;
          assign({ outcome: { ok: true, value: event.value }, data: event.value, abort: null });
        },

        stashFailure: ({ event, props, ports, assign }) => {
          if (event.type !== "REJECT") return;
          const failure = normalizeError(event.error, normalizeOptions(props, ports.clock.now()));
          assign({ outcome: { ok: false, failure }, failure, abort: null });
        },

        commitSuccess: ({ event, assign }) => {
          if (event.type !== "RESOLVE") return;
          assign({ data: event.value, outcome: null, abort: null });
        },

        commitFailure: ({ context, event, props, ports, assign }) => {
          const failure =
            event.type === "REJECT"
              ? normalizeError(event.error, normalizeOptions(props, ports.clock.now()))
              : context.failure;
          assign({ failure, outcome: null, abort: null, retryAt: null });
        },

        /** Records a failure without leaving `busy` semantics, used on the way into backoff. */
        recordFailure: ({ event, props, ports, assign }) => {
          if (event.type !== "REJECT") return;
          assign({
            failure: normalizeError(event.error, normalizeOptions(props, ports.clock.now())),
            abort: null,
          });
        },

        commitStashed: ({ assign }) => {
          assign({ outcome: null });
        },

        abortRequest: ({ context }) => {
          context.abort?.("cancelled");
        },

        clearAttempt: ({ assign }) => {
          assign({
            attempt: 0,
            visible: false,
            visibleSince: null,
            startedAt: null,
            outcome: null,
            abort: null,
            retryAt: null,
          });
        },

        clearOutcome: ({ assign }) => {
          assign({
            attempt: 0,
            data: null,
            failure: null,
            outcome: null,
            visible: false,
            visibleSince: null,
            startedAt: null,
            retryAt: null,
          });
        },

        announceSuccess: ({ context, props, ports }) => {
          warnIfUnheard(context, props, ports.announcer.live(), ports.clock.now());
          if (props.announce === false) return;
          ports.announcer.announce(props.announce?.success ?? "Done.", "polite");
        },

        announceFailure: ({ context, props, ports }) => {
          warnIfUnheard(context, props, ports.announcer.live(), ports.clock.now());
          if (props.announce === false) return;
          const message = props.announce?.error ?? context.failure?.message;
          if (message === undefined) return;
          // Failures interrupt: a user who has moved on still needs to know the save failed.
          ports.announcer.announce(message, "assertive");
        },

        notifySuccess: ({ context, props }) => {
          if (context.data !== null) props.onSuccess?.(context.data);
          props.onSettled?.();
        },

        notifyFailure: ({ context, props }) => {
          if (context.failure !== null) props.onError?.(context.failure);
          props.onSettled?.();
        },

        reportUnhandled: ({ props }) => {
          if (__DEV__ && props.onError === undefined) {
            diagnostics.report("UX1004", { machine: MACHINE_ID });
          }
        },

        reportUnkeyedOverlap: () => {
          if (__DEV__) diagnostics.report("UX1002", { machine: MACHINE_ID });
        },
      },

      effects: {
        /**
         * Runs the work.
         *
         * Declared as an effect of `busy` so its lifetime is exactly that state: leaving
         * `busy` for any reason disposes it, and disposal aborts. An abort after the request
         * has already settled is a no-op, so the transitions out of `busy` on RESOLVE and
         * REJECT are safe.
         */
        request: (api) => {
          const props = api.props();
          // Cast is sound: `args` is written by `beginAttempt` from the TRIGGER event before
          // this state is entered, and the only paths into `busy` run that action.
          const args = api.context().args as A;
          const inFlight = api.ports.transport.run((signal) => props.run(args, signal));
          api.assign({ abort: inFlight.abort });

          inFlight.promise.then(
            (value) => {
              api.send({ type: "RESOLVE", value });
            },
            (error: unknown) => {
              api.send({ type: "REJECT", error });
            },
          );

          return () => {
            inFlight.abort("superseded");
          };
        },

        /** Reveals the pending affordance once `delay` has elapsed. */
        showTimer: (api) => {
          const { delay } = policyOf(api.props());
          if (api.context().visible) return;
          if (delay <= 0) {
            api.send({ type: "SHOW" });
            return;
          }
          return api.ports.clock.after(delay, () => {
            api.send({ type: "SHOW" });
          });
        },

        /** Holds a settled result until the affordance has met its minimum duration. */
        holdTimer: (api) => {
          const remaining = Math.max(
            0,
            policyOf(api.props()).min - visibleFor(api.context(), api.ports.clock.now()),
          );
          if (remaining <= 0) {
            api.send({ type: "MIN_ELAPSED" });
            return;
          }
          return api.ports.clock.after(remaining, () => {
            api.send({ type: "MIN_ELAPSED" });
          });
        },

        backoffTimer: (api) => {
          const props = api.props();
          const delay = computeBackoff(api.context().attempt, props.retry?.backoff);
          api.assign({ retryAt: api.ports.clock.now() + delay });
          return api.ports.clock.after(delay, () => {
            api.send({ type: "RETRY" });
          });
        },

        /** Returns a settled action to idle, when the consumer asked for that. */
        resetTimer: (api) => {
          const after = api.props().resetAfterMs;
          if (after === false || after === undefined) return;
          return api.ports.clock.after(after, () => {
            api.send({ type: "RESET" });
          });
        },
      },
    },
  });
}
