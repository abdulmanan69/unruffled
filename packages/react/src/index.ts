/**
 * `@unruffled/react` — hooks and prop-getters for the async half of a React UI.
 *
 * Nothing here renders a visual. `<Announcer />` is the only component, and it renders two
 * clipped live regions that are never seen. Everything else hands you values and props to
 * spread onto your own markup, so the library composes over whatever design system you
 * already own instead of competing with it.
 *
 * Per-primitive subpaths (`@unruffled/react/action`, `/failure`, `/announce`) are a
 * guarantee rather than a workaround: the barrel tree-shakes, and the subpaths exist so you
 * can prove it in a bundle report.
 */

export {
  useAction,
  type TriggerPropOverrides,
  type TriggerProps,
  type UseActionOptions,
  type UseActionResult,
} from "./action.js";

export { useFailure, type FailureApi, type UseFailureOptions } from "./failure.js";

export { Announcer, useAnnounce, type AnnouncerProps, type UseAnnounceResult } from "./announce.js";

export {
  UnruffledProvider,
  useUnruffledDefaults,
  type UnruffledDefaults,
  type UnruffledProviderProps,
} from "./provider.js";

export { prefersReducedMotion, usePrefersReducedMotion } from "./adapter/reducedMotion.js";

export { createDomPorts, type DomPortOptions, type PortRoot } from "./adapter/domPorts.js";

export {
  useIsomorphicLayoutEffect,
  useMachine,
  useResolvedPorts,
  type UseMachineOptions,
} from "./adapter/useMachine.js";

export { useCountdown } from "./adapter/useCountdown.js";

/**
 * Re-exported from core for convenience.
 *
 * These are the types that appear in the signatures above, so importing them should not
 * require a second package in a consumer's import list.
 */
export type {
  ActionApi,
  ActionAttrs,
  ActionProps,
  ActionStateValue,
  ActionStatus,
  FailureKind,
  FieldFailure,
  NormalizedFailure,
  PendingPolicy,
  Politeness,
  Ports,
  RetryPolicy,
} from "@unruffled/core";
