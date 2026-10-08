/**
 * The live-region registry.
 *
 * `<Announcer />` registers its two regions here on mount and removes them on unmount.
 * Everything that announces reads from this module, which has two consequences worth
 * stating:
 *
 * 1. **No provider is required.** A hook deep in the tree can announce without the consumer
 *    threading anything through context, and `<Announcer />` can sit anywhere. That matters
 *    because the instruction "mount it once near the root" has to be the only step.
 * 2. **The library can tell whether anyone is listening.** `isLive()` is what makes rule
 *    UX1003 honest: it distinguishes "announced correctly" from "announced into a void",
 *    rather than warning that announcing is merely possible.
 *
 * The queueing below exists because naive live regions have exactly two failure modes, and
 * both are common: saying nothing, and saying everything twice.
 */

import type { Politeness } from "@unruffled/core";

/** Minimum gap between writes. Two messages in the same frame make screen readers drop one. */
const MIN_GAP_MS = 150;

/** Window in which an identical repeat is treated as a duplicate rather than a new event. */
const DEDUPE_WINDOW_MS = 500;

/** Upper bound on the queue, so a runaway loop cannot grow it without limit. */
const MAX_QUEUE = 20;

interface Regions {
  readonly polite: HTMLElement;
  readonly assertive: HTMLElement;
}

interface QueuedMessage {
  readonly message: string;
  readonly politeness: Politeness;
}

let regions: Regions | null = null;
let queue: QueuedMessage[] = [];
let draining = false;
let lastMessage: string | null = null;
let lastAt = 0;

/**
 * Alternates an invisible suffix on each write.
 *
 * A live region only announces when its content *changes*. Writing the same string twice is
 * silent, which is why "Saved" announces the first time and never again. A trailing
 * zero-width space that flips on alternate writes guarantees a change without altering what
 * is read aloud.
 */
let flip = false;
const ZERO_WIDTH = "​";

function now(): number {
  return typeof performance === "object" ? performance.now() : Date.now();
}

function write(entry: QueuedMessage): void {
  if (!regions) return;
  const target = entry.politeness === "assertive" ? regions.assertive : regions.polite;
  flip = !flip;
  target.textContent = flip ? entry.message + ZERO_WIDTH : entry.message;
  lastMessage = entry.message;
  lastAt = now();
}

function drain(): void {
  if (draining) return;
  const next = queue.shift();
  if (!next) return;

  draining = true;
  write(next);

  setTimeout(() => {
    draining = false;
    if (queue.length > 0) drain();
  }, MIN_GAP_MS);
}

/** Called by `<Announcer />` on mount. Returns the unregister function. */
export function registerLiveRegions(next: Regions): () => void {
  regions = next;
  // Anything announced before the region mounted is now deliverable.
  if (queue.length > 0) drain();
  return () => {
    if (regions === next) regions = null;
  };
}

/** True when a live region is mounted and will be read. */
export function isLive(): boolean {
  return regions !== null;
}

/**
 * Queues a message.
 *
 * Assertive messages jump the queue: a failure the user needs to know about should not wait
 * behind a backlog of routine confirmations.
 */
export function announce(message: string, politeness: Politeness): void {
  const trimmed = message.trim();
  if (trimmed.length === 0) return;

  if (trimmed === lastMessage && now() - lastAt < DEDUPE_WINDOW_MS) return;

  const entry: QueuedMessage = { message: trimmed, politeness };
  if (politeness === "assertive") queue.unshift(entry);
  else queue.push(entry);

  if (queue.length > MAX_QUEUE) queue = queue.slice(0, MAX_QUEUE);
  drain();
}

/** Clears registry state. Exported for tests, which must not leak announcements between cases. */
export function resetLiveRegions(): void {
  regions = null;
  queue = [];
  draining = false;
  lastMessage = null;
  lastAt = 0;
  flip = false;
}
