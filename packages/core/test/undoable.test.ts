import { beforeEach, describe, expect, it, vi } from "vitest";
import { createKeyRegistry, createService, type Service } from "@unruffled/core";
import { diagnostics } from "@unruffled/core/diagnostics";
import { createTestPorts, flushMicrotasks, type TestPorts } from "@unruffled/testing";
// Reached by path rather than through `@unruffled/core`: the barrel is wired separately and
// does not re-export the undoable machine yet, so a package import would not resolve.
import { connectUndoable, type UndoableApi } from "../src/machines/undoable/connect.js";
import { createUndoableMachine } from "../src/machines/undoable/machine.js";
import type {
  UndoableContext,
  UndoableEvent,
  UndoableProps,
  UndoableStateValue,
} from "../src/machines/undoable/types.js";

type UndoableService<T> = Service<UndoableContext<T>, UndoableProps<T>, UndoableEvent<T>, UndoableStateValue>;

/**
 * `altText` is left out of the partial because it is required in the props and a spread
 * cannot be allowed to put `undefined` back into it.
 */
type TestProps<T> = Partial<Omit<UndoableProps<T>, "commit" | "altText">> & Pick<UndoableProps<T>, "commit">;

interface Harness<T> {
  readonly ports: TestPorts;
  readonly service: UndoableService<T>;
  readonly api: () => UndoableApi<T>;
  readonly schedule: (item: T) => void;
}

function setup<T>(props: TestProps<T>, ports: TestPorts = createTestPorts()): Harness<T> {
  const service = createService(createUndoableMachine<T>(), {
    props: { altText: "Undo", ...props },
    ports,
  });
  return {
    ports,
    service,
    api: () => connectUndoable(service.getSnapshot(), service.send),
    schedule: (item: T) => {
      service.send({ type: "SCHEDULE", item });
    },
  };
}

/**
 * Commits are declared with both parameters even where the test ignores them, so
 * `toHaveBeenCalledWith(batch, signal)` type-checks against the mock's own signature.
 */
const resolvingCommit = () => vi.fn((_items: readonly string[], _signal: AbortSignal) => Promise.resolve());

/** Stays in flight for the whole test, for the cases that only care about `committing`. */
const hangingCommit = () =>
  vi.fn((_items: readonly string[], _signal: AbortSignal) => new Promise<void>(() => {}));

const rejectingCommit = (error: unknown) =>
  vi.fn((_items: readonly string[], _signal: AbortSignal) => Promise.reject(error));

beforeEach(() => {
  diagnostics.reset();
});

describe("undoable machine: the held window", () => {
  it("sends nothing while the window is still open", async () => {
    const commit = resolvingCommit();
    const h = setup<string>({ commit });

    h.schedule("row:1");

    expect(h.api().state).toBe("held");
    expect(h.api().canUndo).toBe(true);
    expect(h.api().items).toEqual(["row:1"]);

    h.ports.clock.advance(5999);

    // One millisecond short of the window: the interface has shown "Deleted", the server
    // has heard nothing.
    expect(commit).not.toHaveBeenCalled();
    expect(h.api().state).toBe("held");
    await flushMicrotasks();
  });

  it("commits exactly once when the window expires", async () => {
    const commit = resolvingCommit();
    const h = setup<string>({ commit });

    h.schedule("row:1");
    h.ports.clock.advance(6000);

    expect(commit).toHaveBeenCalledTimes(1);
    expect(commit).toHaveBeenCalledWith(["row:1"], expect.any(AbortSignal));
    expect(h.api().state).toBe("committing");
    expect(h.api().canUndo).toBe(false);

    await flushMicrotasks();
    expect(h.api().state).toBe("committed");

    // Nothing re-arms: a second window would send the same delete twice.
    h.ports.clock.advance(60_000);
    expect(commit).toHaveBeenCalledTimes(1);
  });

  it("honours a custom window exactly", async () => {
    const commit = resolvingCommit();
    const h = setup<string>({ commit, windowMs: 2500 });

    h.schedule("row:1");
    h.ports.clock.advance(2499);
    expect(commit).not.toHaveBeenCalled();

    h.ports.clock.advance(1);
    expect(commit).toHaveBeenCalledTimes(1);
    await flushMicrotasks();
  });

  it("exposes expiresAt as a clock reading rather than a duration", async () => {
    const commit = hangingCommit();
    const h = setup<string>({ commit, windowMs: 4000 }, createTestPorts({ startMs: 1000 }));

    h.ports.clock.advance(250);
    h.schedule("row:1");

    expect(h.api().expiresAt).toBe(5250);

    h.ports.clock.advance(1000);
    // A duration would have shrunk here. The reading is what lets the adapter derive the
    // countdown itself, exactly as it does from the action machine's retryAt.
    expect(h.api().expiresAt).toBe(5250);

    h.api().flush();
    expect(h.api().expiresAt).toBeNull();
    await flushMicrotasks();
  });

  it("returns a committed entry to idle after the reset delay", async () => {
    const commit = resolvingCommit();
    const h = setup<string>({ commit });

    h.schedule("row:1");
    h.ports.clock.advance(6000);
    await flushMicrotasks();
    expect(h.api().state).toBe("committed");

    h.ports.clock.advance(999);
    expect(h.api().state).toBe("committed");

    h.ports.clock.advance(1);
    expect(h.api().state).toBe("idle");
    expect(h.api().count).toBe(0);
  });
});

describe("undoable machine: undo", () => {
  it("sends nothing and rolls the local change back", async () => {
    const commit = resolvingCommit();
    const rollback = vi.fn();
    const onUndone = vi.fn();
    const h = setup<string>({ commit, rollback, onUndone });

    h.schedule("row:1");
    h.ports.clock.advance(5999);
    h.api().undo();

    expect(rollback).toHaveBeenCalledWith(["row:1"]);
    expect(onUndone).toHaveBeenCalledWith(["row:1"]);
    expect(h.api().state).toBe("idle");
    expect(h.api().count).toBe(0);

    // The request was never made, and no later tick can make it.
    h.ports.clock.advance(60_000);
    expect(commit).not.toHaveBeenCalled();
    expect(h.ports.clock.pending()).toBe(0);
    await flushMicrotasks();
  });

  it("refuses an undo once the commit is in flight", async () => {
    const commit = hangingCommit();
    const rollback = vi.fn();
    const h = setup<string>({ commit, rollback });

    h.schedule("row:1");
    h.ports.clock.advance(6000);

    expect(h.api().state).toBe("committing");
    expect(h.api().canUndo).toBe(false);

    h.api().undo();

    // There is nothing left to cancel, so the request stays sent and the local data stays
    // deleted. An Undo that "worked" here is the bug this machine exists to prevent.
    expect(h.api().state).toBe("committing");
    expect(rollback).not.toHaveBeenCalled();
    expect(commit).toHaveBeenCalledTimes(1);
    await flushMicrotasks();
  });
});

describe("undoable machine: coalescing repeats", () => {
  it("merges repeats sharing a tag into one entry and restarts the window", async () => {
    const commit = resolvingCommit();
    const h = setup<string>({ commit, coalesce: "delete-rows" });

    h.schedule("row:1");
    expect(h.api().expiresAt).toBe(6000);

    h.ports.clock.advance(3000);
    h.schedule("row:2");

    expect(h.api().count).toBe(2);
    expect(h.api().expiresAt).toBe(9000);

    h.ports.clock.advance(3000);
    // The first window's deadline has passed and nothing was sent, because the repeat
    // pushed it forward rather than starting a second entry with its own timer.
    expect(commit).not.toHaveBeenCalled();
    expect(h.api().state).toBe("held");

    h.schedule("row:3");
    expect(h.api().count).toBe(3);
    expect(h.api().expiresAt).toBe(12_000);

    h.ports.clock.advance(5999);
    expect(commit).not.toHaveBeenCalled();
    await flushMicrotasks();
  });

  it("commits a merged batch as a single write holding every item", async () => {
    const commit = resolvingCommit();
    const onCommitted = vi.fn();
    const h = setup<string>({ commit, coalesce: "delete-rows", onCommitted });

    h.schedule("row:1");
    h.schedule("row:2");
    h.schedule("row:3");
    h.ports.clock.advance(6000);

    expect(commit).toHaveBeenCalledTimes(1);
    expect(commit).toHaveBeenCalledWith(["row:1", "row:2", "row:3"], expect.any(AbortSignal));

    await flushMicrotasks();
    expect(onCommitted).toHaveBeenCalledWith(["row:1", "row:2", "row:3"]);
  });

  it("flushes the open entry and queues a schedule that cannot merge", async () => {
    const commit = resolvingCommit();
    const h = setup<string>({ commit });

    h.schedule("row:1");
    h.schedule("row:2");

    // Two entries on one key must not overlap: the first is sent, the second waits.
    expect(commit).toHaveBeenCalledTimes(1);
    expect(commit).toHaveBeenCalledWith(["row:1"], expect.any(AbortSignal));
    expect(h.api().state).toBe("committing");
    expect(h.api().items).toEqual(["row:1"]);

    await flushMicrotasks();

    expect(h.api().state).toBe("held");
    expect(h.api().items).toEqual(["row:2"]);
    expect(h.api().expiresAt).toBe(6000);

    h.ports.clock.advance(6000);
    expect(commit).toHaveBeenCalledTimes(2);
    expect(commit).toHaveBeenLastCalledWith(["row:2"], expect.any(AbortSignal));
    await flushMicrotasks();
  });
});

describe("undoable machine: flushing early", () => {
  it("commits immediately on flush()", async () => {
    const commit = resolvingCommit();
    const h = setup<string>({ commit });

    h.schedule("row:1");
    h.api().flush();

    expect(commit).toHaveBeenCalledTimes(1);
    expect(h.api().state).toBe("committing");
    await flushMicrotasks();
    expect(h.api().state).toBe("committed");
  });

  it("commits the pending batch when the user navigates away", async () => {
    const commit = resolvingCommit();
    const h = setup<string>({ commit });

    h.schedule("row:1");
    h.ports.clock.advance(1200);
    h.ports.navigation.leave("navigate");

    // A route change inside the window is the most common way this write is lost.
    expect(commit).toHaveBeenCalledWith(["row:1"], expect.any(AbortSignal));
    expect(h.api().state).toBe("committing");
    await flushMicrotasks();
  });

  it("commits the pending batch when the document goes away", async () => {
    const commit = resolvingCommit();
    const h = setup<string>({ commit, coalesce: "delete-rows" });

    h.schedule("row:1");
    h.schedule("row:2");
    h.ports.navigation.leave("pagehide");

    expect(commit).toHaveBeenCalledTimes(1);
    expect(commit).toHaveBeenCalledWith(["row:1", "row:2"], expect.any(AbortSignal));
    await flushMicrotasks();
  });

  it("keeps holding on leave when flushOn is an empty array", async () => {
    const commit = resolvingCommit();
    const h = setup<string>({ commit, flushOn: [] });

    h.schedule("row:1");
    h.ports.navigation.leave("navigate");
    h.ports.navigation.leave("pagehide");

    // The consumer opted out, so the window is still open and nothing has been sent.
    expect(commit).not.toHaveBeenCalled();
    expect(h.api().state).toBe("held");

    h.ports.clock.advance(6000);
    expect(commit).toHaveBeenCalledTimes(1);
    await flushMicrotasks();
  });
});

describe("undoable machine: diagnostics", () => {
  it("reports UX1007 when the navigation port cannot flush", async () => {
    const ports = createTestPorts();
    ports.navigation.flushAvailable = false;
    const h = setup<string>({ commit: hangingCommit() }, ports);

    h.schedule("row:1");

    const reported = diagnostics.history().find((event) => event.code === "UX1007");
    expect(reported).toBeDefined();
    expect(reported?.rule.severity).toBe("error");
    expect(reported?.machine).toBe("undoable");
    await flushMicrotasks();
  });

  it("stays quiet when the port reports that it can flush", async () => {
    const h = setup<string>({ commit: hangingCommit() });

    h.schedule("row:1");

    expect(diagnostics.history().map((event) => event.code)).not.toContain("UX1007");
    await flushMicrotasks();
  });

  it("stays quiet for an empty flushOn even though the port cannot flush", async () => {
    const ports = createTestPorts();
    ports.navigation.flushAvailable = false;
    const h = setup<string>({ commit: hangingCommit(), flushOn: [] }, ports);

    h.schedule("row:1");

    // The loss was accepted deliberately. A rule that fires on a decision already made is
    // one developers suppress instead of reading.
    expect(diagnostics.history().map((event) => event.code)).not.toContain("UX1007");
    await flushMicrotasks();
  });
});

describe("undoable machine: a commit that fails", () => {
  it("lands in failed with a normalised failure and keeps the batch", async () => {
    const onCommitFailed = vi.fn();
    const h = setup<string>({ commit: rejectingCommit({ status: 503 }), onCommitFailed });

    h.schedule("row:1");
    h.ports.clock.advance(6000);
    await flushMicrotasks();

    expect(h.api().state).toBe("failed");
    expect(h.api().failure?.kind).toBe("retryable");
    expect(h.api().items).toEqual(["row:1"]);
    expect(h.api().canUndo).toBe(false);
    expect(onCommitFailed).toHaveBeenCalledTimes(1);
  });

  it("announces the failure assertively, because the user was told it had happened", async () => {
    const h = setup<string>({ commit: rejectingCommit({ status: 500 }), onCommitFailed: () => {} });

    h.schedule("row:1");
    h.api().flush();
    await flushMicrotasks();

    const assertive = h.ports.announcer.at("assertive");
    expect(assertive).toHaveLength(1);
    expect(assertive[0]?.message).toBe(h.api().failure?.message);
  });

  it("retries the same batch from failed", async () => {
    let calls = 0;
    const commit = vi.fn((_items: readonly string[], _signal: AbortSignal) => {
      calls += 1;
      return calls === 1 ? Promise.reject({ status: 503 }) : Promise.resolve();
    });
    const h = setup<string>({ commit, onCommitFailed: () => {} });

    h.schedule("row:1");
    h.api().flush();
    await flushMicrotasks();
    expect(h.api().state).toBe("failed");

    h.api().flush();
    expect(h.api().state).toBe("committing");
    expect(commit).toHaveBeenLastCalledWith(["row:1"], expect.any(AbortSignal));

    await flushMicrotasks();
    expect(h.api().state).toBe("committed");
    expect(h.api().failure).toBeNull();
    expect(commit).toHaveBeenCalledTimes(2);
  });
});

describe("undoable machine: key serialisation", () => {
  it("holds the key for the whole window and releases it when the commit settles", async () => {
    const registry = createKeyRegistry();
    const h = setup<string>({ commit: resolvingCommit(), key: "invoice:7", registry });

    h.schedule("row:1");
    expect(registry.isHeld("invoice:7")).toBe(true);

    h.ports.clock.advance(5999);
    // Held across the window, not just across the request: an action writing this record
    // must not land in the middle of a deferred delete.
    expect(registry.isHeld("invoice:7")).toBe(true);

    h.ports.clock.advance(1);
    await flushMicrotasks();

    expect(h.api().state).toBe("committed");
    expect(registry.isHeld("invoice:7")).toBe(false);
  });

  it("releases the key on undo", async () => {
    const registry = createKeyRegistry();
    const h = setup<string>({ commit: resolvingCommit(), key: "invoice:7", registry });

    h.schedule("row:1");
    h.api().undo();

    expect(registry.isHeld("invoice:7")).toBe(false);
    await flushMicrotasks();
  });

  it("serialises two undoables that declare the same key", async () => {
    const registry = createKeyRegistry();
    const first = setup<string>({ commit: resolvingCommit(), key: "invoice:7", registry });
    const second = setup<string>({ commit: resolvingCommit(), key: "invoice:7", registry });

    first.schedule("row:1");
    second.schedule("row:2");

    // One holder, not two. The second window still opens, because refusing to schedule
    // would drop a change the user has already been shown as done.
    expect(registry.size()).toBe(1);
    expect(second.api().state).toBe("held");

    first.ports.clock.advance(6000);
    await flushMicrotasks();
    expect(registry.isHeld("invoice:7")).toBe(false);

    second.ports.clock.advance(6000);
    await flushMicrotasks();
    expect(second.api().state).toBe("committed");
    // The second machine never held the key, so settling cannot release someone else's.
    expect(registry.size()).toBe(0);
  });
});

describe("undoable machine: teardown", () => {
  it("leaves no timers and no leave subscription behind after a stop", async () => {
    const ports = createTestPorts();
    const commit = hangingCommit();
    let subscriptions = 0;
    const navigation = {
      ...ports.navigation,
      onLeave: (handler: (reason: "navigate" | "pagehide" | "manual") => void) => {
        subscriptions += 1;
        const dispose = ports.navigation.onLeave(handler);
        return () => {
          subscriptions -= 1;
          dispose();
        };
      },
    };
    const service = createService(createUndoableMachine<string>(), {
      props: { commit, altText: "Undo" },
      ports: { ...ports, navigation },
    });

    service.send({ type: "SCHEDULE", item: "row:1" });
    expect(ports.clock.pending()).toBe(1);
    expect(subscriptions).toBe(1);

    service.stop();

    expect(ports.clock.pending()).toBe(0);
    expect(subscriptions).toBe(0);

    ports.navigation.leave("pagehide");
    expect(commit).not.toHaveBeenCalled();
    await flushMicrotasks();
  });

  it("does not abort a commit that is already in flight", async () => {
    let captured: AbortSignal | undefined;
    const h = setup<string>({
      commit: (_items, signal) => {
        captured = signal;
        return new Promise<void>(() => {});
      },
    });

    h.schedule("row:1");
    h.api().flush();
    h.service.stop();

    // Unmounting mid-flight must not discard a delete the user was told had happened.
    expect(captured?.aborted).toBe(false);
    await flushMicrotasks();
  });
});

describe("undoable machine: announcements", () => {
  it("announces the open window politely, which is the only moment undo is reachable", async () => {
    const h = setup<string>({
      commit: hangingCommit(),
      announce: { scheduled: "Deleted. Undo available." },
    });

    h.schedule("row:1");

    expect(h.ports.announcer.announcements).toEqual([
      { message: "Deleted. Undo available.", politeness: "polite" },
    ]);
    await flushMicrotasks();
  });

  it("stays silent across the whole lifecycle when announcement is opted out", async () => {
    const h = setup<string>({ commit: resolvingCommit(), announce: false });

    h.schedule("row:1");
    h.ports.clock.advance(6000);
    await flushMicrotasks();

    expect(h.ports.announcer.announcements).toHaveLength(0);
  });
});

describe("undoable machine: attributes for the toast element", () => {
  it("reports the state, the merged count and the busy flag", async () => {
    const h = setup<string>({ commit: hangingCommit(), coalesce: "delete-rows" });

    expect(h.api().attrs["data-state"]).toBe("idle");
    expect(h.api().attrs["data-count"]).toBe("0");

    h.schedule("row:1");
    h.schedule("row:2");

    expect(h.api().attrs["data-state"]).toBe("held");
    expect(h.api().attrs["data-count"]).toBe("2");
    expect(h.api().attrs["aria-busy"]).toBe(false);

    h.api().flush();

    expect(h.api().attrs["data-state"]).toBe("committing");
    expect(h.api().attrs["aria-busy"]).toBe(true);
    await flushMicrotasks();
  });
});
