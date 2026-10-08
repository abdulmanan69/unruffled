/**
 * The drawn figure: axis, thresholds, segments, outcome marker and legend.
 *
 * Presentational only. It is handed segments and renders them, which is what lets the
 * marketing figure and the playground share one picture rather than two that drift apart.
 *
 * The screen-reader description is a sentence, not a label. A figure whose entire content is
 * spatial has to be described, and "timing chart" tells a non-sighted reader nothing about
 * where the thresholds fell.
 */

import { PHASE_LABEL, type Phase, type Segment } from "./types.js";
import "../../styles/trace.css";

export interface TraceLaneProps {
  readonly segments: readonly Segment[];
  readonly elapsed: number;
  readonly settledAt: number | null;
  readonly windowMs: number;
  /** Omit both thresholds to draw the hand-rolled comparison. */
  readonly pendingDelayMs?: number;
  readonly pendingMinMs?: number;
  readonly outcome: "success" | "failure";
  readonly axisStepMs?: number;
}

export default function TraceLane({
  segments,
  elapsed,
  settledAt,
  windowMs,
  pendingDelayMs,
  pendingMinMs,
  outcome,
  axisStepMs = 250,
}: TraceLaneProps) {
  const pct = (ms: number): number => Math.min(100, (ms / windowMs) * 100);

  const ticks: number[] = [];
  for (let at = 0; at <= windowMs; at += axisStepMs) ticks.push(at);

  const drawn = segments.filter((segment) => segment.phase !== "idle");
  const showThresholds = pendingDelayMs !== undefined && pendingMinMs !== undefined;

  const legend: Phase[] = showThresholds
    ? ["hidden", "shown", "settling", outcome === "failure" ? "error" : "success"]
    : ["shown", outcome === "failure" ? "error" : "success"];

  return (
    <div className="trace__plot">
      <div className="trace__axis" aria-hidden="true">
        {ticks.map((at) => (
          <span key={at} className="trace__tick" style={{ left: `${String(pct(at))}%` }}>
            <span className="trace__tick-label">{String(at)}</span>
          </span>
        ))}

        {showThresholds && (
          <>
            <span
              className="trace__marker trace__marker--delay"
              style={{ left: `${String(pct(pendingDelayMs))}%` }}
            >
              delay {String(pendingDelayMs)}
            </span>
            <span
              className="trace__marker trace__marker--min"
              style={{ left: `${String(pct(pendingDelayMs + pendingMinMs))}%` }}
            >
              min {String(pendingMinMs)}
            </span>
          </>
        )}
      </div>

      <div className="trace__lane">
        {showThresholds && (
          <>
            <span
              className="trace__threshold trace__threshold--delay"
              style={{ left: `${String(pct(pendingDelayMs))}%` }}
              aria-hidden="true"
            />
            <span
              className="trace__threshold trace__threshold--min"
              style={{ left: `${String(pct(pendingDelayMs + pendingMinMs))}%` }}
              aria-hidden="true"
            />
          </>
        )}

        {drawn.map((segment, index) => {
          const end = segment.to ?? elapsed;
          const width = Math.max(0, pct(end) - pct(segment.from));
          return (
            <span
              key={`${String(index)}-${segment.phase}`}
              className={`trace__segment trace__segment--${segment.phase}`}
              style={{ left: `${String(pct(segment.from))}%`, width: `${String(width)}%` }}
              title={PHASE_LABEL[segment.phase]}
            />
          );
        })}

        {settledAt !== null && (
          <span
            className={`trace__end trace__end--${outcome === "failure" ? "error" : "success"}`}
            style={{ left: `${String(pct(settledAt))}%` }}
            aria-hidden="true"
          />
        )}
      </div>

      <p className="sr-only" role="status">
        {drawn.length === 0
          ? "Trace is empty. Activate the button to record a run."
          : drawn
              .map(
                (segment) =>
                  `${PHASE_LABEL[segment.phase]} from ${String(Math.round(segment.from))} to ${String(
                    Math.round(segment.to ?? elapsed),
                  )} milliseconds`,
              )
              .join(", ")}
      </p>

      <ul className="trace__legend">
        {legend.map((key) => (
          <li key={key}>
            <span className={`trace__swatch trace__swatch--${key}`} aria-hidden="true" />
            <span className="trace__legend-label">{PHASE_LABEL[key]}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
