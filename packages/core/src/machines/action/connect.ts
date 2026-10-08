/**
 * Turns an action snapshot into the values a view needs.
 *
 * Deriving on read rather than storing derived state in the machine means there is exactly
 * one source of truth and nothing to invalidate. Everything here is framework-neutral: the
 * React adapter wraps `attrs` into props and attaches handlers, and a future Vue or vanilla
 * adapter does the same work with its own event conventions.
 */

import type { Snapshot } from "../../machine.js";
import type { NormalizedFailure } from "../../shared/normalizeError.js";
import type { ActionContext, ActionEvent, ActionStateValue } from "./types.js";

/**
 * The four states a user can distinguish.
 *
 * The machine has six; `settling` and `backoff` are internal timing concerns that a view
 * should render as pending, because from the user point of view the action has not finished.
 */
export type ActionStatus = "idle" | "pending" | "success" | "error";

/**
 * Attributes for the element that triggers the action.
 *
 * `aria-disabled` rather than `disabled` is deliberate and is the single most important
 * detail in this file. A `disabled` element is removed from the tab order, so disabling a
 * button at the moment it is pressed throws focus to the top of the document and loses the
 * user place in the page. Keeping it focusable and suppressing activation preserves focus,
 * announces the state, and still blocks the second press.
 *
 * `undefined` values are omitted rather than rendered, because `aria-disabled="false"` is
 * noise in the accessibility tree.
 */
export interface ActionAttrs {
  /** True while work is in flight, so assistive technology knows the region is updating. */
  readonly "aria-busy": boolean;
  /** True while activation is suppressed. Never paired with `disabled`. */
  readonly "aria-disabled": true | undefined;
  /** Present with an empty value while the pending affordance should render. */
  readonly "data-pending": "" | undefined;
  /** Raw machine state, for styling the full lifecycle. */
  readonly "data-state": ActionStateValue;
  /** Attempt number from the second attempt onwards, for retry copy. */
  readonly "data-attempt": string | undefined;
}

export interface ActionApi<T, A> {
  /** The raw machine state, when the four-state status is not enough. */
  readonly state: ActionStateValue;
  readonly status: ActionStatus;
  /**
   * Whether the pending affordance should render.
   *
   * False during the first `delay` milliseconds even though work has started, which is what
   * stops fast actions from flashing.
   */
  readonly pending: boolean;
  /** Whether work is in flight or settling. Drives `aria-busy`, not the spinner. */
  readonly busy: boolean;
  readonly data: T | null;
  readonly failure: NormalizedFailure | null;
  /** 0 when idle, 1 during the first attempt, higher while retrying. */
  readonly attempt: number;
  /** Whether offering a retry affordance is honest for the current failure. */
  readonly canRetry: boolean;
  /**
   * Clock reading at which an automatic retry fires, or null.
   *
   * A reading rather than a duration, because a duration would be stale the moment it was
   * read. The adapter subscribes to the frame port to render a live countdown from this.
   */
  readonly retryAt: number | null;

  trigger(args: A): void;
  retry(): void;
  reset(): void;
  /** Aborts the request in flight and returns to idle without reporting a failure. */
  cancel(): void;

  readonly attrs: ActionAttrs;
}

const PENDING_STATES: ReadonlySet<ActionStateValue> = new Set<ActionStateValue>([
  "busy",
  "settling",
  "backoff",
]);

export function connectAction<T, A>(
  snapshot: Snapshot<ActionContext<T, A>, ActionStateValue>,
  send: (event: ActionEvent<T, A>) => void,
): ActionApi<T, A> {
  const { value, context } = snapshot;
  const busy = PENDING_STATES.has(value);
  // Visible during `settling` even though the request has finished: that is the whole point
  // of the minimum display duration.
  const pending = busy && (context.visible || value === "settling");
  const status: ActionStatus = busy
    ? "pending"
    : value === "success"
      ? "success"
      : value === "error"
        ? "error"
        : "idle";

  return {
    state: value,
    status,
    pending,
    busy,
    data: context.data,
    failure: context.failure,
    attempt: context.attempt,
    canRetry: context.failure?.canRetry ?? false,
    retryAt: context.retryAt,

    trigger: (args) => {
      send({ type: "TRIGGER", args });
    },
    retry: () => {
      send({ type: "RETRY" });
    },
    reset: () => {
      send({ type: "RESET" });
    },
    cancel: () => {
      send({ type: "CANCEL" });
    },

    attrs: {
      "aria-busy": busy,
      "aria-disabled": busy ? true : undefined,
      "data-pending": pending ? "" : undefined,
      "data-state": value,
      "data-attempt": context.attempt > 1 ? String(context.attempt) : undefined,
    },
  };
}
