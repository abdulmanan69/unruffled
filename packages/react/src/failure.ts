/**
 * `useFailure` — a failure you can actually build an interface from.
 *
 * `err.message` is not an error UX. What the user needs is a decision: can this be tried
 * again, is it my input that is wrong, am I signed out, how long must I wait. Those are four
 * different interfaces, and choosing between them is the work this hook does.
 *
 * ```tsx
 * const failure = useFailure(save.failure);
 *
 * {failure?.kind === "validation" && <FieldErrors errors={failure.fields} />}
 * {failure?.canRetryNow && <button onClick={save.retry}>Try again</button>}
 * {failure?.retryInMs ? `Try again in ${Math.ceil(failure.retryInMs / 1000)}s` : null}
 * ```
 *
 * Two things here that the data layers do not give you:
 *
 * - **`canRetryNow` is honest.** A retry button on a 403 or on a validation error is a lie:
 *   the same request will fail the same way. `canRetry` says whether retrying could ever
 *   work; `canRetryNow` additionally says whether it could work *yet*.
 * - **The `Retry-After` countdown is exposed.** Caches honour the header internally and
 *   leave the button enabled, which invites the user to hammer a rate-limited endpoint.
 */

import { useMemo, useState } from "react";
import { normalizeError, type NormalizedFailure, type NormalizeOptions } from "@unruffled/core";
import { useCountdown } from "./adapter/useCountdown.js";
import { usePrefersReducedMotion } from "./adapter/reducedMotion.js";
import { useResolvedPorts, type UseMachineOptions } from "./adapter/useMachine.js";
import { useProviderPorts, useUnruffledDefaults } from "./provider.js";

export type UseFailureOptions = Pick<NormalizeOptions, "classify" | "messages" | "online"> &
  UseMachineOptions;

export interface FailureApi extends NormalizedFailure {
  /**
   * Milliseconds until a retry could succeed, or null when there is no stated delay.
   *
   * Derived from `Retry-After` and the moment the failure arrived, so it counts down live.
   */
  readonly retryInMs: number | null;
  /** True when a retry affordance is honest *and* the stated delay has elapsed. */
  readonly canRetryNow: boolean;
  /**
   * Props for a short, user-facing summary element.
   *
   * `role="alert"` so the message is announced on appearance without needing a live region
   * of its own. Use this for an inline banner; the library already announces action
   * outcomes, so do not pair it with a toast saying the same thing.
   */
  readonly summaryProps: {
    readonly role: "alert";
    readonly "data-kind": NormalizedFailure["kind"];
  };
}

/**
 * Normalises a failure and tracks its retry window.
 *
 * Pass `null` when there is no failure; the hook returns `null` and holds no subscriptions.
 */
export function useFailure(error: unknown, options?: UseFailureOptions): FailureApi | null {
  const providerPorts = useProviderPorts();
  const defaults = useUnruffledDefaults();
  const ports = useResolvedPorts(providerPorts, options?.ports, options?.root);
  const reduced = usePrefersReducedMotion();

  // When the failure arrived, so the countdown measures from the response rather than from
  // whenever this component happened to render.
  //
  // Adjusted during render rather than in an effect. The first render in which a failure is
  // visible *is* its arrival, so recording the time here is both the most accurate answer
  // and avoids the cascading second render an effect would cause. React discards the
  // in-progress render and re-runs it immediately, which is the documented shape for
  // deriving state from a changed input.
  const [arrival, setArrival] = useState<{ error: unknown; at: number } | null>(null);
  if (error == null) {
    if (arrival !== null) setArrival(null);
  } else if (arrival?.error !== error) {
    setArrival({ error, at: ports.clock.now() });
  }
  const arrivedAt = error == null ? null : arrival?.error === error ? arrival.at : ports.clock.now();

  const failure = useMemo(() => {
    if (error == null) return null;
    const classify = options?.classify ?? defaults.classify;
    const messages = { ...defaults.messages, ...options?.messages };
    const online = options?.online ?? (typeof navigator === "undefined" ? undefined : navigator.onLine);

    return normalizeError(error, {
      nowMs: ports.clock.now(),
      ...(online === undefined ? {} : { online }),
      ...(classify === undefined ? {} : { classify }),
      ...(Object.keys(messages).length > 0 ? { messages } : {}),
    });
  }, [error, options, defaults, ports]);

  const retryAt =
    failure?.retryAfterMs !== undefined && arrivedAt !== null ? arrivedAt + failure.retryAfterMs : null;
  const retryInMs = useCountdown(retryAt, ports, reduced);

  return useMemo(() => {
    if (!failure) return null;
    return {
      ...failure,
      retryInMs,
      canRetryNow: failure.canRetry && (retryInMs === null || retryInMs <= 0),
      summaryProps: { role: "alert", "data-kind": failure.kind },
    };
  }, [failure, retryInMs]);
}
