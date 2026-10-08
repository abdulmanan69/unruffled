/**
 * The live region, and the hook for writing to it directly.
 *
 * Mount `<Announcer />` once near the root of the application. That is the only step:
 * announcement is on by default throughout the library, and every machine routes through the
 * announcer port, so no call site has to opt in.
 *
 * Why two regions rather than one:
 *
 * - `aria-live="polite"` waits for a pause, which is right for confirmations. "Customer
 *   saved" interrupting someone mid-sentence is worse than arriving a moment later.
 * - `role="alert"` with `aria-live="assertive"` interrupts, which is right for failures. A
 *   user who has already moved on needs to know the save did not happen.
 *
 * Switching one region's politeness attribute at runtime is unreliable across screen
 * readers, which is why there are two and the message is routed rather than the region
 * reconfigured.
 */

import { useCallback, useRef, type CSSProperties, type ReactNode } from "react";
import type { Politeness } from "@unruffled/core";
import { announce as writeAnnouncement, isLive, registerLiveRegions } from "./adapter/liveRegion.js";
import { useIsomorphicLayoutEffect } from "./adapter/useMachine.js";

/**
 * The only inline style in the library, and it is semantics rather than design.
 *
 * A live region has to be in the accessibility tree and out of the visual layout. That rules
 * out `display: none`, `visibility: hidden` and `hidden`, all of which remove the element
 * from the accessibility tree and make the region silent. It also rules out
 * `width: 0; height: 0`, which some screen readers skip. The clip-based approach below is
 * the one that is reliably announced.
 *
 * It is inline rather than in a stylesheet because the library ships no CSS, and a live
 * region that depends on the consumer having imported a stylesheet is a live region that
 * will sometimes be visible and sometimes be silent.
 */
const VISUALLY_HIDDEN: CSSProperties = {
  position: "absolute",
  width: 1,
  height: 1,
  margin: -1,
  padding: 0,
  border: 0,
  overflow: "hidden",
  clipPath: "inset(50%)",
  whiteSpace: "nowrap",
};

export interface AnnouncerProps {
  /**
   * Identifier prefix for the rendered regions, if the application needs to target them.
   *
   * Defaults to no id: nothing in the library looks these up by id, and an unprefixed id
   * risks colliding with the host application.
   */
  readonly id?: string;
}

/**
 * Renders the two live regions and registers them with the library.
 *
 * Render it once. Rendering it twice is harmless but pointless: the second registration
 * replaces the first, and announcements go to whichever is currently mounted.
 */
export function Announcer({ id }: AnnouncerProps = {}): ReactNode {
  const politeRef = useRef<HTMLDivElement | null>(null);
  const assertiveRef = useRef<HTMLDivElement | null>(null);

  // Layout effect rather than a passive effect: an action that settles in the same commit as
  // the mount would otherwise announce into a void and trip UX1003 on first load.
  useIsomorphicLayoutEffect(() => {
    const polite = politeRef.current;
    const assertive = assertiveRef.current;
    if (!polite || !assertive) return;
    return registerLiveRegions({ polite, assertive });
  }, []);

  return (
    <>
      <div
        ref={politeRef}
        {...(id === undefined ? {} : { id: `${id}-polite` })}
        aria-live="polite"
        // Atomic so a replaced message is read in full rather than diffed word by word.
        aria-atomic="true"
        style={VISUALLY_HIDDEN}
      />
      <div
        ref={assertiveRef}
        {...(id === undefined ? {} : { id: `${id}-assertive` })}
        role="alert"
        aria-live="assertive"
        aria-atomic="true"
        style={VISUALLY_HIDDEN}
      />
    </>
  );
}

export interface UseAnnounceResult {
  /** Queues a message. De-duplicated and rate-limited; assertive messages jump the queue. */
  announce: (message: string, politeness?: Politeness) => void;
  /**
   * Whether a live region is currently mounted.
   *
   * Read this to assert in a test that announcements are actually deliverable, rather than
   * assuming they are.
   */
  readonly live: boolean;
}

/**
 * Announce something the library does not already announce for you.
 *
 * Most code should not need this: outcomes of actions, confirmations, undo windows and bulk
 * progress are announced by their own machines. Reach for it when the application itself has
 * something to say, such as "filters cleared, 240 results".
 */
export function useAnnounce(): UseAnnounceResult {
  const announce = useCallback((message: string, politeness: Politeness = "polite") => {
    writeAnnouncement(message, politeness);
  }, []);

  return { announce, live: isLive() };
}
