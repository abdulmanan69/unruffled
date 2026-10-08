/**
 * `useUndoable` — the write that has not been sent yet.
 *
 * ```tsx
 * const deletion = useUndoable<Row>({
 *   commit: (rows) => api.deleteRows(rows.map((row) => row.id)),
 *   rollback: (rows) => setRows((current) => [...current, ...rows]),
 *   coalesce: "row-delete",
 *   altText: "Undo delete",
 *   announce: { scheduled: "Deleted", committed: "Delete saved" },
 * });
 *
 * <button onClick={() => { setRows(without(row)); deletion.schedule(row); }}>Delete</button>
 *
 * {deletion.canUndo && (
 *   <Toast style={{ "--undo-progress": deletion.progress ?? 0 } as CSSProperties}>
 *     {deletion.count} deleted · <button {...deletion.undoProps}>Undo</button>
 *   </Toast>
 * )}
 * ```
 *
 * The DELETE has not been sent while that toast is on screen. Pressing Undo means it is
 * never sent at all; letting the window run out, navigating away, or closing the tab all
 * send it. The two things this file adds on top of the machine are both about rendering the
 * window honestly:
 *
 * - **`remainingMs` and `progress` are live.** Both derive from `expiresAt`, a clock
 *   reading, through the same shared countdown `useAction` uses for its retry, so a ring or
 *   a number counts down without a timer in the component and without a second animation
 *   loop.
 * - **`undoProps` carries the accessible name.** `altText` is required by the machine and
 *   lands here as `aria-label`, because the failure mode this primitive ships with in the
 *   wild is an icon-only Undo that no keyboard or screen-reader user can reach.
 *
 * And one thing that has to happen here rather than in core: a component unmounting with a
 * window still open flushes the write on the way out. See {@link useUndoable}.
 */

import { useCallback, useEffect, useMemo, useRef, type MouseEvent } from "react";
import {
  connectUndoable,
  createUndoableMachine,
  DEFAULT_UNDO_WINDOW_MS,
  type UndoableApi,
  type UndoableProps,
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

/** Everything {@link UndoableProps} accepts, plus the adapter's port overrides. */
export type UseUndoableOptions<T> = UndoableProps<T> & UseMachineOptions;

/**
 * Props for the control that cancels the pending write.
 *
 * `aria-label` is always present, which is the point of `altText` being required: an undo
 * affordance with no accessible name is a delete with no undo.
 *
 * There is no `disabled`, for the same reason the action trigger has none — disabling an
 * element removes it from the tab order and throws the user's focus to the top of the
 * document. Once the window has closed there is nothing to cancel, so stop rendering the
 * control: read `canUndo` and unmount it rather than leaving a dead button behind.
 */
export interface UndoProps {
  readonly type: "button";
  readonly "aria-label": string;
  readonly onClick: (event: MouseEvent<HTMLElement>) => void;
}

export interface UndoPropOverrides {
  /** Called after the library's own handler. */
  readonly onClick?: (event: MouseEvent<HTMLElement>) => void;
  /** Overrides the accessible name for this control only. Defaults to `altText`. */
  readonly altText?: string;
  /**
   * Not supported, by design.
   *
   * A disabled Undo is either unreachable or a lie. Render the control while `canUndo` and
   * remove it afterwards.
   */
  readonly disabled?: never;
}

export interface UseUndoableResult<T> extends UndoableApi<T> {
  /** Spread straight onto the undo control. */
  readonly undoProps: UndoProps;
  /** Same props, with your own handler or label composed in. */
  readonly getUndoProps: (overrides?: UndoPropOverrides) => UndoProps;
  /**
   * Milliseconds left in the window, or null when none is open.
   *
   * A live value, updated from the frame port and bucketed so a six-second window does not
   * cost sixty renders a second. Under reduced motion it updates once a second: the number
   * stays accurate and keeps counting, because a user deciding whether to press Undo needs
   * the time more than the animation.
   */
  readonly remainingMs: number | null;
  /**
   * How far through the window we are, from 0 when it opens to 1 when it closes. Null when
   * no window is open.
   *
   * Hand it to CSS as a custom property and let the compositor draw the ring —
   * `style={{ "--undo-progress": progress }}` with a `stroke-dashoffset` or `scaleX`
   * reading that variable. Driving a ring from React state would re-render the toast on
   * every frame to animate something the GPU can interpolate on its own.
   */
  readonly progress: number | null;
}

/**
 * Holds a mutation for a few seconds and sends it only once undo is no longer possible.
 *
 * The unmount behaviour is the part worth knowing about. A component that disappears with
 * a window still open flushes the write in its cleanup, synchronously, before the service
 * is torn down: the alternative is a delete the user was told had happened and which never
 * reached the server. React's development double-mount is unaffected, because the window
 * cannot already be open at that point and the flush is guarded on `canUndo`.
 */
export function useUndoable<T>(options: UseUndoableOptions<T>): UseUndoableResult<T> {
  const providerPorts = useProviderPorts();
  const defaults = useUnruffledDefaults();
  const ports = useResolvedPorts(providerPorts, options.ports, options.root);
  const reduced = usePrefersReducedMotion();

  // One definition per hook instance. `createUndoableMachine` returns a fresh object, so
  // without memoising it the service would be torn down and rebuilt on every render.
  const definition = useMemo(() => createUndoableMachine<T>(), []);

  const machineProps = useMemo<UndoableProps<T>>(() => {
    const announce = options.announce ?? defaults.announce;
    const classify = options.classify ?? defaults.classify;
    const messages = { ...defaults.messages, ...options.messages };

    return {
      commit: options.commit,
      altText: options.altText,
      // `online` is read at classification time so a commit that failed with no network is
      // labelled as such rather than as a generic server error.
      online: options.online ?? (() => (typeof navigator === "undefined" ? true : navigator.onLine)),
      ...(announce === undefined ? {} : { announce }),
      ...(classify === undefined ? {} : { classify }),
      ...(Object.keys(messages).length > 0 ? { messages } : {}),
      ...(options.rollback === undefined ? {} : { rollback: options.rollback }),
      ...(options.windowMs === undefined ? {} : { windowMs: options.windowMs }),
      ...(options.key === undefined ? {} : { key: options.key }),
      ...(options.registry === undefined ? {} : { registry: options.registry }),
      ...(options.coalesce === undefined ? {} : { coalesce: options.coalesce }),
      // Spread rather than defaulted: an empty array is the deliberate opt-out from
      // flushing on the way out, and replacing it with the default would both lose the
      // write and bring back the UX1007 warning the consumer answered.
      ...(options.flushOn === undefined ? {} : { flushOn: options.flushOn }),
      ...(options.onCommitted === undefined ? {} : { onCommitted: options.onCommitted }),
      ...(options.onUndone === undefined ? {} : { onUndone: options.onUndone }),
      ...(options.onCommitFailed === undefined ? {} : { onCommitFailed: options.onCommitFailed }),
    };
  }, [options, defaults]);

  const [snapshot, service] = useMachine(definition, machineProps, ports);
  const api = useMemo(() => connectUndoable<T>(snapshot, service.send), [snapshot, service]);

  const remainingMs = useCountdown(api.expiresAt, ports, reduced);

  const windowMs = options.windowMs ?? DEFAULT_UNDO_WINDOW_MS;
  const progress =
    remainingMs === null || windowMs <= 0 ? null : Math.min(1, Math.max(0, 1 - remainingMs / windowMs));

  /**
   * The current API, for the unmount flush.
   *
   * The cleanup below runs once, at teardown, so it cannot close over the render that
   * registered it: that render's `flush` belongs to a snapshot from before the window
   * opened.
   */
  const latest = useRef(api);
  useIsomorphicLayoutEffect(() => {
    latest.current = api;
  });

  useEffect(
    () => () => {
      // Synchronous, not deferred: `useMachine` stops the service from a microtask, and a
      // flush queued behind that would be sent to a dead machine and silently dropped.
      if (latest.current.canUndo) latest.current.flush();
    },
    [],
  );

  const getUndoProps = useCallback(
    (overrides?: UndoPropOverrides): UndoProps => ({
      type: "button",
      "aria-label": overrides?.altText ?? options.altText,
      onClick: (event) => {
        api.undo();
        overrides?.onClick?.(event);
      },
    }),
    [api, options.altText],
  );

  const undoProps = useMemo(() => getUndoProps(), [getUndoProps]);

  return { ...api, undoProps, getUndoProps, remainingMs, progress };
}
