/**
 * A clock you drive by hand.
 *
 * This is the reason the port exists. Everything this library is about is timed: a 150ms
 * threshold before a spinner appears, a 400ms minimum once it has, a 6000ms undo window, a
 * backoff delay honouring `Retry-After`. Testing that behaviour against real timers means
 * either sleeping, which makes a suite slow and flaky, or mocking the global timer
 * functions, which breaks anything else in the test that needs them.
 *
 * With an injected clock a timing assertion is a counter increment, and the suite is exact.
 */

import type { ClockPort } from "@unruffled/core";

interface ScheduledTimer {
  readonly id: number;
  readonly at: number;
  readonly fn: () => void;
  cancelled: boolean;
}

interface FrameSubscriber {
  readonly id: number;
  readonly start: number;
  readonly fn: (elapsedMs: number) => void;
  cancelled: boolean;
}

export interface FakeClock extends ClockPort {
  /**
   * Moves time forward, firing every timer that becomes due, in order.
   *
   * Timers scheduled during the advance are honoured, so a chain of timeouts resolves in one
   * call. `now()` reports each timer firing time while that timer runs, rather than jumping
   * straight to the end, which keeps elapsed-time calculations inside machines correct.
   */
  advance(ms: number): void;
  /** Fires every pending timer regardless of its due time, in due order. */
  flush(): void;
  /** Number of live timers. A machine that has torn down correctly leaves zero. */
  pending(): number;
  /** Live frame subscriptions. */
  frames(): number;
  /** Milliseconds between synthesised animation frames during {@link FakeClock.advance}. */
  frameInterval: number;
}

/** Nominal frame interval, close enough to 60Hz for countdown assertions. */
const DEFAULT_FRAME_MS = 16;

export function createFakeClock(startMs = 0): FakeClock {
  let current = startMs;
  let nextId = 1;
  let timers: ScheduledTimer[] = [];
  let subscribers: FrameSubscriber[] = [];
  let frameInterval = DEFAULT_FRAME_MS;

  const live = (): ScheduledTimer[] => timers.filter((timer) => !timer.cancelled);

  /** Runs frame callbacks for every synthesised frame boundary crossed in (from, to]. */
  const runFrames = (from: number, to: number): void => {
    if (subscribers.length === 0) return;
    for (let at = from + frameInterval; at <= to; at += frameInterval) {
      for (const subscriber of [...subscribers]) {
        if (subscriber.cancelled || at < subscriber.start) continue;
        subscriber.fn(at - subscriber.start);
      }
    }
  };

  const advance = (ms: number): void => {
    const target = current + ms;

    // Each iteration jumps to the next due timer rather than to `target`, so a timer that
    // schedules another timer sees the correct `now()` and the chain resolves exactly.
    for (;;) {
      const due = live()
        .filter((timer) => timer.at <= target)
        .sort((a, b) => a.at - b.at)[0];
      if (!due) break;

      runFrames(current, due.at);
      current = due.at;
      due.cancelled = true;
      timers = timers.filter((timer) => timer !== due);
      due.fn();
    }

    runFrames(current, target);
    current = target;
    timers = live();
  };

  return {
    get frameInterval() {
      return frameInterval;
    },
    set frameInterval(value: number) {
      frameInterval = Math.max(1, value);
    },

    now: () => current,

    after(ms, fn) {
      const timer: ScheduledTimer = { id: nextId++, at: current + Math.max(0, ms), fn, cancelled: false };
      timers.push(timer);
      return () => {
        timer.cancelled = true;
      };
    },

    frame(fn) {
      const subscriber: FrameSubscriber = { id: nextId++, start: current, fn, cancelled: false };
      subscribers.push(subscriber);
      return () => {
        subscriber.cancelled = true;
        subscribers = subscribers.filter((entry) => entry !== subscriber);
      };
    },

    advance,

    flush() {
      for (;;) {
        const next = live().sort((a, b) => a.at - b.at)[0];
        if (!next) break;
        advance(Math.max(0, next.at - current));
      }
    },

    pending: () => live().length,
    frames: () => subscribers.filter((entry) => !entry.cancelled).length,
  };
}

/**
 * Lets queued promise callbacks run.
 *
 * Needed between advancing the clock and asserting, because a request resolving sends its
 * event from a microtask. Uses a real macrotask so every pending microtask has drained.
 */
export function flushMicrotasks(): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, 0);
  });
}
