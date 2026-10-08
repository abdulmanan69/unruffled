/**
 * The React binding for a machine.
 *
 * Three problems get solved here, and all three are why an adapter exists at all rather than
 * the machine owning its own subscription model.
 *
 * **Reactivity belongs to the framework.** The machine publishes snapshots; React reads them
 * through `useSyncExternalStore`. Pushing a shared reactive store down into the
 * framework-neutral layer is a known dead end: it forces every adapter through one
 * notification strategy and measurably costs mount and update time.
 *
 * **Props are replaced on every committed render.** That is what removes the stale-closure
 * hazard. A handler captured at mount would call last week's `run` with last week's state;
 * instead the machine reads the current props at the moment the event fires. The update runs
 * in a layout effect, which React guarantees happens after commit and before any user event
 * can be dispatched, so an event handler never sees stale props.
 *
 * **Strict Mode remounts are survivable, without losing machine state.** React deliberately
 * mounts, unmounts and remounts in development. Stopping the service in the cleanup would
 * hand the remounted component a dead machine; recreating it on remount would throw away an
 * in-flight request and any undo window. Instead the stop is deferred by a microtask and
 * cancelled if a mount follows immediately, so a real unmount still tears down and a Strict
 * Mode remount is a no-op.
 */

import { useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import {
  createService,
  type AnyEvent,
  type MachineDefinition,
  type Ports,
  type Service,
  type Snapshot,
} from "@unruffled/core";
import { createDomPorts, type PortRoot } from "./domPorts.js";

/**
 * Layout effects warn during server rendering, where there is no layout to read.
 *
 * On the server the fallback never actually runs, so the behaviour is identical and only the
 * warning disappears.
 */
export const useIsomorphicLayoutEffect = typeof document === "undefined" ? useEffect : useLayoutEffect;

export interface UseMachineOptions {
  /** Overrides individual ports. Anything omitted falls back to the provider, then the DOM. */
  readonly ports?: Partial<Ports>;
  /** Scopes listeners and focus reads to a shadow root or a secondary document. */
  readonly root?: PortRoot;
}

/**
 * Builds the effective port set.
 *
 * Resolution order is explicit override, then provider, then DOM. Memoised on the override
 * identity, because a new port object would mean a new service.
 */
export function useResolvedPorts(base: Ports | null, overrides?: Partial<Ports>, root?: PortRoot): Ports {
  return useMemo(() => {
    const resolved = base ?? createDomPorts(root ? { root } : {});
    return overrides ? { ...resolved, ...overrides } : resolved;
  }, [base, overrides, root]);
}

/** Identity of the inputs that would make this a different machine. */
interface MachineIdentity<C, P, E extends AnyEvent, S extends string> {
  readonly definition: MachineDefinition<C, P, E, S>;
  readonly ports: Ports;
}

/**
 * Drives a machine from React.
 *
 * Returns the current snapshot and the service. Callers derive their public shape with the
 * machine's own `connect*` function, so the derivation stays framework-neutral.
 */
export function useMachine<C, P, E extends AnyEvent, S extends string>(
  definition: MachineDefinition<C, P, E, S>,
  props: P,
  ports: Ports,
): readonly [Snapshot<C, S>, Service<C, P, E, S>] {
  const [service, setService] = useState(() => createService(definition, { props, ports }));
  const [identity, setIdentity] = useState<MachineIdentity<C, P, E, S>>({ definition, ports });

  // Adjusting state during render rather than in an effect: a different definition or port
  // set is a different machine, and React re-renders immediately without committing the
  // discarded one. Doing this in an effect would commit a render against a stale service.
  // In practice callers memoise both inputs and this never fires.
  if (identity.definition !== definition || identity.ports !== ports) {
    service.stop();
    setIdentity({ definition, ports });
    setService(createService(definition, { props, ports }));
  }

  // Every committed render hands the machine the current props. No dependency array: the
  // whole point is that this runs each time, so `run` and the callbacks are never stale.
  useIsomorphicLayoutEffect(() => {
    service.setProps(props);
  });

  // Shared across services on purpose. When `service` changes it was already stopped
  // synchronously in the branch above, so the incoming effect cancelling that service's
  // deferred stop is harmless -- `stop()` is idempotent and has already run.
  const teardown = useRef({ pending: false });

  useEffect(() => {
    const flag = teardown.current;
    flag.pending = false;

    return () => {
      flag.pending = true;
      ports.scheduler.microtask(() => {
        if (flag.pending) service.stop();
      });
    };
  }, [service, ports]);

  const snapshot = useSyncExternalStore(service.subscribe, service.getSnapshot, service.getSnapshot);

  return [snapshot, service] as const;
}
