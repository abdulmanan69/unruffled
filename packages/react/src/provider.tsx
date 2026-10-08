/**
 * Application-wide defaults and port overrides.
 *
 * The provider is optional. Every hook works without it, because a UX library that only
 * behaves correctly once you have wired a provider has made its first-run experience the
 * thing most likely to be got wrong.
 *
 * What it is genuinely for:
 *
 * - **Timing policy in one place.** A dense table may want no pending delay at all; a
 *   marketing form may want a longer undo window. Setting that per call site is how
 *   inconsistency gets into a product.
 * - **Failure classification and copy.** One `classify` function and one message catalog,
 *   rather than a taxonomy that drifts between screens.
 * - **Root scoping.** An app rendered inside a shadow root or a secondary window passes its
 *   root here once instead of at every hook.
 */

import { createContext, useContext, useMemo, type ReactNode } from "react";
import type { FailureKind, NormalizedFailure, PendingPolicy, Ports, RetryPolicy } from "@unruffled/core";
import { createDomPorts, type PortRoot } from "./adapter/domPorts.js";

/**
 * Defaults merged underneath every call site.
 *
 * Deliberately behavioural only. There is nothing here about colour, radius, spacing or
 * typography, because the library emits no visual and so has no opinion to configure.
 */
export interface UnruffledDefaults {
  /** Pending affordance timing. Overridden per call site by the hook's own `pending`. */
  readonly pending?: Partial<PendingPolicy>;
  readonly retry?: RetryPolicy;
  /** Maps a normalised failure onto a different kind. Returning `undefined` keeps the default. */
  readonly classify?: (failure: NormalizedFailure) => FailureKind | undefined;
  /** Localised user-facing failure copy. `@unruffled/intl` ships catalogs for this. */
  readonly messages?: Partial<Record<FailureKind, string>>;
  /** Set `false` to silence announcements application-wide. Strongly discouraged. */
  readonly announce?: false;
}

interface ContextValue {
  readonly ports: Ports;
  readonly defaults: UnruffledDefaults;
}

const UnruffledContext = createContext<ContextValue | null>(null);

export interface UnruffledProviderProps {
  children: ReactNode;
  readonly defaults?: UnruffledDefaults;
  /** Replaces individual ports. Mostly useful in tests and in documentation harnesses. */
  readonly ports?: Partial<Ports>;
  /** Owning document or shadow root for listeners and focus reads. */
  readonly root?: PortRoot;
}

const EMPTY_DEFAULTS: UnruffledDefaults = {};

export function UnruffledProvider({ children, defaults, ports, root }: UnruffledProviderProps): ReactNode {
  const value = useMemo<ContextValue>(() => {
    const base = createDomPorts(root ? { root } : {});
    return {
      ports: ports ? { ...base, ...ports } : base,
      defaults: defaults ?? EMPTY_DEFAULTS,
    };
  }, [defaults, ports, root]);

  return <UnruffledContext.Provider value={value}>{children}</UnruffledContext.Provider>;
}

/** The provider's port set, or null when there is no provider. */
export function useProviderPorts(): Ports | null {
  return useContext(UnruffledContext)?.ports ?? null;
}

/** The provider's defaults, or an empty object when there is no provider. */
export function useUnruffledDefaults(): UnruffledDefaults {
  return useContext(UnruffledContext)?.defaults ?? EMPTY_DEFAULTS;
}
