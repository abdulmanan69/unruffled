/**
 * Deterministic port implementations.
 *
 * Every one of these records what it was asked to do, so a test asserts on behaviour rather
 * than on internals. The announcer in particular: "exactly one polite announcement, with
 * this text" is the assertion that catches the two bugs live regions always have, which are
 * saying nothing and saying everything twice.
 */

import {
  resolvePorts,
  type AnnouncerPort,
  type DocPort,
  type FocusTarget,
  type LeaveReason,
  type NavigationPort,
  type Politeness,
  type Ports,
  type StoragePort,
} from "@unruffled/core";
import { createFakeClock, type FakeClock } from "./fakeClock.js";

export interface RecordedAnnouncement {
  readonly message: string;
  readonly politeness: Politeness;
}

export interface RecordingAnnouncer extends AnnouncerPort {
  readonly announcements: readonly RecordedAnnouncement[];
  /** Announcements at a given politeness, for asserting that failures interrupt. */
  at(politeness: Politeness): readonly RecordedAnnouncement[];
  /** Simulates the live region being mounted or absent, which drives rule UX1003. */
  setLive(live: boolean): void;
  clear(): void;
}

export function createRecordingAnnouncer(live = true): RecordingAnnouncer {
  const announcements: RecordedAnnouncement[] = [];
  let isLive = live;

  return {
    announcements,
    announce(message, politeness) {
      announcements.push({ message, politeness });
    },
    live: () => isLive,
    at: (politeness) => announcements.filter((entry) => entry.politeness === politeness),
    setLive(next) {
      isLive = next;
    },
    clear() {
      announcements.length = 0;
    },
  };
}

export interface MemoryStorage extends StoragePort {
  readonly entries: Map<string, string>;
}

export function createMemoryStorage(initial?: Record<string, string>): MemoryStorage {
  const entries = new Map<string, string>(Object.entries(initial ?? {}));
  return {
    entries,
    get: (key) => entries.get(key) ?? null,
    set: (key, value) => {
      entries.set(key, value);
    },
    remove: (key) => {
      entries.delete(key);
    },
  };
}

/** What the consumer decided when an exit was blocked. */
export interface ExitAttempt {
  readonly blocked: boolean;
  /** Mutated when the blocked consumer resolves the prompt. */
  readonly outcome: { decision: "proceed" | "cancel" | null };
}

export interface ScriptedNavigation extends NavigationPort {
  /** Simulates the user leaving. Drives the flush path that an undo window depends on. */
  leave(reason?: LeaveReason): void;
  /**
   * Simulates an attempted exit.
   *
   * Calls the first blocker that wants to block, handing it the proceed and cancel
   * callbacks, then reports which one the consumer chose.
   */
  attemptExit(): ExitAttempt;
  readonly beacons: readonly { url: string; body: string }[];
  /** When false, `beacon` reports failure so the synchronous fallback path is exercised. */
  beaconAvailable: boolean;
}

export function createScriptedNavigation(): ScriptedNavigation {
  const leaveHandlers = new Set<(reason: LeaveReason) => void>();
  const blockers = new Set<{
    shouldBlock: () => boolean;
    onBlocked: (proceed: () => void, cancel: () => void) => void;
  }>();
  const beacons: { url: string; body: string }[] = [];
  let beaconAvailable = true;

  return {
    get beaconAvailable() {
      return beaconAvailable;
    },
    set beaconAvailable(next: boolean) {
      beaconAvailable = next;
    },
    beacons,

    onLeave(handler) {
      leaveHandlers.add(handler);
      return () => {
        leaveHandlers.delete(handler);
      };
    },

    block(shouldBlock, onBlocked) {
      const entry = { shouldBlock, onBlocked };
      blockers.add(entry);
      return () => {
        blockers.delete(entry);
      };
    },

    beacon(url, body) {
      if (!beaconAvailable) return false;
      beacons.push({ url, body });
      return true;
    },

    leave(reason = "navigate") {
      for (const handler of [...leaveHandlers]) handler(reason);
    },

    attemptExit() {
      for (const blocker of blockers) {
        if (!blocker.shouldBlock()) continue;
        const outcome: { decision: "proceed" | "cancel" | null } = { decision: null };
        blocker.onBlocked(
          () => {
            outcome.decision = "proceed";
          },
          () => {
            outcome.decision = "cancel";
          },
        );
        return { blocked: true, outcome };
      }
      return { blocked: false, outcome: { decision: null } };
    },
  };
}

export interface FakeDoc extends DocPort {
  /** Sets what `activeElement()` reports, for focus-restoration assertions. */
  setActiveElement(target: FocusTarget | null): void;
  setHidden(hidden: boolean): void;
  /** Dispatches a synthetic event to listeners registered through this port. */
  dispatch(type: string, event?: unknown): void;
  /** Listener counts by type. A machine that cleans up correctly leaves none. */
  listenerCount(type?: string): number;
}

export function createFakeDoc(): FakeDoc {
  const listeners = new Map<string, Set<(event: unknown) => void>>();
  let active: FocusTarget | null = null;
  let hidden = false;

  return {
    activeElement: () => active,
    isHidden: () => hidden,

    listen(type, handler) {
      const set = listeners.get(type) ?? new Set<(event: unknown) => void>();
      set.add(handler);
      listeners.set(type, set);
      return () => {
        set.delete(handler);
      };
    },

    setActiveElement(target) {
      active = target;
    },
    setHidden(next) {
      hidden = next;
    },
    dispatch(type, event) {
      for (const handler of [...(listeners.get(type) ?? [])]) handler(event ?? { type });
    },
    listenerCount(type) {
      if (type !== undefined) return listeners.get(type)?.size ?? 0;
      let total = 0;
      for (const set of listeners.values()) total += set.size;
      return total;
    },
  };
}

/** A focusable stand-in, for asserting that focus was restored to the right element. */
export interface SpyFocusTarget extends FocusTarget {
  readonly name: string;
  focusCount: number;
}

export function createFocusTarget(name: string): SpyFocusTarget {
  return {
    name,
    focusCount: 0,
    isConnected: true,
    focus() {
      this.focusCount += 1;
    },
  };
}

export interface TestPorts extends Ports {
  readonly clock: FakeClock;
  readonly announcer: RecordingAnnouncer;
  readonly storage: MemoryStorage;
  readonly navigation: ScriptedNavigation;
  readonly doc: FakeDoc;
}

export interface TestPortOptions {
  readonly startMs?: number;
  /** Whether a live region is mounted. Set false to exercise UX1003. */
  readonly live?: boolean;
  readonly storage?: Record<string, string>;
}

/**
 * A full set of deterministic ports.
 *
 * `scheduler.microtask` stays a real microtask, because machines use it for coalescing
 * rather than for timing, and making it synchronous would hide ordering bugs instead of
 * exposing them.
 */
export function createTestPorts(options: TestPortOptions = {}): TestPorts {
  const clock = createFakeClock(options.startMs ?? 0);
  const announcer = createRecordingAnnouncer(options.live ?? true);
  const storage = createMemoryStorage(options.storage);
  const navigation = createScriptedNavigation();
  const doc = createFakeDoc();

  const base = resolvePorts({ clock, announcer, storage, navigation, doc });
  return { ...base, clock, announcer, storage, navigation, doc };
}
