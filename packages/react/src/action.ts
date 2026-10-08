/**
 * `useAction` — the action lifecycle as one hook.
 *
 * The call site is meant to read as a single declaration:
 *
 * ```tsx
 * const save = useAction(() => api.saveCustomer(form), {
 *   key: `customer:${id}`,
 *   announce: { success: "Customer saved" },
 * });
 *
 * <button {...save.triggerProps}>
 *   {save.pending ? "Saving..." : "Save customer"}
 * </button>
 * ```
 *
 * Everything that normally accompanies that button is already handled: the second click is
 * swallowed synchronously, the spinner does not appear for a fast save and does not flicker
 * for a slow one, the request aborts if the component unmounts, the failure is classified
 * and retryable only when retrying could actually work, and the outcome is announced.
 *
 * `triggerProps` deliberately does not include `disabled`. See {@link TriggerProps}.
 */

import { useCallback, useMemo, useRef, type KeyboardEvent, type MouseEvent } from "react";
import {
  connectAction,
  createActionMachine,
  type ActionApi,
  type ActionProps,
  type ActionStateValue,
} from "@unruffled/core";
import {
  useIsomorphicLayoutEffect,
  useMachine,
  useResolvedPorts,
  type UseMachineOptions,
} from "./adapter/useMachine.js";
import { useCountdown } from "./adapter/useCountdown.js";
import { usePrefersReducedMotion } from "./adapter/reducedMotion.js";
import { useProviderPorts, useUnruffledDefaults } from "./provider.js";

/** Everything {@link ActionProps} accepts except the work itself, which is the first argument. */
export type UseActionOptions<T, A> = Omit<ActionProps<T, A>, "run"> & UseMachineOptions;

/**
 * Props for the element that triggers the action.
 *
 * There is no `disabled`. That is the single most consequential decision in this file: a
 * disabled element is removed from the tab order, so disabling a button at the moment it is
 * pressed throws the user's focus to the top of the document and loses their place. Instead
 * the element stays focusable, reports `aria-disabled`, and has activation suppressed in the
 * handlers below. Rule UX1005 reports a `disabled` added by hand.
 */
export interface TriggerProps {
  readonly type: "button";
  readonly "aria-busy": boolean;
  readonly "aria-disabled": true | undefined;
  readonly "data-pending": "" | undefined;
  readonly "data-state": ActionStateValue;
  readonly "data-attempt": string | undefined;
  readonly onClick: (event: MouseEvent<HTMLElement>) => void;
  readonly onKeyDown: (event: KeyboardEvent<HTMLElement>) => void;
  readonly ref: (element: HTMLElement | null) => void;
}

export interface TriggerPropOverrides<A> {
  /** Arguments for this particular trigger, when the action is parameterised. */
  readonly args?: A;
  /** Called after the library's own handler, and only when the action was not suppressed. */
  readonly onClick?: (event: MouseEvent<HTMLElement>) => void;
  readonly onKeyDown?: (event: KeyboardEvent<HTMLElement>) => void;
  readonly ref?: (element: HTMLElement | null) => void;
  /**
   * Not supported, by design.
   *
   * Disabling the trigger removes it from the tab order and discards focus. Read `pending`
   * and change the label instead; the element is already `aria-disabled` and already
   * refuses to fire.
   */
  readonly disabled?: never;
}

export interface UseActionResult<T, A> extends ActionApi<T, A> {
  /** Spread straight onto the trigger element. */
  readonly triggerProps: TriggerProps;
  /** Same props, with your own handlers and arguments composed in. */
  readonly getTriggerProps: (overrides?: TriggerPropOverrides<A>) => TriggerProps;
  /**
   * Milliseconds until an automatic retry fires, or null when none is scheduled.
   *
   * A live value, updated from the frame port. Under reduced motion it updates once a second
   * instead of continuously: the number stays accurate, it simply stops animating, because
   * the information is the point.
   */
  readonly retryInMs: number | null;
}

export function useAction<T, A = void>(
  run: (args: A, signal: AbortSignal) => Promise<T>,
  options?: UseActionOptions<T, A>,
): UseActionResult<T, A> {
  const providerPorts = useProviderPorts();
  const defaults = useUnruffledDefaults();
  const ports = useResolvedPorts(providerPorts, options?.ports, options?.root);
  const reduced = usePrefersReducedMotion();

  // One definition per hook instance. `createActionMachine` returns a fresh object, so
  // without memoising it the service would be torn down and rebuilt on every render.
  const definition = useMemo(() => createActionMachine<T, A>(), []);

  const machineProps = useMemo<ActionProps<T, A>>(() => {
    const pending = { ...defaults.pending, ...options?.pending };
    const announce = options?.announce ?? defaults.announce;
    const classify = options?.classify ?? defaults.classify;
    const messages = { ...defaults.messages, ...options?.messages };
    const retry = options?.retry ?? defaults.retry;

    return {
      run,
      // `online` is read at classification time so an offline failure is labelled as such
      // rather than being reported as a generic network error.
      online: options?.online ?? (() => (typeof navigator === "undefined" ? true : navigator.onLine)),
      ...(Object.keys(pending).length > 0 ? { pending } : {}),
      ...(announce === undefined ? {} : { announce }),
      ...(classify === undefined ? {} : { classify }),
      ...(Object.keys(messages).length > 0 ? { messages } : {}),
      ...(retry === undefined ? {} : { retry }),
      ...(options?.key === undefined ? {} : { key: options.key }),
      ...(options?.registry === undefined ? {} : { registry: options.registry }),
      ...(options?.guard === undefined ? {} : { guard: options.guard }),
      ...(options?.destructive === undefined ? {} : { destructive: options.destructive }),
      ...(options?.reversible === undefined ? {} : { reversible: options.reversible }),
      ...(options?.focus === undefined ? {} : { focus: options.focus }),
      ...(options?.resetAfterMs === undefined ? {} : { resetAfterMs: options.resetAfterMs }),
      ...(options?.onSuccess === undefined ? {} : { onSuccess: options.onSuccess }),
      ...(options?.onError === undefined ? {} : { onError: options.onError }),
      ...(options?.onSettled === undefined ? {} : { onSettled: options.onSettled }),
    };
  }, [run, options, defaults]);

  const [snapshot, service] = useMachine(definition, machineProps, ports);
  const api = useMemo(() => connectAction<T, A>(snapshot, service.send), [snapshot, service]);

  const retryInMs = useCountdown(api.retryAt, ports, reduced);

  const elementRef = useRef<HTMLElement | null>(null);

  /**
   * Restores focus if it was lost while the action was running.
   *
   * Normally there is nothing to do, because the trigger is never disabled and so never
   * loses focus. This covers the case where the surrounding UI replaced the subtree
   * mid-flight, which is common in optimistic lists and leaves focus on the document body.
   */
  const previousStatus = useRef(api.status);
  useIsomorphicLayoutEffect(() => {
    const was = previousStatus.current;
    previousStatus.current = api.status;
    if (was !== "pending") return;
    if (api.status !== "success" && api.status !== "error") return;
    if ((options?.focus ?? "restore") === "none") return;
    if (ports.doc.activeElement() !== null) return;
    elementRef.current?.focus({ preventScroll: true });
  }, [api.status, options?.focus, ports]);

  const getTriggerProps = useCallback(
    (overrides?: TriggerPropOverrides<A>): TriggerProps => {
      const suppressed = api.busy;

      return {
        type: "button",
        "aria-busy": api.attrs["aria-busy"],
        "aria-disabled": api.attrs["aria-disabled"],
        "data-pending": api.attrs["data-pending"],
        "data-state": api.attrs["data-state"],
        "data-attempt": api.attrs["data-attempt"],

        onClick: (event) => {
          if (suppressed) {
            // The element is focusable and clickable by design, so activation has to be
            // refused here. Stopping propagation as well prevents a parent row handler from
            // treating the refused click as a selection.
            event.preventDefault();
            event.stopPropagation();
            return;
          }
          api.trigger(overrides?.args as A);
          overrides?.onClick?.(event);
        },

        onKeyDown: (event) => {
          if (suppressed && (event.key === "Enter" || event.key === " ")) {
            event.preventDefault();
            return;
          }
          // A native button already turns Enter and Space into a click, so firing here too
          // would run the action twice. Only synthesise activation for a non-button element
          // that has been given a button role.
          const isNativeButton = event.currentTarget.tagName === "BUTTON";
          if (!isNativeButton && (event.key === "Enter" || event.key === " ")) {
            event.preventDefault();
            api.trigger(overrides?.args as A);
          }
          overrides?.onKeyDown?.(event);
        },

        ref: (element) => {
          elementRef.current = element;
          overrides?.ref?.(element);
        },
      };
    },
    [api],
  );

  const triggerProps = useMemo(() => getTriggerProps(), [getTriggerProps]);

  return { ...api, triggerProps, getTriggerProps, retryInMs };
}
