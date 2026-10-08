import type { InternalEvent } from "../../machine.js";
import type { BackoffPolicy } from "../../shared/backoff.js";
import type { KeyRegistry } from "../../shared/keyRegistry.js";
import type { FailureKind, NormalizedFailure } from "../../shared/normalizeError.js";

/**
 * How overlapping triggers are handled.
 *
 * `single-flight` is the default because it is the correct default. The alternative is only
 * right for genuinely additive operations, such as adding separate items to a cart.
 */
export type GuardMode = "single-flight" | "allow-concurrent";

/**
 * When the pending affordance appears and how long it stays.
 *
 * Both numbers exist to stop the spinner from being worse than no spinner:
 *
 * - `delay` suppresses it entirely for fast actions. A 60ms save that flashes a spinner
 *   reads as a glitch, not as feedback.
 * - `min` keeps it up long enough to be perceived once it has appeared. Without this, an
 *   action that resolves at 160ms shows a spinner for 10ms, which is a flicker.
 */
export interface PendingPolicy {
  /** Milliseconds to wait before showing anything. */
  readonly delay: number;
  /** Milliseconds the affordance stays visible once shown. */
  readonly min: number;
}

export const DEFAULT_PENDING: PendingPolicy = { delay: 150, min: 400 };

/**
 * Elapsed visible pending time after which silence is a defect, in milliseconds.
 *
 * Past this point a sighted user has clear feedback and a screen-reader user has none, so
 * UX1003 fires if no live region is mounted.
 */
export const ANNOUNCE_THRESHOLD_MS = 400;

/** Strings read out to assistive technology. Set `announce: false` to opt out entirely. */
export interface ActionAnnouncements {
  /** Announced when the pending affordance becomes visible. */
  readonly pending?: string;
  readonly success?: string;
  /**
   * Announced on failure. Defaults to the normalised failure message, which is already
   * written for a user rather than a developer.
   */
  readonly error?: string;
}

export interface RetryPolicy {
  /** Number of automatic retries after the first attempt. Zero means manual retry only. */
  readonly attempts: number;
  readonly backoff?: BackoffPolicy;
}

/**
 * Where focus goes once the action settles.
 *
 * `restore` is the right default: the user pressed something, and that something should
 * still be where their attention is. `none` leaves focus alone for actions triggered
 * without a pointer or key press.
 */
export type FocusPolicy = "restore" | "none";

export interface ActionProps<T, A> {
  /**
   * The work. Receives the trigger arguments and an abort signal.
   *
   * Replaced on every host render, so reading fresh state inside it is safe. That removes
   * the stale-closure hazard that hand-rolled versions of this hook almost always have.
   */
  run: (args: A, signal: AbortSignal) => Promise<T>;

  /**
   * Resource identity, for example `customer:42`.
   *
   * Actions sharing a key are serialised across the whole application, not just within one
   * component. This is what makes the duplicate-submit guard correct when the second
   * trigger comes from somewhere else in the tree.
   */
  readonly key?: string;
  /** Registry backing `key`. Defaults to the process-wide one. */
  readonly registry?: KeyRegistry;
  readonly guard?: GuardMode;
  readonly pending?: Partial<PendingPolicy>;

  /**
   * Marks the action as irreversible.
   *
   * Setting this without also providing a recovery path triggers UX1001. Wrapping the action
   * in a confirmation or an undo window sets `reversible`, which satisfies the rule.
   */
  readonly destructive?: boolean;
  /** Set by `useConfirm` and `useUndoable` to record that a recovery path exists. */
  readonly reversible?: boolean;

  readonly announce?: false | ActionAnnouncements;
  readonly focus?: FocusPolicy;

  /** Milliseconds after which a settled action returns to idle. `false` keeps the result. */
  readonly resetAfterMs?: number | false;
  readonly retry?: RetryPolicy;

  /** Overrides failure classification. Returning `undefined` keeps the default mapping. */
  readonly classify?: (failure: NormalizedFailure) => FailureKind | undefined;
  /** Localised failure copy. */
  readonly messages?: Partial<Record<FailureKind, string>>;
  /** Whether the client has a network. Supplied by the adapter. */
  readonly online?: () => boolean;

  readonly onSuccess?: (value: T) => void;
  readonly onError?: (failure: NormalizedFailure) => void;
  readonly onSettled?: () => void;
}

/** Result held while the minimum display duration runs out. */
export type StashedOutcome<T> =
  { readonly ok: true; readonly value: T } | { readonly ok: false; readonly failure: NormalizedFailure };

export interface ActionContext<T, A> {
  /** 1 during the first attempt, incremented per retry. */
  readonly attempt: number;
  /** Whether the pending affordance is currently shown. */
  readonly visible: boolean;
  /** When the affordance became visible, for the minimum-duration calculation. */
  readonly visibleSince: number | null;
  readonly startedAt: number | null;
  /** Settled result awaiting the minimum display duration. */
  readonly outcome: StashedOutcome<T> | null;
  readonly data: T | null;
  readonly failure: NormalizedFailure | null;
  /** Arguments of the current attempt. Null before the first trigger. */
  readonly args: A | null;
  /** Releases the resource key. Null when no key is held. */
  readonly release: (() => void) | null;
  /** Aborts the request in flight. Null when nothing is in flight. */
  readonly abort: ((reason?: unknown) => void) | null;
  /** Clock reading at which an automatic retry is due, for the countdown. */
  readonly retryAt: number | null;
}

export type ActionEvent<T, A> =
  | { readonly type: "TRIGGER"; readonly args: A }
  /** The pending delay elapsed: show the affordance. */
  | { readonly type: "SHOW" }
  | { readonly type: "RESOLVE"; readonly value: T }
  | { readonly type: "REJECT"; readonly error: unknown }
  /** The minimum display duration elapsed: the stashed outcome may now be shown. */
  | { readonly type: "MIN_ELAPSED" }
  | { readonly type: "RETRY" }
  | { readonly type: "RESET" }
  | { readonly type: "CANCEL" }
  | InternalEvent;

/**
 * Machine states.
 *
 * `busy` and `settling` are distinct so that a fast action never flashes and a shown
 * affordance never flickers. `backoff` is distinct so that the waiting period before an
 * automatic retry is observable, which is what lets a UI render "retrying in 3s" instead of
 * appearing to hang.
 */
export type ActionStateValue = "idle" | "busy" | "settling" | "backoff" | "success" | "error";
