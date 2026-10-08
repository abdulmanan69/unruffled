/**
 * Retry delay calculation.
 *
 * Two things here that libraries in this space routinely get wrong:
 *
 * 1. **`Retry-After` is honoured, and the remaining time is exposed.** A data layer that
 *    silently retries after its own computed delay while the UI leaves the button enabled
 *    invites the user to hammer a rate-limited endpoint. The countdown is a return value,
 *    not an internal detail.
 * 2. **Jitter is on by default.** Without it, every client that failed at the same moment
 *    retries at the same moment, which is how a brief outage becomes a sustained one.
 */

export interface BackoffPolicy {
  /** Delay before the first retry. */
  readonly baseMs?: number;
  /** Multiplier applied per attempt. */
  readonly factor?: number;
  /** Hard ceiling, so a long-lived error does not schedule a retry minutes away. */
  readonly maxMs?: number;
  /**
   * Fraction of the computed delay to randomise, 0 to 1.
   *
   * Applied as full jitter across the range, which is the variant that actually decorrelates
   * clients rather than merely perturbing them.
   */
  readonly jitter?: number;
}

export const DEFAULT_BACKOFF: Required<BackoffPolicy> = {
  baseMs: 500,
  factor: 2,
  maxMs: 30_000,
  jitter: 0.5,
};

/**
 * Delay in milliseconds before `attempt`, where attempt 1 is the first retry.
 *
 * `random` is injected rather than taken from `Math.random` so a test can assert exact
 * values. Passing nothing uses real randomness.
 */
export function computeBackoff(attempt: number, policy: BackoffPolicy = {}, random?: () => number): number {
  const { baseMs, factor, maxMs, jitter } = { ...DEFAULT_BACKOFF, ...policy };
  const exponent = Math.max(0, attempt - 1);
  const raw = Math.min(maxMs, baseMs * Math.pow(factor, exponent));
  if (jitter <= 0) return Math.round(raw);

  const spread = raw * Math.min(1, jitter);
  const roll = (random ?? Math.random)();
  // Full jitter: uniform across [raw - spread, raw]. Never negative, never above the ceiling.
  return Math.round(Math.max(0, raw - spread + roll * spread));
}

/**
 * Parses an HTTP `Retry-After` value into milliseconds.
 *
 * The header is either delta-seconds or an HTTP date, and both occur in the wild. `nowMs`
 * is injected because resolving the date form needs a clock, and this module must stay
 * testable without one.
 */
export function parseRetryAfter(value: string | null | undefined, nowMs: number): number | undefined {
  if (value == null) return undefined;
  const trimmed = value.trim();
  if (trimmed.length === 0) return undefined;

  if (/^\d+$/.test(trimmed)) return Number(trimmed) * 1000;

  const at = Date.parse(trimmed);
  if (Number.isNaN(at)) return undefined;
  // A date in the past means retry now, not a negative wait.
  return Math.max(0, at - nowMs);
}
