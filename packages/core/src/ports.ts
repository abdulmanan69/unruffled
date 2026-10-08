/**
 * Ports are the only way machines reach the outside world.
 *
 * Every impure capability a machine needs is declared here as a narrow interface and
 * injected. Three things fall out of that:
 *
 * 1. Timing is deterministic in tests. A fake clock replaces the real one, so a 150ms
 *    pending threshold or a 6000ms undo window is asserted by advancing a counter rather
 *    than by sleeping, and the suite never flakes.
 * 2. Core never touches a global. No `window`, no `document`, no `setTimeout` captured at
 *    module scope. That is what makes a Vue, Svelte or vanilla adapter a mechanical job.
 * 3. Multi-window and shadow-DOM correctness is structural rather than remembered. Listener
 *    registration and focus reads go through {@link DocPort}, which is handed the owning
 *    root, so a machine rendered inside a shadow root or a popped-out window still works.
 *    Libraries that reach for the global `document` instead have carried that bug class for
 *    years.
 *
 * No port is mandatory. Core supplies platform-neutral fallbacks via {@link defaultPorts};
 * the React adapter supplies DOM-backed ones; `@unruffled/testing` supplies deterministic
 * ones.
 */

/** Releases whatever the call that returned it acquired. Must be safe to call twice. */
export type Disposer = () => void;

/**
 * Timers and the current instant.
 *
 * Intentionally not `Date.now` and not the global `setTimeout`: both are the reason timed
 * UI behaviour is normally untestable.
 */
export interface ClockPort {
  /** Monotonic milliseconds. Only ever used for differences, never as a wall clock. */
  readonly now: () => number;
  /** Runs `fn` after `ms`. Dispose to cancel. */
  readonly after: (ms: number, fn: () => void) => Disposer;
  /**
   * Runs `fn` on each animation frame until disposed, with milliseconds since the call.
   *
   * One shared loop drives every live countdown in the library, which is why there is no
   * animation dependency. Under reduced motion the adapter may downgrade this to a coarse
   * interval: consumers read a value, not a frame rate.
   */
  readonly frame: (fn: (elapsedMs: number) => void) => Disposer;
}

/** Deferral that is not time-based. */
export interface SchedulerPort {
  /** Runs after the current task, before paint. Used to coalesce burst transitions. */
  readonly microtask: (fn: () => void) => void;
  /** Runs when the host is idle, or soon. Used for non-urgent reconciliation. */
  readonly idle: (fn: () => void) => Disposer;
}

/** Durable key-value storage. Synchronous by contract; a failing implementation returns null. */
export interface StoragePort {
  readonly get: (key: string) => string | null;
  readonly set: (key: string, value: string) => void;
  readonly remove: (key: string) => void;
}

/** Why a machine is being asked to settle before it wanted to. */
export type LeaveReason = "navigate" | "pagehide" | "manual";

/**
 * Leaving the page or the route.
 *
 * This port is what makes a deferred write safe. An undo window holds a mutation for a few
 * seconds; if the user navigates or closes the tab inside that window the write must still
 * land. `onLeave` is the hook that flushes it, and `beacon` is the only transport that
 * survives an unloading document.
 */
export interface NavigationPort {
  /** Fires when the document or the route is about to go away. */
  readonly onLeave: (handler: (reason: LeaveReason) => void) => Disposer;
  /**
   * Whether {@link NavigationPort.onLeave} can actually fire.
   *
   * Reported rather than inferred, because subscribing proves nothing: the fallback
   * implementation below returns a working disposer and never calls the handler. A machine
   * holding a deferred write needs to know the difference between "the flush is wired" and
   * "the flush is a no-op and this write dies on navigation", and rule UX1007 reads exactly
   * this.
   */
  readonly flushable: () => boolean;
  /**
   * Asks the host to intercept an attempted exit while `shouldBlock` returns true.
   *
   * Router-agnostic: the React adapter adds `beforeunload`, and a router binding adds
   * in-app navigation blocking. Returns a disposer, never a promise, because the decision
   * has to be made synchronously at the point of exit.
   */
  readonly block: (
    shouldBlock: () => boolean,
    onBlocked: (proceed: () => void, cancel: () => void) => void,
  ) => Disposer;
  /**
   * Fire-and-forget send that survives unload. Returns false when unavailable, which is the
   * signal to fall back to a synchronous flush.
   */
  readonly beacon: (url: string, body: string) => boolean;
}

/** The minimum of a focusable element that core needs. Deliberately not `HTMLElement`. */
export interface FocusTarget {
  readonly focus: (options?: { preventScroll?: boolean }) => void;
  readonly isConnected: boolean;
}

/**
 * The owning document or shadow root.
 *
 * Every global listener, focus read and focus restore in the library goes through here, so a
 * machine inside a shadow root or a secondary window behaves correctly without any
 * per-component special-casing.
 */
export interface DocPort {
  /** Currently focused element within the owning root, if any. */
  readonly activeElement: () => FocusTarget | null;
  /** Registers a listener on the owning root. */
  readonly listen: (
    type: string,
    handler: (event: unknown) => void,
    options?: { capture?: boolean; passive?: boolean },
  ) => Disposer;
  /** True when the owning document is hidden, used to decide whether to announce. */
  readonly isHidden: () => boolean;
}

/** Live-region politeness. `assertive` interrupts the user and is reserved for failures. */
export type Politeness = "polite" | "assertive";

/**
 * Screen-reader announcements.
 *
 * Announcement is on by default in this library and silence is the opt-out, which is the
 * inverse of the ecosystem default. Queueing, de-duplication and rate limiting live in the
 * announce machine; this port is only the final write.
 */
export interface AnnouncerPort {
  readonly announce: (message: string, politeness: Politeness) => void;
  /**
   * True when a live region is actually mounted and will be read.
   *
   * This is what lets rule UX1003 distinguish "announced correctly" from "announced into a
   * void". Without it the library could only warn that announcing is *possible*, which is
   * the kind of always-on warning developers silence instead of fixing.
   */
  readonly live: () => boolean;
}

/** A request in flight, with the handle needed to abandon it. */
export interface InFlight<T> {
  promise: Promise<T>;
  readonly abort: (reason?: unknown) => void;
}

/**
 * Abortable request execution.
 *
 * Machines never call `fetch`. They hand a function that receives an `AbortSignal` to the
 * transport, which means unmounting mid-request, superseding a stale attempt and cancelling
 * a queued undo all work the same way.
 */
export interface TransportPort {
  readonly run: <T>(fn: (signal: AbortSignal) => Promise<T>) => InFlight<T>;
}

/** Sink for diagnostics. In production builds nothing calls this. */
export interface LoggerPort {
  readonly emit: (event: unknown) => void;
}

/** The full port bundle a service may be given. Every field is optional at the call site. */
export interface Ports {
  clock: ClockPort;
  scheduler: SchedulerPort;
  storage: StoragePort;
  navigation: NavigationPort;
  doc: DocPort;
  announcer: AnnouncerPort;
  transport: TransportPort;
  logger: LoggerPort;
}

const noop = (): void => {};

/** Coarse tick used when the runtime has no animation frame source, so countdowns still advance. */
const FALLBACK_FRAME_MS = 100;

/**
 * Platform-neutral fallbacks.
 *
 * `clock` and `transport` are real, because `setTimeout`, `AbortController` and
 * `requestAnimationFrame` exist in every target runtime and a library that could not time
 * anything without an adapter would be useless in Node. Everything DOM-shaped is inert, so
 * core degrades to doing nothing rather than throwing when a capability is absent.
 */
export function defaultPorts(): Ports {
  // The DOM lib declares these as always present. They are not: this module has to work in
  // Node and in a worker, which is the whole reason the typeof guards below exist. Typing
  // the global explicitly keeps those guards meaningful instead of provably dead.
  const g: {
    requestAnimationFrame?: (callback: (time: number) => void) => number;
    cancelAnimationFrame?: (handle: number) => void;
    performance?: { now?: () => number };
  } = globalThis;

  const requestFrame = typeof g.requestAnimationFrame === "function" ? g.requestAnimationFrame.bind(g) : null;
  const cancelFrame = typeof g.cancelAnimationFrame === "function" ? g.cancelAnimationFrame.bind(g) : null;
  const perf = g.performance;
  const nowFn = typeof perf?.now === "function" ? perf.now.bind(perf) : (): number => Date.now();

  const clock: ClockPort = {
    now: nowFn,
    after: (ms, fn) => {
      const id = setTimeout(fn, ms);
      return () => {
        clearTimeout(id);
      };
    },
    frame: (fn) => {
      const start = nowFn();
      const state = { live: true };

      if (requestFrame && cancelFrame) {
        // The guard at the top of `tick` is the only one needed. If `fn` disposes
        // synchronously, this schedules one further frame whose `tick` returns immediately
        // without calling `fn` and without rescheduling, so the loop ends either way. A
        // second guard after `fn` would read as dead code to the type checker, because
        // property narrowing survives an opaque call.
        let handle = requestFrame(function tick() {
          if (!state.live) return;
          fn(nowFn() - start);
          handle = requestFrame(tick);
        });
        return () => {
          state.live = false;
          cancelFrame(handle);
        };
      }

      const id = setInterval(() => {
        if (!state.live) return;
        fn(nowFn() - start);
      }, FALLBACK_FRAME_MS);
      return () => {
        state.live = false;
        clearInterval(id);
      };
    },
  };

  return {
    clock,
    scheduler: {
      microtask: (fn) => {
        void Promise.resolve().then(fn);
      },
      idle: (fn) => clock.after(0, fn),
    },
    storage: { get: () => null, set: noop, remove: noop },
    // Inert, and honest about it: `flushable` reports false so a deferred write warns rather
    // than silently depending on a handler that is never called.
    navigation: { onLeave: () => noop, flushable: () => false, block: () => noop, beacon: () => false },
    doc: { activeElement: () => null, listen: () => noop, isHidden: () => false },
    // Not live by default: the React adapter swaps this in only once <Announcer /> mounts,
    // which is precisely the condition UX1003 reports on.
    announcer: { announce: noop, live: () => false },
    transport: {
      run: (fn) => {
        const controller = new AbortController();
        return {
          promise: fn(controller.signal),
          abort: (reason) => {
            controller.abort(reason);
          },
        };
      },
    },
    logger: { emit: noop },
  };
}

/** Fills gaps in a partial port bundle with {@link defaultPorts}. */
export function resolvePorts(partial?: Partial<Ports>): Ports {
  const base = defaultPorts();
  return partial ? { ...base, ...partial } : base;
}
