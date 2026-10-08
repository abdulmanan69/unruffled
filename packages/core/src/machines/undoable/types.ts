/**
 * Types for the deferred write.
 *
 * An undoable holds a mutation locally for a few seconds and sends it only once the window
 * has closed, so three fields that look optional elsewhere are not optional here:
 *
 * - `commit` is the whole primitive: the write that has not happened yet.
 * - `altText` is required because an undo affordance with no accessible name is unreachable
 *   by keyboard and screen reader, which turns "Deleted · Undo" into a delete with no undo.
 * - `flushOn` defaults to both exits rather than to none, because a window that does not
 *   survive navigation loses the write, and that is the failure this machine exists to stop.
 */

import type { InternalEvent } from "../../machine.js";
import type { KeyRegistry } from "../../shared/keyRegistry.js";
import type { FailureKind, NormalizedFailure } from "../../shared/normalizeError.js";

/**
 * Exits that close an open window early.
 *
 * `navigate` is an in-app route change, reported by a router binding; `pagehide` is the
 * document going away, which the DOM port raises from `pagehide` and from a
 * `visibilitychange` to hidden. A backgrounded mobile tab may never run script again, so the
 * second of those is the only warning some devices give.
 */
export type FlushTrigger = "navigate" | "pagehide";

/**
 * How long the window stays open by default.
 *
 * Long enough to read "Deleted" and reach for Undo, short enough that the interface is not
 * lying about a change it has not made yet.
 */
export const DEFAULT_UNDO_WINDOW_MS = 6000;

/** Both exits, because the opt-out has to be written down rather than arrived at by accident. */
export const DEFAULT_FLUSH_ON: readonly FlushTrigger[] = ["navigate", "pagehide"];

/**
 * How long a committed entry stays observable before returning to idle.
 *
 * The committed state exists so a view can swap "Deleted · Undo" for "Deleted" rather than
 * having the row vanish mid-sentence. It is not a user decision, so it is a constant rather
 * than a prop.
 */
export const COMMITTED_RESET_MS = 1000;

/** Strings read out to assistive technology. Set `announce: false` to opt out entirely. */
export interface UndoableAnnouncements {
  /** Announced when the window opens, which is the only moment undo is reachable. */
  readonly scheduled?: string;
  readonly undone?: string;
  readonly committed?: string;
}

export interface UndoableProps<T> {
  /**
   * The deferred write. Called once per committed batch, with every item in it.
   *
   * Replaced on every host render, so reading fresh state inside it is safe. It receives an
   * abort signal for symmetry with the rest of the library, but nothing in this machine
   * aborts it: a commit that has been sent is a write the user is owed.
   */
  commit: (items: readonly T[], signal: AbortSignal) => Promise<unknown>;

  /**
   * Undoes the optimistic local change.
   *
   * Called on undo, before the window closes, and never after a commit has been sent. This
   * is the only callback that can put the user's data back, so it runs first in the undo
   * transition rather than from a settled state.
   */
  readonly rollback?: (items: readonly T[]) => void;

  /** Milliseconds the window stays open. Defaults to {@link DEFAULT_UNDO_WINDOW_MS}. */
  readonly windowMs?: number;

  /**
   * Resource identity, for example `invoice:42`.
   *
   * Held for as long as the entry is pending or in flight, so an action writing the same
   * record cannot land in the middle of a deferred delete.
   */
  readonly key?: string;
  /** Registry backing `key`. Defaults to the process-wide one. */
  readonly registry?: KeyRegistry;

  /**
   * Merge tag for repeats.
   *
   * Five deletes in a row should be one entry saying "5 items deleted · Undo", not five
   * stacked toasts each with its own timer. Repeats sharing a tag append to the open entry
   * and restart its window.
   */
  readonly coalesce?: string;

  /**
   * Which exits flush an open window. Defaults to {@link DEFAULT_FLUSH_ON}.
   *
   * An empty array is the explicit opt-out: the consumer has decided that a window
   * interrupted by navigation may be lost, and UX1007 stays quiet because that decision was
   * made deliberately.
   */
  readonly flushOn?: readonly FlushTrigger[];

  /**
   * Accessible label for the undo affordance. Required.
   *
   * An icon-only or visually-implied Undo is the most common way this pattern ships broken:
   * the window exists, the request is correctly deferred, and the one control that cancels
   * it has no name in the accessibility tree.
   */
  readonly altText: string;

  readonly announce?: false | UndoableAnnouncements;

  /** Overrides failure classification. Returning `undefined` keeps the default mapping. */
  readonly classify?: (failure: NormalizedFailure) => FailureKind | undefined;
  /** Localised failure copy. */
  readonly messages?: Partial<Record<FailureKind, string>>;
  /** Whether the client has a network. Supplied by the adapter. */
  readonly online?: () => boolean;

  readonly onCommitted?: (items: readonly T[]) => void;
  readonly onUndone?: (items: readonly T[]) => void;
  readonly onCommitFailed?: (failure: NormalizedFailure) => void;
}

export interface UndoableContext<T> {
  /** Items in the open or in-flight batch. Empty when idle. */
  readonly items: readonly T[];
  /** Coalesce tag the open entry was created with. Null when the entry does not merge. */
  readonly tag: string | null;
  /**
   * Items scheduled while a batch was already being flushed.
   *
   * They open their own window once that flush settles. Interleaving them into the batch in
   * flight would send two writes for one key in an order decided by the network.
   */
  readonly queued: readonly T[];
  /** Clock reading at which the window closes. Null whenever undo is not available. */
  readonly expiresAt: number | null;
  readonly failure: NormalizedFailure | null;
  /** Releases the resource key. Null when no key is held. */
  readonly release: (() => void) | null;
}

export type UndoableEvent<T> =
  | { readonly type: "SCHEDULE"; readonly item: T }
  | { readonly type: "UNDO" }
  /** The window ran out. */
  | { readonly type: "EXPIRE" }
  /** Commit now: asked for by the consumer, or by the navigation port on the way out. */
  | { readonly type: "FLUSH" }
  | { readonly type: "RESOLVE" }
  | { readonly type: "REJECT"; readonly error: unknown }
  | { readonly type: "RETRY" }
  | { readonly type: "RESET" }
  | InternalEvent;

/**
 * Machine states.
 *
 * `held` and `committing` are the load-bearing pair: undo is possible in exactly one of
 * them, because in the other the request has already left. Every ecosystem Undo button that
 * dismisses a toast after the DELETE has landed is that distinction missing.
 */
export type UndoableStateValue = "idle" | "held" | "committing" | "committed" | "failed";
