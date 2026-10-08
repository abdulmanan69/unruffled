import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  connectAction,
  createActionMachine,
  createKeyRegistry,
  createService,
  type ActionApi,
  type ActionAttrs,
  type ActionContext,
  type ActionEvent,
  type ActionProps,
  type ActionStateValue,
  type Service,
} from "@unruffled/core";
import { diagnostics } from "@unruffled/core/diagnostics";
import { createTestPorts, flushMicrotasks, type TestPorts } from "@unruffled/testing";

type ActionService<T, A> = Service<
  ActionContext<T, A>,
  ActionProps<T, A>,
  ActionEvent<T, A>,
  ActionStateValue
>;

interface Harness<T> {
  ports: TestPorts;
  service: ActionService<T, void>;
  api(): ActionApi<T, void>;
  trigger(): void;
}

function setup<T>(
  props: Partial<ActionProps<T, void>> & Pick<ActionProps<T, void>, "run">,
  portOptions?: Parameters<typeof createTestPorts>[0],
): Harness<T> {
  const ports = createTestPorts(portOptions);
  const service = createService(createActionMachine<T, void>(), {
    props,
    ports,
  });
  return {
    ports,
    service,
    api: () => connectAction(service.getSnapshot(), service.send),
    trigger: () => {
      service.send({ type: "TRIGGER", args: undefined });
    },
  };
}

/** A promise that settles only when the fake clock reaches `atMs`. */
function resolvesAt<T>(ports: TestPorts, atMs: number, value: T): () => Promise<T> {
  return () =>
    new Promise<T>((resolve) => {
      ports.clock.after(atMs, () => {
        resolve(value);
      });
    });
}

function rejectsAt(ports: TestPorts, atMs: number, error: unknown): () => Promise<never> {
  return () =>
    new Promise<never>((_resolve, reject) => {
      ports.clock.after(atMs, () => {
        reject(error);
      });
    });
}

/** Never settles. Used wherever the test only cares about the in-flight state. */
function neverSettles<T>(): () => Promise<T> {
  return () => new Promise<T>(() => {});
}

beforeEach(() => {
  diagnostics.reset();
});

describe("action machine: pending visibility", () => {
  it("never shows a pending affordance for an action faster than the delay", async () => {
    const h = setup<string>({ run: () => Promise.resolve("ok") });

    h.trigger();
    expect(h.api().busy).toBe(true);
    // Work has started but nothing is shown yet: that is the whole point of the delay.
    expect(h.api().pending).toBe(false);

    await flushMicrotasks();

    expect(h.api().state).toBe("success");
    expect(h.api().pending).toBe(false);
    expect(h.api().data).toBe("ok");
  });

  it("shows the affordance once the delay elapses", async () => {
    const h = setup<string>({ run: neverSettles<string>() });

    h.trigger();
    h.ports.clock.advance(149);
    expect(h.api().pending).toBe(false);

    h.ports.clock.advance(1);
    expect(h.api().pending).toBe(true);
    expect(h.api().attrs["data-pending"]).toBe("");

    await flushMicrotasks();
  });

  it("holds a shown affordance for the minimum duration so it cannot flicker", async () => {
    const ports = createTestPorts();
    const service = createService(createActionMachine<string, void>(), {
      props: { run: resolvesAt(ports, 200, "saved") },
      ports,
    });
    const api = (): ActionApi<string, void> => connectAction(service.getSnapshot(), service.send);

    service.send({ type: "TRIGGER", args: undefined });

    ports.clock.advance(150);
    expect(api().pending).toBe(true);

    // Request settles at 200ms, only 50ms after the affordance appeared.
    ports.clock.advance(50);
    await flushMicrotasks();
    expect(api().state).toBe("settling");
    expect(api().pending).toBe(true);

    ports.clock.advance(349);
    expect(api().state).toBe("settling");

    ports.clock.advance(1);
    // Visible for exactly 400ms: 150 through 550.
    expect(api().state).toBe("success");
    expect(api().pending).toBe(false);
  });

  it("skips the delay entirely when it is zero", async () => {
    const h = setup<string>({ run: neverSettles<string>(), pending: { delay: 0 } });
    h.trigger();
    expect(h.api().pending).toBe(true);
    await flushMicrotasks();
  });
});

describe("action machine: duplicate submit guard", () => {
  it("swallows a second trigger on the same key, synchronously", async () => {
    const run = vi.fn(neverSettles<string>());
    const h = setup<string>({ run, key: "customer:42" });

    // All three sends happen in one synchronous block, exactly as a double click does. No
    // render, no await, no pending flag has had a chance to propagate anywhere.
    h.trigger();
    h.trigger();
    h.trigger();

    expect(run).toHaveBeenCalledTimes(1);
    expect(h.api().state).toBe("busy");
    await flushMicrotasks();
  });

  it("serialises two independent machines that declare the same key", async () => {
    const registry = createKeyRegistry();
    const runA = vi.fn(neverSettles<string>());
    const runB = vi.fn(neverSettles<string>());

    const a = setup<string>({ run: runA, key: "invoice:7", registry });
    const b = setup<string>({ run: runB, key: "invoice:7", registry });

    a.trigger();
    b.trigger();

    expect(runA).toHaveBeenCalledTimes(1);
    // The second component never learned about the first, and still did not fire.
    expect(runB).not.toHaveBeenCalled();
    expect(b.api().state).toBe("idle");
    await flushMicrotasks();
  });

  it("releases the key once the request settles, so the next trigger is allowed", async () => {
    const registry = createKeyRegistry();
    const run = vi.fn(() => Promise.resolve("ok"));
    const h = setup<string>({ run, key: "customer:42", registry });

    h.trigger();
    await flushMicrotasks();
    expect(registry.isHeld("customer:42")).toBe(false);

    h.trigger();
    await flushMicrotasks();
    expect(run).toHaveBeenCalledTimes(2);
  });

  it("reports UX1002 when an unkeyed action is triggered again while in flight", async () => {
    const h = setup<string>({ run: neverSettles<string>() });

    h.trigger();
    h.trigger();

    expect(diagnostics.history().map((event) => event.code)).toContain("UX1002");
    await flushMicrotasks();
  });
});

describe("action machine: cancellation", () => {
  it("aborts the in-flight request and returns to idle without reporting a failure", async () => {
    let captured: AbortSignal | undefined;
    const h = setup<string>({
      run: (_args, signal) => {
        captured = signal;
        return new Promise<string>(() => {});
      },
    });

    h.trigger();
    h.ports.clock.advance(10);
    h.api().cancel();

    expect(captured?.aborted).toBe(true);
    expect(h.api().state).toBe("idle");
    expect(h.api().failure).toBeNull();
    await flushMicrotasks();
  });

  it("aborts when the service is stopped, which is what unmounting does", async () => {
    let captured: AbortSignal | undefined;
    const h = setup<string>({
      run: (_args, signal) => {
        captured = signal;
        return new Promise<string>(() => {});
      },
    });

    h.trigger();
    h.service.stop();

    expect(captured?.aborted).toBe(true);
    await flushMicrotasks();
  });

  it("treats an abort rejection as a cancellation rather than a failure", async () => {
    const abortError = Object.assign(new Error("aborted"), { name: "AbortError" });
    const h = setup<string>({ run: () => Promise.reject(abortError) });

    h.trigger();
    await flushMicrotasks();

    expect(h.api().state).toBe("idle");
    expect(h.api().failure).toBeNull();
  });

  it("leaves no timers behind after a stop", async () => {
    const h = setup<string>({ run: neverSettles<string>() });
    h.trigger();
    expect(h.ports.clock.pending()).toBeGreaterThan(0);

    h.service.stop();
    expect(h.ports.clock.pending()).toBe(0);
    await flushMicrotasks();
  });
});

describe("action machine: failure classification", () => {
  it("classifies a 403 as forbidden and refuses to offer a retry", async () => {
    const h = setup<string>({ run: () => Promise.reject({ status: 403 }), onError: () => {} });

    h.trigger();
    await flushMicrotasks();

    expect(h.api().state).toBe("error");
    expect(h.api().failure?.kind).toBe("forbidden");
    expect(h.api().canRetry).toBe(false);
  });

  it("classifies a 429 and exposes the Retry-After delay", async () => {
    const h = setup<string>({
      run: () => Promise.reject({ status: 429, headers: { "retry-after": "120" } }),
      onError: () => {},
    });

    h.trigger();
    await flushMicrotasks();

    expect(h.api().failure?.kind).toBe("rateLimited");
    expect(h.api().failure?.retryAfterMs).toBe(120_000);
    expect(h.api().canRetry).toBe(true);
  });

  it("pulls field errors out of an RFC 9457 body and calls it validation", async () => {
    const h = setup<string>({
      run: () =>
        Promise.reject({
          status: 422,
          body: { title: "Unprocessable", errors: { email: ["is already taken"] } },
        }),
      onError: () => {},
    });

    h.trigger();
    await flushMicrotasks();

    expect(h.api().failure?.kind).toBe("validation");
    expect(h.api().failure?.fields).toEqual([{ path: "email", message: "is already taken" }]);
    // A validation failure belongs on the form, so a retry button would be wrong.
    expect(h.api().canRetry).toBe(false);
  });

  it("retries automatically with backoff and stops at the configured attempt count", async () => {
    const ports = createTestPorts();
    const run = vi.fn(rejectsAt(ports, 10, { status: 503 }));
    const service = createService(createActionMachine<string, void>(), {
      props: { run, onError: () => {}, retry: { attempts: 1, backoff: { baseMs: 100, jitter: 0 } } },
      ports,
    });
    const api = (): ActionApi<string, void> => connectAction(service.getSnapshot(), service.send);

    service.send({ type: "TRIGGER", args: undefined });
    ports.clock.advance(10);
    await flushMicrotasks();

    expect(api().state).toBe("backoff");
    expect(api().attempt).toBe(1);
    expect(api().retryAt).toBe(110);

    ports.clock.advance(100);
    expect(api().state).toBe("busy");
    expect(api().attempt).toBe(2);

    ports.clock.advance(10);
    await flushMicrotasks();

    expect(api().state).toBe("error");
    expect(run).toHaveBeenCalledTimes(2);
  });

  it("does not auto-retry a failure that cannot succeed on retry", async () => {
    const run = vi.fn(() => Promise.reject({ status: 403 }));
    const h = setup<string>({ run, onError: () => {}, retry: { attempts: 3 } });

    h.trigger();
    await flushMicrotasks();

    expect(h.api().state).toBe("error");
    expect(run).toHaveBeenCalledTimes(1);
  });

  it("allows a manual retry from the error state", async () => {
    let calls = 0;
    const h = setup<string>({
      run: () => {
        calls += 1;
        return calls === 1 ? Promise.reject({ status: 500 }) : Promise.resolve("ok");
      },
      onError: () => {},
    });

    h.trigger();
    await flushMicrotasks();
    expect(h.api().state).toBe("error");

    h.api().retry();
    await flushMicrotasks();
    expect(h.api().state).toBe("success");
    expect(h.api().data).toBe("ok");
  });

  it("reports UX1004 when nothing is listening for the failure", async () => {
    const h = setup<string>({ run: () => Promise.reject({ status: 500 }) });

    h.trigger();
    await flushMicrotasks();

    expect(diagnostics.history().map((event) => event.code)).toContain("UX1004");
  });
});

describe("action machine: announcements", () => {
  it("announces success politely, exactly once", async () => {
    const h = setup<string>({ run: () => Promise.resolve("ok"), announce: { success: "Customer saved" } });

    h.trigger();
    await flushMicrotasks();

    expect(h.ports.announcer.announcements).toEqual([{ message: "Customer saved", politeness: "polite" }]);
  });

  it("announces a failure assertively, because the user may have moved on", async () => {
    const h = setup<string>({ run: () => Promise.reject({ status: 500 }), onError: () => {} });

    h.trigger();
    await flushMicrotasks();

    const assertive = h.ports.announcer.at("assertive");
    expect(assertive).toHaveLength(1);
    expect(assertive[0]?.message).toBe("That did not go through. Try again.");
  });

  it("stays silent when announcement is opted out", async () => {
    const h = setup<string>({ run: () => Promise.resolve("ok"), announce: false });

    h.trigger();
    await flushMicrotasks();

    expect(h.ports.announcer.announcements).toHaveLength(0);
  });

  it("reports UX1003 when a long wait finished with no live region mounted", async () => {
    const ports = createTestPorts({ live: false });
    const service = createService(createActionMachine<string, void>(), {
      props: { run: resolvesAt(ports, 500, "ok"), pending: { delay: 0, min: 0 } },
      ports,
    });

    service.send({ type: "TRIGGER", args: undefined });
    ports.clock.advance(500);
    await flushMicrotasks();

    const reported = diagnostics.history().find((event) => event.code === "UX1003");
    expect(reported).toBeDefined();
    expect(reported?.data?.["visibleForMs"]).toBe(500);
  });

  it("does not report UX1003 for a wait below the threshold", async () => {
    const ports = createTestPorts({ live: false });
    const service = createService(createActionMachine<string, void>(), {
      props: { run: resolvesAt(ports, 100, "ok"), pending: { delay: 0, min: 0 } },
      ports,
    });

    service.send({ type: "TRIGGER", args: undefined });
    ports.clock.advance(100);
    await flushMicrotasks();

    expect(diagnostics.history().map((event) => event.code)).not.toContain("UX1003");
  });
});

describe("action machine: destructive actions", () => {
  it("reports UX1001 for a destructive action with no recovery path", async () => {
    const h = setup<void>({ run: () => Promise.resolve(), destructive: true });

    h.trigger();
    await flushMicrotasks();

    const reported = diagnostics.history().find((event) => event.code === "UX1001");
    expect(reported).toBeDefined();
    expect(reported?.rule.severity).toBe("error");
  });

  it("stays quiet when the action is marked reversible", async () => {
    const h = setup<void>({ run: () => Promise.resolve(), destructive: true, reversible: true });

    h.trigger();
    await flushMicrotasks();

    expect(diagnostics.history().map((event) => event.code)).not.toContain("UX1001");
  });
});

describe("action machine: attributes for the trigger element", () => {
  it("uses aria-disabled rather than disabled, so focus is never thrown away", async () => {
    const h = setup<string>({ run: neverSettles<string>() });

    expect(h.api().attrs["aria-disabled"]).toBeUndefined();
    expect(h.api().attrs["aria-busy"]).toBe(false);

    h.trigger();

    expect(h.api().attrs["aria-disabled"]).toBe(true);
    expect(h.api().attrs["aria-busy"]).toBe(true);
    // There is no `disabled` key at all: a disabled element would leave the tab order.
    expect(Object.keys(h.api().attrs)).not.toContain("disabled");
    await flushMicrotasks();
  });

  it("exposes the attempt number only once retrying", async () => {
    const ports = createTestPorts();
    const service = createService(createActionMachine<string, void>(), {
      props: {
        run: rejectsAt(ports, 10, { status: 503 }),
        onError: () => {},
        retry: { attempts: 2, backoff: { baseMs: 50, jitter: 0 } },
      },
      ports,
    });
    const attrs = (): ActionAttrs => connectAction(service.getSnapshot(), service.send).attrs;

    service.send({ type: "TRIGGER", args: undefined });
    expect(attrs()["data-attempt"]).toBeUndefined();

    ports.clock.advance(10);
    await flushMicrotasks();
    ports.clock.advance(50);

    expect(attrs()["data-attempt"]).toBe("2");
    await flushMicrotasks();
  });

  it("reports the raw machine state for styling the full lifecycle", async () => {
    const h = setup<string>({ run: () => Promise.resolve("ok") });

    expect(h.api().attrs["data-state"]).toBe("idle");
    h.trigger();
    expect(h.api().attrs["data-state"]).toBe("busy");
    await flushMicrotasks();
    expect(h.api().attrs["data-state"]).toBe("success");
  });
});

describe("action machine: result lifecycle", () => {
  it("returns to idle after the configured reset delay", async () => {
    const h = setup<string>({ run: () => Promise.resolve("ok"), resetAfterMs: 2000 });

    h.trigger();
    await flushMicrotasks();
    expect(h.api().state).toBe("success");

    h.ports.clock.advance(1999);
    expect(h.api().state).toBe("success");

    h.ports.clock.advance(1);
    expect(h.api().state).toBe("idle");
    expect(h.api().data).toBeNull();
  });

  it("keeps the result indefinitely by default", async () => {
    const h = setup<string>({ run: () => Promise.resolve("ok") });

    h.trigger();
    await flushMicrotasks();
    h.ports.clock.advance(60_000);

    expect(h.api().state).toBe("success");
    expect(h.api().data).toBe("ok");
  });

  it("reads the latest run function, so a re-rendered closure is never stale", async () => {
    const h = setup<string>({ run: () => Promise.resolve("first") });

    h.service.setProps({ run: () => Promise.resolve("second") });
    h.trigger();
    await flushMicrotasks();

    expect(h.api().data).toBe("second");
  });

  it("passes trigger arguments through to run", async () => {
    const ports = createTestPorts();
    const run = vi.fn((id: string) => Promise.resolve(`deleted:${id}`));
    const service = createService(createActionMachine<string, string>(), { props: { run }, ports });

    service.send({ type: "TRIGGER", args: "customer:42" });
    await flushMicrotasks();

    expect(run).toHaveBeenCalledWith("customer:42", expect.any(AbortSignal));
    expect(connectAction(service.getSnapshot(), service.send).data).toBe("deleted:customer:42");
  });

  it("calls onSuccess and onSettled, and not onError", async () => {
    const onSuccess = vi.fn();
    const onError = vi.fn();
    const onSettled = vi.fn();
    const h = setup<string>({ run: () => Promise.resolve("ok"), onSuccess, onError, onSettled });

    h.trigger();
    await flushMicrotasks();

    expect(onSuccess).toHaveBeenCalledWith("ok");
    expect(onSettled).toHaveBeenCalledTimes(1);
    expect(onError).not.toHaveBeenCalled();
  });
});
