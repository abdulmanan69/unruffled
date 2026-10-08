/**
 * Reduced-motion preference, read correctly.
 *
 * Two defects are extremely common in this exact code, and both are avoided here.
 *
 * **It must be reactive.** The widespread implementation reads `matchMedia` once into state
 * at mount. A user who turns the preference on mid-session, or who moves a window to a
 * display with different settings, keeps getting animation until a remount. This subscribes
 * to the media query, so the answer updates.
 *
 * **Respecting it must be the default.** The dominant animation library ships with reduction
 * switched off and requires an explicit opt-in that most applications never discover. Here
 * there is nothing to enable: the hook reports the user's actual preference, and the library
 * treats `true` as "reduce" everywhere without being asked.
 *
 * On the server and in a runtime without `matchMedia` the answer is `false`, which renders
 * the motion-enabled markup and then corrects itself on hydration if the user prefers
 * reduction. That ordering is deliberate: it keeps the server output stable rather than
 * guessing.
 */

import { useSyncExternalStore } from "react";

const QUERY = "(prefers-reduced-motion: reduce)";

function getList(): MediaQueryList | null {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") return null;
  return window.matchMedia(QUERY);
}

function subscribe(onChange: () => void): () => void {
  const list = getList();
  if (!list) return () => {};
  // `MediaQueryList.addEventListener` has been available everywhere this library supports
  // since Safari 14. The deprecated `addListener` fallback was dropped rather than carried:
  // it only mattered for browsers outside the stated support policy, and keeping it meant
  // shipping a branch that could never be exercised or tested.
  list.addEventListener("change", onChange);
  return () => {
    list.removeEventListener("change", onChange);
  };
}

function getSnapshot(): boolean {
  return getList()?.matches ?? false;
}

function getServerSnapshot(): boolean {
  return false;
}

/**
 * True when the user has asked for reduced motion.
 *
 * Reduction in this library means amplitude, not a binary kill: a countdown keeps counting
 * and stays accurate, it simply stops being animated. "Snap instantly" and "animate fully"
 * are both wrong answers for a progress affordance, because the information is the point.
 */
export function usePrefersReducedMotion(): boolean {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}

/** Non-reactive read, for code paths outside a component. */
export function prefersReducedMotion(): boolean {
  return getSnapshot();
}
