/**
 * A live countdown to a clock reading.
 *
 * Shared by `useAction` (automatic retry) and `useFailure` (`Retry-After`). Both need the
 * same thing and it has three non-obvious requirements.
 *
 * **It takes a target, not a duration.** A duration is stale the instant it is read, and a
 * component holding one has to decide what to do when a render is delayed. A clock reading
 * is absolute, so the remaining time is always derived correctly.
 *
 * **State is a tick counter, not the value.** The remaining time is computed during render,
 * where it is current by construction. The only `setState` is inside the frame
 * subscription's callback, which is the shape React intends: subscribe to an external
 * system, re-render when it reports a change. Storing the value in state instead would mean
 * writing it from an effect body and cascading a second render on every update.
 *
 * **It is bucketed.** Driving this straight off the frame port would re-render sixty times a
 * second to animate a number that changes ten times a second. The subscription also only
 * exists while a countdown is pending, so an idle component costs nothing.
 *
 * Under reduced motion the bucket widens to a second. The number stays accurate and keeps
 * counting: reduction means less animation, not less information. Freezing or hiding the
 * countdown would withhold the one thing a rate-limited user needs to know.
 */

import { useEffect, useState } from "react";
import type { Ports } from "@unruffled/core";

const TICK_MS = 100;
const TICK_MS_REDUCED = 1000;

export function useCountdown(targetAt: number | null, ports: Ports, reduced: boolean): number | null {
  const [, bumpTick] = useState(0);

  useEffect(() => {
    if (targetAt === null) return;

    const granularity = reduced ? TICK_MS_REDUCED : TICK_MS;
    let lastBucket = Number.NaN;

    return ports.clock.frame(() => {
      const bucket = Math.floor(Math.max(0, targetAt - ports.clock.now()) / granularity);
      if (bucket === lastBucket) return;
      lastBucket = bucket;
      bumpTick((tick) => tick + 1);
    });
  }, [targetAt, ports, reduced]);

  if (targetAt === null) return null;
  // Reading the clock during render is what makes this value correct rather than one tick
  // behind. It is the one impurity the pattern requires, and it is confined to this line.
  return Math.max(0, Math.round(targetAt - ports.clock.now()));
}
