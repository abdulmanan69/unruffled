/**
 * Shared vocabulary for the timing figures.
 *
 * The phase list is finer-grained than the machine's own states, because the figure has to
 * distinguish two things the machine treats as one: `busy` with the affordance hidden, and
 * `busy` with it visible. That distinction is the entire subject of the figure.
 */

export type Phase = "idle" | "hidden" | "shown" | "settling" | "success" | "error" | "backoff";

export interface Segment {
  readonly phase: Phase;
  readonly from: number;
  /** Null while this is the segment currently being drawn. */
  readonly to: number | null;
}

export const PHASE_LABEL: Record<Phase, string> = {
  idle: "idle",
  hidden: "busy, nothing shown",
  shown: "busy, affordance up",
  settling: "settling",
  success: "success",
  error: "error",
  backoff: "waiting to retry",
};

/** Maps a machine state plus the affordance flag onto a drawable phase. */
export function toPhase(state: string, affordanceVisible: boolean): Phase {
  if (state === "busy") return affordanceVisible ? "shown" : "hidden";
  return state as Phase;
}
