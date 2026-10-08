/**
 * The machine runtime.
 *
 * Every behaviour in this library is a flat state machine whose *structure* is plain data
 * and whose *behaviour* is a lookup table of named implementations. That split is what buys:
 *
 * - **Inspectability.** States, transitions and guard names are serialisable, so the
 *   devtools overlay can render a real diagram and a transition log without instrumenting
 *   anything.
 * - **Portability.** Nothing here imports React, touches a global, or reads the DOM. A
 *   framework adapter only has to drive {@link createService} and subscribe to it.
 * - **Testability.** Timers arrive through ports, so timed behaviour is asserted by
 *   advancing a fake clock.
 *
 * Deliberate non-features: no nested states, no parallel regions, no history states, no
 * actor spawning. All thirteen primitives in this library are expressible as flat machines
 * with effects, and every one of those features costs bytes that a UX library should not be
 * charging for.
 *
 * Derived values are intentionally *not* part of the machine. They belong in each machine's
 * `connect()` layer, where they are computed from a snapshot on read. A `computed` map in
 * the runtime would mean a second cache to invalidate and keep correct for no gain.
 */

import { resolvePorts, type Disposer, type Ports } from "./ports.js";

/** Base shape of every event. Payload fields live alongside `type`. */
export interface AnyEvent {
  readonly type: string;
}

/**
 * Events the runtime synthesises.
 *
 * Machines include this in their event union so a `switch` over `event.type` stays
 * exhaustive. `unruffled.init` runs initial entry actions and effects; `unruffled.props`
 * re-evaluates eventless transitions after the host replaces props.
 */
export type InternalEvent = { readonly type: "unruffled.init" } | { readonly type: "unruffled.props" };

/** What a guard, action or effect is handed. One object, so adding a capability is not a breaking change. */
export interface MachineApi<C, P, E extends AnyEvent> {
  /** Context as of the start of this transition. */
  readonly context: C;
  /** Current props. Owned by the host, not by the machine. */
  readonly props: P;
  /** The event that triggered this transition. */
  readonly event: E;
  /** Shallow-merges a patch into context. Multiple calls within one transition accumulate. */
  readonly assign: (patch: Partial<C>) => void;
  /** Queues an event. It is processed after the current transition completes, never re-entrantly. */
  readonly send: (event: E) => void;
  readonly ports: Ports;
}

/** What a long-lived effect is handed. Values are getters because an effect outlives its transition. */
export interface EffectApi<C, P, E extends AnyEvent> {
  readonly context: () => C;
  readonly props: () => P;
  readonly assign: (patch: Partial<C>) => void;
  readonly send: (event: E) => void;
  readonly ports: Ports;
}

export type GuardFn<C, P, E extends AnyEvent> = (
  api: Omit<MachineApi<C, P, E>, "assign" | "send">,
) => boolean;
export type ActionFn<C, P, E extends AnyEvent> = (api: MachineApi<C, P, E>) => void;
export type EffectFn<C, P, E extends AnyEvent> = (api: EffectApi<C, P, E>) => Disposer | undefined;

/**
 * One candidate transition.
 *
 * Candidates are evaluated in array order and the first whose guard passes is taken, which
 * is how a single event produces different outcomes from the same state.
 */
export interface Transition<S extends string> {
  /** Omit for a self-transition that runs actions without re-entering the state. */
  readonly target?: S;
  /** Name of a guard in `implementations.guards`. Prefix with `!` to negate. */
  readonly guard?: string;
  /** Names of actions in `implementations.actions`, run in order. */
  readonly actions?: readonly string[];
}

/** A transition may be written as a single candidate or a prioritised list. */
export type TransitionConfig<S extends string> = Transition<S> | readonly Transition<S>[];

export interface StateNode<S extends string> {
  /** Actions run when this state is entered. */
  readonly entry?: readonly string[];
  /** Actions run when this state is left. */
  readonly exit?: readonly string[];
  /** Effects started on entry and disposed on exit. Named from `implementations.effects`. */
  readonly effects?: readonly string[];
  /** Event-driven transitions available in this state. */
  readonly on?: Readonly<Record<string, TransitionConfig<S>>>;
  /**
   * Eventless transitions, re-evaluated after every transition and after every props change.
   *
   * This is how a state settles itself, for example leaving `settling` once the minimum
   * pending duration has elapsed.
   */
  readonly always?: TransitionConfig<S>;
  /** Free-form labels queried with {@link hasTag} or read off a snapshot. */
  readonly tags?: readonly string[];
}

export interface MachineDefinition<C, P, E extends AnyEvent, S extends string> {
  readonly id: string;
  readonly initial: S;
  /** Builds initial context from props. Called once per service. */
  readonly context: (props: P) => C;
  readonly states: Readonly<Record<S, StateNode<S>>>;
  /** Transitions available in every state. A state-local handler for the same event wins. */
  readonly on?: Readonly<Record<string, TransitionConfig<S>>>;
  readonly implementations: {
    readonly guards?: Readonly<Record<string, GuardFn<C, P, E>>>;
    readonly actions?: Readonly<Record<string, ActionFn<C, P, E>>>;
    readonly effects?: Readonly<Record<string, EffectFn<C, P, E>>>;
  };
}

/** Immutable view of a machine at a point in time. Plain data, safe to compare by reference. */
export interface Snapshot<C, S extends string> {
  readonly value: S;
  readonly context: C;
  readonly tags: readonly string[];
  /** Increments on every committed change. Cheap identity for memoisation. */
  readonly revision: number;
}

export interface Service<C, P, E extends AnyEvent, S extends string> {
  readonly getSnapshot: () => Snapshot<C, S>;
  /** Returns a disposer. Listeners are called once per committed change, never mid-transition. */
  readonly subscribe: (listener: (snapshot: Snapshot<C, S>) => void) => Disposer;
  readonly send: (event: E) => void;
  /** True when `type` has at least one candidate whose guard currently passes. */
  readonly can: (type: E["type"]) => boolean;
  /** Replaces props and re-evaluates eventless transitions. */
  readonly setProps: (props: P) => void;
  readonly getProps: () => P;
  /** Disposes active effects and detaches all listeners. Idempotent. */
  readonly stop: () => void;
  readonly definition: MachineDefinition<C, P, E, S>;
  readonly ports: Ports;
}

export interface ServiceOptions<P> {
  props: P;
  ports?: Partial<Ports>;
  /** Called for every transition attempt, taken or not. The devtools overlay uses this. */
  onTransition?: (record: TransitionRecord) => void;
}

/** One transition attempt, as reported to {@link ServiceOptions.onTransition}. */
export interface TransitionRecord {
  readonly machine: string;
  readonly event: string;
  readonly from: string;
  readonly to: string;
  readonly taken: boolean;
  /** Guard that rejected the only candidate, when nothing was taken. */
  readonly blockedBy?: string;
}

/**
 * Upper bound on consecutive eventless transitions.
 *
 * A machine that trips this has a cycle in its `always` chain. Throwing beats hanging the
 * browser, and the thrown error names the machine and the state it was stuck in.
 */
const MAX_ALWAYS_CHAIN = 64;

const EMPTY_TAGS: readonly string[] = [];

/**
 * Narrows a transition config to the list form.
 *
 * A dedicated predicate rather than an inline `Array.isArray`: on a readonly array type that
 * call widens to `any[]` and narrows neither branch, so both the list and the single-candidate
 * paths would lose their types.
 */
function isTransitionList<S extends string>(config: TransitionConfig<S>): config is readonly Transition<S>[] {
  return Array.isArray(config);
}

function toCandidates<S extends string>(config: TransitionConfig<S> | undefined): readonly Transition<S>[] {
  if (!config) return [];
  return isTransitionList(config) ? config : [config];
}

/** True when `snapshot` is in any of `values`. Kept off the snapshot so snapshots stay plain data. */
export function matches<C, S extends string>(snapshot: Snapshot<C, S>, ...values: readonly S[]): boolean {
  return values.includes(snapshot.value);
}

/** True when `snapshot` carries `tag`. */
export function hasTag<C, S extends string>(snapshot: Snapshot<C, S>, tag: string): boolean {
  return snapshot.tags.includes(tag);
}

/**
 * Declares a machine.
 *
 * Exists for inference rather than behaviour: it returns its argument unchanged so the four
 * type parameters are fixed once, at the definition site.
 */
export function createMachine<C, P, E extends AnyEvent, S extends string>(
  definition: MachineDefinition<C, P, E, S>,
): MachineDefinition<C, P, E, S> {
  return definition;
}

export function createService<C, P, E extends AnyEvent, S extends string>(
  definition: MachineDefinition<C, P, E, S>,
  options: ServiceOptions<P>,
): Service<C, P, E, S> {
  const ports = resolvePorts(options.ports);
  const { guards = {}, actions = {}, effects = {} } = definition.implementations;

  let props = options.props;
  let value = definition.initial;
  let context = definition.context(props);
  let revision = 0;
  let stopped = false;

  const tagsOf = (state: S): readonly string[] => definition.states[state].tags ?? EMPTY_TAGS;

  let snapshot: Snapshot<C, S> = { value, context, tags: tagsOf(value), revision };

  const listeners = new Set<(snapshot: Snapshot<C, S>) => void>();
  let activeEffects: Disposer[] = [];

  /** Events queued by actions during a transition, drained once the transition commits. */
  const queue: E[] = [];
  let draining = false;
  /** Set while a transition is in flight so listeners only ever see committed states. */
  const flags = { dirty: false };

  const node = (): StateNode<S> => definition.states[value];

  const commit = (): void => {
    revision += 1;
    snapshot = { value, context, tags: tagsOf(value), revision };
    for (const listener of listeners) listener(snapshot);
  };

  const effectApi: EffectApi<C, P, E> = {
    context: () => context,
    props: () => props,
    assign: (patch) => {
      context = { ...context, ...patch };
      if (draining) flags.dirty = true;
      else commit();
    },
    send: (event) => {
      enqueue(event);
    },
    ports,
  };

  const startEffects = (): void => {
    const names = node().effects;
    if (!names) return;
    for (const name of names) {
      const effect = effects[name];
      if (!effect) {
        throw new Error(`[unruffled] ${definition.id}: unknown effect "${name}"`);
      }
      const dispose = effect(effectApi);
      if (dispose) activeEffects.push(dispose);
    }
  };

  const stopEffects = (): void => {
    const running = activeEffects;
    activeEffects = [];
    for (const dispose of running) dispose();
  };

  const checkGuard = (name: string | undefined, event: E): { pass: boolean; blockedBy?: string } => {
    if (!name) return { pass: true };
    const negated = name.startsWith("!");
    const key = negated ? name.slice(1) : name;
    const guard = guards[key];
    if (!guard) {
      throw new Error(`[unruffled] ${definition.id}: unknown guard "${key}"`);
    }
    const raw = guard({ context, props, event, ports });
    const pass = negated ? !raw : raw;
    return pass ? { pass } : { pass, blockedBy: name };
  };

  const runActions = (names: readonly string[] | undefined, event: E): void => {
    if (!names) return;
    const api: MachineApi<C, P, E> = {
      context,
      props,
      event,
      assign: (patch) => {
        context = { ...context, ...patch };
        flags.dirty = true;
      },
      send: (next) => {
        queue.push(next);
      },
      ports,
    };
    for (const name of names) {
      const action = actions[name];
      if (!action) {
        throw new Error(`[unruffled] ${definition.id}: unknown action "${name}"`);
      }
      // `api.context` is a snapshot from transition start by design: actions declare what
      // changes, they do not read each other's partial writes. Re-reading here would make
      // action order load-bearing in a way the data structure cannot express.
      action(api);
    }
  };

  /** Resolves and takes one transition. Returns true when a transition was taken. */
  const step = (event: E, candidates: readonly Transition<S>[]): boolean => {
    let blockedBy: string | undefined;

    for (const candidate of candidates) {
      const verdict = checkGuard(candidate.guard, event);
      if (!verdict.pass) {
        blockedBy ??= verdict.blockedBy;
        continue;
      }

      const from = value;
      const changingState = candidate.target !== undefined && candidate.target !== from;
      const to = candidate.target ?? from;

      if (changingState) {
        stopEffects();
        runActions(definition.states[from].exit, event);
      }
      runActions(candidate.actions, event);
      if (changingState) {
        value = to;
        runActions(definition.states[to].entry, event);
      }
      flags.dirty = true;

      options.onTransition?.({ machine: definition.id, event: event.type, from, to, taken: true });

      if (changingState) startEffects();
      return true;
    }

    options.onTransition?.({
      machine: definition.id,
      event: event.type,
      from: value,
      to: value,
      taken: false,
      ...(blockedBy === undefined ? {} : { blockedBy }),
    });
    return false;
  };

  /** Runs eventless transitions until the machine is stable. */
  const settle = (event: E): void => {
    for (let i = 0; i < MAX_ALWAYS_CHAIN; i += 1) {
      const always = node().always;
      if (!always) return;
      if (!step(event, toCandidates(always))) return;
    }
    throw new Error(
      `[unruffled] ${definition.id}: eventless transition chain exceeded ${String(MAX_ALWAYS_CHAIN)} steps at "${value}". Check the always conditions for a cycle.`,
    );
  };

  const drain = (): void => {
    if (draining) return;
    draining = true;
    try {
      for (;;) {
        const event = queue.shift();
        if (event === undefined) break;
        const local = node().on?.[event.type];
        const candidates = toCandidates(local ?? definition.on?.[event.type]);
        if (candidates.length > 0) step(event, candidates);
        settle(event);
      }
    } finally {
      draining = false;
      if (flags.dirty) {
        flags.dirty = false;
        commit();
      }
    }
  };

  function enqueue(event: E): void {
    if (stopped) return;
    queue.push(event);
    drain();
  }

  // Entry actions and effects of the initial state run on construction, so a machine that is
  // born busy (an undo window restored from storage, for example) is correct before first read.
  const initEvent = { type: "unruffled.init" } as E;
  runActions(node().entry, initEvent);
  startEffects();
  settle(initEvent);
  if (flags.dirty) {
    flags.dirty = false;
    revision += 1;
    snapshot = { value, context, tags: tagsOf(value), revision };
  }

  return {
    getSnapshot: () => snapshot,
    subscribe: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    send: enqueue,
    can: (type) => {
      const local = node().on?.[type];
      const candidates = toCandidates(local ?? definition.on?.[type]);
      const probe = { type } as E;
      return candidates.some((candidate) => checkGuard(candidate.guard, probe).pass);
    },
    setProps: (next) => {
      if (stopped) return;
      props = next;
      const event = { type: "unruffled.props" } as E;
      settle(event);
      if (flags.dirty) {
        flags.dirty = false;
        commit();
      }
    },
    getProps: () => props,
    stop: () => {
      if (stopped) return;
      stopped = true;
      stopEffects();
      listeners.clear();
      queue.length = 0;
    },
    definition,
    ports,
  };
}
