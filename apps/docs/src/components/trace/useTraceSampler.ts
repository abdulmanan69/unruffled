/**
 * Samples a running action into drawable segments.
 *
 * This is the oscilloscope half of the figure: a frame loop that reads the current phase and
 * records a boundary whenever it changes. Elapsed time is committed at most once per two per
 * cent of the window rather than per frame, so a figure costs about fifty renders a run
 * instead of several hundred.
 *
 * Shared by the marketing figure and the playground so there is one implementation of "what
 * did this run actually do", not two that can disagree.
 */

import { useEffect, useRef, useState } from "react";
import type { Phase, Segment } from "./types.js";

export interface TraceSample {
  readonly segments: readonly Segment[];
  /** Milliseconds since the run began. */
  readonly elapsed: number;
  /** Where the run finished, or null while it is still going. */
  readonly settledAt: number | null;
}

/** Number of elapsed-time commits across one full window. */
const COMMITS_PER_WINDOW = 50;

export function useTraceSampler(
  running: boolean,
  phase: Phase,
  windowMs: number,
  runToken: number,
): TraceSample {
  const [segments, setSegments] = useState<readonly Segment[]>([]);
  const [elapsed, setElapsed] = useState(0);
  const [settledAt, setSettledAt] = useState<number | null>(null);

  // The loop reads the live phase without having to re-subscribe when it changes.
  const phaseRef = useRef(phase);
  phaseRef.current = phase;

  const startRef = useRef<number | null>(null);

  useEffect(() => {
    if (!running) return;

    const start = performance.now();
    startRef.current = start;
    setSettledAt(null);
    setSegments([{ phase: phaseRef.current, from: 0, to: null }]);

    const bucketMs = Math.max(8, windowMs / COMMITS_PER_WINDOW);
    let lastBucket = -1;
    let frame = 0;

    const sample = (): void => {
      const now = performance.now() - start;
      const current = phaseRef.current;

      setSegments((previous) => {
        const last = previous[previous.length - 1];
        if (!last || last.phase === current) return previous;
        // Close the open segment at this exact reading and open the next one.
        return [...previous.slice(0, -1), { ...last, to: now }, { phase: current, from: now, to: null }];
      });

      const bucket = Math.floor(now / bucketMs);
      if (bucket !== lastBucket) {
        lastBucket = bucket;
        setElapsed(now);
      }

      frame = requestAnimationFrame(sample);
    };

    frame = requestAnimationFrame(sample);
    return () => {
      cancelAnimationFrame(frame);
    };
  }, [running, runToken, windowMs]);

  // Close the final segment once work has settled, so the trace stops growing.
  useEffect(() => {
    if (running || startRef.current === null) return;
    const at = performance.now() - startRef.current;
    setElapsed(at);
    setSettledAt(at);
    setSegments((previous) => {
      const last = previous[previous.length - 1];
      if (!last || last.to !== null) return previous;
      return [...previous.slice(0, -1), { ...last, to: at }];
    });
  }, [running]);

  return { segments, elapsed, settledAt };
}
