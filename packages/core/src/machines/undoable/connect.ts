/**
 * Turns an undoable snapshot into the values a view needs.
 *
 * Derived on read, so there is one source of truth and nothing to invalidate. Nothing here
 * is React-shaped: the adapter turns `altText` into an `aria-label` and `expiresAt` into a
 * live countdown, and a Vue or vanilla adapter does the same work with its own conventions.
 */

import type { Snapshot } from "../../machine.js";
import type { NormalizedFailure } from "../../shared/normalizeError.js";
import type { UndoableContext, UndoableEvent, UndoableStateValue } from "./types.js";

/**
 * The user-visible status.
 *
 * An alias rather than a narrower union, unlike the action machine where six states collapse
 * into four. Every state here is one a user can distinguish: the window is open, the request
 * has gone, it landed, or it did not. Collapsing any pair would hide the difference between
 * "you can still undo this" and "this has been sent", which is the whole primitive.
 */
export type UndoableStatus = UndoableStateValue;

/** Attributes for the element that hosts the undo affordance, typically a toast. */
export interface UndoableAttrs {
  /** Raw machine state, for styling the full lifecycle. */
  readonly "data-state": UndoableStateValue;
  /** How many items the pending entry holds, so coalesced copy can read "3 items deleted". */
  readonly "data-count": string;
  /** True while the commit is in flight, so assistive technology knows the region is updating. */
  readonly "aria-busy": boolean;
}

export interface UndoableApi<T> {
  /** The raw machine state. */
  readonly state: UndoableStateValue;
  readonly status: UndoableStatus;
  /** Items in the pending or in-flight batch, in the order they were scheduled. */
  readonly items: readonly T[];
  readonly count: number;
  /**
   * Clock reading at which the window closes, or null.
   *
   * A reading rather than a duration, because a duration is stale the moment it is read. The
   * adapter derives the countdown and the progress ring from this, exactly as it does from
   * the action machine's `retryAt`.
   */
  readonly expiresAt: number | null;
  readonly failure: NormalizedFailure | null;
  /**
   * Whether undo is still possible.
   *
   * True only while the window is open. Once the commit is in flight there is nothing to
   * cancel, and an Undo control rendered past this point is the lie this machine exists to
   * prevent.
   */
  readonly canUndo: boolean;

  /** Adds an item to the pending batch, opening a window or merging into the open one. */
  readonly schedule: (item: T) => void;
  /** Rolls the optimistic change back and discards the write. Ignored unless `canUndo`. */
  readonly undo: () => void;
  /** Commits now, without waiting for the window. Also retries a failed commit. */
  readonly flush: () => void;
  /** Clears a settled entry. A pending window is left alone: use `undo` or `flush`. */
  readonly reset: () => void;

  readonly attrs: UndoableAttrs;
}

export function connectUndoable<T>(
  snapshot: Snapshot<UndoableContext<T>, UndoableStateValue>,
  send: (event: UndoableEvent<T>) => void,
): UndoableApi<T> {
  const { value, context } = snapshot;

  return {
    state: value,
    status: value,
    items: context.items,
    count: context.items.length,
    expiresAt: context.expiresAt,
    failure: context.failure,
    canUndo: value === "held",

    schedule: (item) => {
      send({ type: "SCHEDULE", item });
    },
    undo: () => {
      send({ type: "UNDO" });
    },
    flush: () => {
      send({ type: "FLUSH" });
    },
    reset: () => {
      send({ type: "RESET" });
    },

    attrs: {
      "data-state": value,
      "data-count": String(context.items.length),
      "aria-busy": value === "committing",
    },
  };
}
