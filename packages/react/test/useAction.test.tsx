import { act, type ReactNode } from "react";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { diagnostics } from "@unruffled/core/diagnostics";
import { createTestPorts, type TestPorts } from "@unruffled/testing";
import { useAction, type UseActionOptions } from "../src/action.js";
import { Announcer } from "../src/announce.js";
import { resetLiveRegions } from "../src/adapter/liveRegion.js";

/**
 * A button wired to `useAction`, which is the whole public surface under test.
 *
 * The label is driven off `pending` rather than a `disabled` attribute, because that is the
 * pattern the library exists to make correct.
 */
function SaveButton<T>({
  run,
  options,
  as = "button",
}: {
  run: (args: void, signal: AbortSignal) => Promise<T>;
  options?: UseActionOptions<T, void>;
  as?: "button" | "div";
}): ReactNode {
  const save = useAction(run, options);
  const label = save.pending ? "Saving" : "Save";

  if (as === "div") {
    // A non-button element given a button role, to prove keyboard activation is synthesised
    // only where the platform does not already provide it.
    return (
      <div {...save.triggerProps} role="button" tabIndex={0}>
        {label}
      </div>
    );
  }
  return <button {...save.triggerProps}>{label}</button>;
}

/** Ports are created once per test and passed by stable identity, as a real app would. */
function setup(): { ports: TestPorts; options: UseActionOptions<string, void> } {
  const ports = createTestPorts();
  return { ports, options: { ports } };
}

/** Advancing the fake clock drives state updates, so it has to run inside `act`. */
function advance(ports: TestPorts, ms: number): void {
  act(() => {
    ports.clock.advance(ms);
  });
}

const never =
  <T,>(): (() => Promise<T>) =>
  () =>
    new Promise<T>(() => {});

beforeEach(() => {
  diagnostics.reset();
  resetLiveRegions();
});

describe("useAction: the trigger element", () => {
  it("is never disabled, and stays focusable while work is in flight", async () => {
    const user = userEvent.setup();
    const { ports, options } = setup();
    render(<SaveButton run={never<string>()} options={options} />);

    const button = screen.getByRole("button");
    expect(button).not.toBeDisabled();
    expect(button).not.toHaveAttribute("aria-disabled");
    expect(button).toHaveAttribute("aria-busy", "false");

    await user.click(button);

    // Still reachable, still focused, and announced as unavailable rather than removed.
    expect(button).not.toBeDisabled();
    expect(button).toHaveAttribute("aria-disabled", "true");
    expect(button).toHaveAttribute("aria-busy", "true");
    expect(button).toHaveFocus();
    expect(ports.clock.pending()).toBeGreaterThan(0);
  });

  it("exposes the raw lifecycle state for styling", async () => {
    const user = userEvent.setup();
    const { options } = setup();
    render(<SaveButton run={() => Promise.resolve("ok")} options={options} />);

    const button = screen.getByRole("button");
    expect(button).toHaveAttribute("data-state", "idle");

    await user.click(button);
    await waitFor(() => {
      expect(button).toHaveAttribute("data-state", "success");
    });
  });

  it("shows the pending affordance only after the delay", async () => {
    const user = userEvent.setup();
    const { ports, options } = setup();
    render(<SaveButton run={never<string>()} options={options} />);

    const button = screen.getByRole("button");
    await user.click(button);

    expect(button).toHaveTextContent("Save");
    expect(button).not.toHaveAttribute("data-pending");

    advance(ports, 150);

    expect(button).toHaveTextContent("Saving");
    expect(button).toHaveAttribute("data-pending", "");
  });
});

describe("useAction: pointer and keyboard activation", () => {
  it("runs the action once for a double click", async () => {
    const user = userEvent.setup();
    const run = vi.fn(never<string>());
    const { options } = setup();
    render(<SaveButton run={run} options={options} />);

    await user.dblClick(screen.getByRole("button"));

    expect(run).toHaveBeenCalledTimes(1);
  });

  it("activates on Enter", async () => {
    const user = userEvent.setup();
    const run = vi.fn(never<string>());
    const { options } = setup();
    render(<SaveButton run={run} options={options} />);

    await user.tab();
    expect(screen.getByRole("button")).toHaveFocus();
    await user.keyboard("{Enter}");

    expect(run).toHaveBeenCalledTimes(1);
  });

  it("activates on Space", async () => {
    const user = userEvent.setup();
    const run = vi.fn(never<string>());
    const { options } = setup();
    render(<SaveButton run={run} options={options} />);

    await user.tab();
    await user.keyboard("[Space]");

    expect(run).toHaveBeenCalledTimes(1);
  });

  it("refuses Enter and Space while work is in flight", async () => {
    const user = userEvent.setup();
    const run = vi.fn(never<string>());
    const { options } = setup();
    render(<SaveButton run={run} options={options} />);

    await user.tab();
    await user.keyboard("{Enter}");
    await user.keyboard("{Enter}");
    await user.keyboard("[Space]");

    expect(run).toHaveBeenCalledTimes(1);
  });

  it("synthesises keyboard activation for a non-button element, exactly once", async () => {
    const user = userEvent.setup();
    const run = vi.fn(never<string>());
    const { options } = setup();
    render(<SaveButton run={run} options={options} as="div" />);

    await user.tab();
    expect(screen.getByRole("button")).toHaveFocus();
    await user.keyboard("{Enter}");

    // A div does not turn Enter into a click, so the hook has to. It must not then fire a
    // second time from a click the platform never sent.
    expect(run).toHaveBeenCalledTimes(1);
  });
});

describe("useAction: cross-component contention", () => {
  it("rejects a second trigger for the same resource key from a different component", async () => {
    const user = userEvent.setup();
    const ports = createTestPorts();
    const runA = vi.fn(never<string>());
    const runB = vi.fn(never<string>());

    render(
      <>
        <SaveButton run={runA} options={{ ports, key: "customer:42" }} />
        <SaveButton run={runB} options={{ ports, key: "customer:42" }} />
      </>,
    );

    const [first, second] = screen.getAllByRole("button");
    await user.click(first!);
    await user.click(second!);

    expect(runA).toHaveBeenCalledTimes(1);
    // Neither component knows the other exists. The key is what makes them contend.
    expect(runB).not.toHaveBeenCalled();
  });
});

describe("useAction: announcements reach a real live region", () => {
  it("writes a success to the polite region", async () => {
    const user = userEvent.setup();
    render(
      <>
        <Announcer />
        <SaveButton run={() => Promise.resolve("ok")} options={{ announce: { success: "Customer saved" } }} />
      </>,
    );

    await user.click(screen.getByRole("button"));

    await waitFor(() => {
      expect(document.querySelector('[aria-live="polite"]')).toHaveTextContent("Customer saved");
    });
    // The failure region stays empty: a success must not interrupt.
    expect(screen.getByRole("alert")).toHaveTextContent("");
  });

  it("writes a failure to the assertive region", async () => {
    const user = userEvent.setup();
    render(
      <>
        <Announcer />
        <SaveButton run={() => Promise.reject({ status: 500 })} options={{ onError: () => {} }} />
      </>,
    );

    await user.click(screen.getByRole("button"));

    await waitFor(() => {
      expect(screen.getByRole("alert")).toHaveTextContent("That did not go through. Try again.");
    });
  });

  it("reports UX1003 when a long wait finished with no live region mounted", async () => {
    const user = userEvent.setup();
    const ports = createTestPorts();
    // Simulates an app that never rendered <Announcer />, which is exactly what UX1003 is for.
    ports.announcer.setLive(false);
    let settle: (value: string) => void = () => {};
    const run = (): Promise<string> =>
      new Promise<string>((resolve) => {
        settle = resolve;
      });

    render(<SaveButton run={run} options={{ ports, pending: { delay: 0, min: 0 } }} />);
    await user.click(screen.getByRole("button"));

    advance(ports, 500);
    await act(async () => {
      settle("ok");
      await Promise.resolve();
    });

    expect(diagnostics.history().map((event) => event.code)).toContain("UX1003");
  });
});

describe("useAction: failure handling", () => {
  it("classifies the failure and reports whether a retry is honest", async () => {
    const user = userEvent.setup();
    const onError = vi.fn();
    render(<SaveButton run={() => Promise.reject({ status: 403 })} options={{ onError }} />);

    await user.click(screen.getByRole("button"));

    await waitFor(() => {
      expect(onError).toHaveBeenCalledTimes(1);
    });
    const failure = onError.mock.calls[0]?.[0] as { kind: string; canRetry: boolean };
    expect(failure.kind).toBe("forbidden");
    expect(failure.canRetry).toBe(false);
  });

  it("exposes a live countdown before an automatic retry", async () => {
    const user = userEvent.setup();
    const ports = createTestPorts();

    function WithCountdown(): ReactNode {
      const save = useAction(() => Promise.reject({ status: 503 }), {
        ports,
        onError: () => {},
        retry: { attempts: 1, backoff: { baseMs: 1000, jitter: 0 } },
      });
      return (
        <>
          <button {...save.triggerProps}>Save</button>
          <output>{save.retryInMs === null ? "none" : String(Math.ceil(save.retryInMs / 1000))}</output>
        </>
      );
    }

    render(<WithCountdown />);
    expect(screen.getByRole("status")).toHaveTextContent("none");

    await user.click(screen.getByRole("button"));
    await waitFor(() => {
      expect(screen.getByRole("status")).toHaveTextContent("1");
    });
  });
});

describe("useAction: teardown", () => {
  it("aborts the in-flight request when the component unmounts", async () => {
    const user = userEvent.setup();
    const { options } = setup();
    let captured: AbortSignal | undefined;

    const { unmount } = render(
      <SaveButton
        run={(_args, signal) => {
          captured = signal;
          return new Promise<string>(() => {});
        }}
        options={options}
      />,
    );

    await user.click(screen.getByRole("button"));
    expect(captured?.aborted).toBe(false);

    unmount();
    // The stop is deferred by a microtask so a Strict Mode remount can cancel it.
    await act(async () => {
      await Promise.resolve();
    });

    expect(captured?.aborted).toBe(true);
  });

  it("keeps the in-flight request across a re-render", async () => {
    const user = userEvent.setup();
    const { options } = setup();
    const run = vi.fn(never<string>());

    const { rerender } = render(<SaveButton run={run} options={options} />);
    await user.click(screen.getByRole("button"));
    rerender(<SaveButton run={run} options={options} />);

    await act(async () => {
      await Promise.resolve();
    });

    expect(screen.getByRole("button")).toHaveAttribute("aria-busy", "true");
    expect(run).toHaveBeenCalledTimes(1);
  });
});
