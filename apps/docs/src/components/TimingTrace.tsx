/**
 * The timing trace.
 *
 * This is the site's central figure and its central argument. A spinner is normally
 * discussed as a styling question; it is actually a timing question, and the only way to
 * make that concrete is to draw the timeline and label the thresholds.
 *
 * Press the button and the trace draws in real time. Before the delay threshold nothing is
 * shown, so a fast action never flashes. Once something is shown it stays for the minimum
 * duration, so a slow-ish action never flickers. Both numbers are configurable; both are
 * wrong to omit.
 *
 * The sampling and the drawing live in `./trace`, shared with the playground.
 */

import { useState } from "react";
import { useAction } from "@unruffled/react";
import TraceLane from "./trace/TraceLane.js";
import { useTraceSampler } from "./trace/useTraceSampler.js";
import { toPhase } from "./trace/types.js";

export interface TimingTraceProps {
  /** How long the simulated request takes. */
  readonly latencyMs?: number;
  readonly outcome?: "success" | "failure";
  /** Width of the time axis in milliseconds. */
  readonly windowMs?: number;
  readonly pendingDelayMs?: number;
  readonly pendingMinMs?: number;
  readonly buttonLabel?: string;
  /**
   * Draws the trace without the library, for the side-by-side comparison.
   *
   * The hand-rolled version flips a boolean: the affordance appears the instant work starts
   * and disappears the instant it ends, which is what produces a flash on a fast action.
   */
  readonly naive?: boolean;
}

export default function TimingTrace({
  latencyMs = 700,
  outcome = "success",
  windowMs = 1200,
  pendingDelayMs = 150,
  pendingMinMs = 400,
  buttonLabel = "Save customer",
  naive = false,
}: TimingTraceProps) {
  const [runToken, setRunToken] = useState(0);

  const save = useAction(
    (_args: void, signal: AbortSignal) =>
      new Promise<string>((resolve, reject) => {
        const timer = setTimeout(() => {
          if (outcome === "failure") reject({ status: 503 });
          else resolve("saved");
        }, latencyMs);
        signal.addEventListener("abort", () => {
          clearTimeout(timer);
        });
      }),
    {
      pending: naive ? { delay: 0, min: 0 } : { delay: pendingDelayMs, min: pendingMinMs },
      announce: { success: "Customer saved", error: "Save failed" },
      onError: () => {
        // Surfaced by the trace itself. Declaring it keeps UX1004 quiet for a figure whose
        // whole purpose is to show failures.
      },
      resetAfterMs: false,
    },
  );

  const phase = toPhase(save.state, save.pending);
  const sample = useTraceSampler(save.busy, phase, windowMs, runToken);

  return (
    <div className="trace">
      <div className="trace__controls">
        <button
          {...save.getTriggerProps({
            onClick: () => {
              setRunToken((token) => token + 1);
            },
          })}
          className="btn btn--primary trace__btn"
        >
          {save.pending ? <span className="spinner" aria-hidden="true" /> : null}
          {save.pending ? "Saving" : buttonLabel}
        </button>

        <dl className="trace__readout">
          <div>
            <dt className="label">state</dt>
            <dd className={`trace__value trace__value--${phase}`}>{save.state}</dd>
          </div>
          <div>
            <dt className="label">elapsed</dt>
            <dd className="trace__value">{Math.round(sample.elapsed)}ms</dd>
          </div>
          <div>
            <dt className="label">affordance</dt>
            <dd className="trace__value">{save.pending ? "visible" : "hidden"}</dd>
          </div>
        </dl>
      </div>

      <TraceLane
        segments={sample.segments}
        elapsed={sample.elapsed}
        settledAt={sample.settledAt}
        windowMs={windowMs}
        outcome={outcome}
        {...(naive ? {} : { pendingDelayMs, pendingMinMs })}
      />
    </div>
  );
}
