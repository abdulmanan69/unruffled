/**
 * `@unruffled/core` — the framework-agnostic half of the library.
 *
 * Nothing here imports a framework, touches a global, or emits a pixel. A framework adapter
 * drives {@link createService} and renders whatever `connect*` returns.
 */

export {
  createMachine,
  createService,
  hasTag,
  matches,
  type ActionFn,
  type AnyEvent,
  type EffectApi,
  type EffectFn,
  type GuardFn,
  type InternalEvent,
  type MachineApi,
  type MachineDefinition,
  type Service,
  type ServiceOptions,
  type Snapshot,
  type StateNode,
  type Transition,
  type TransitionConfig,
  type TransitionRecord,
} from "./machine.js";

export {
  defaultPorts,
  resolvePorts,
  type AnnouncerPort,
  type ClockPort,
  type Disposer,
  type DocPort,
  type FocusTarget,
  type InFlight,
  type LeaveReason,
  type LoggerPort,
  type NavigationPort,
  type Politeness,
  type Ports,
  type SchedulerPort,
  type StoragePort,
  type TransportPort,
} from "./ports.js";

/**
 * Diagnostics are deliberately NOT re-exported here.
 *
 * The rule table is about 2.5kB of English prose. Re-exporting it from the barrel put that
 * prose into the module graph of every production bundle, because a re-export keeps the
 * module alive no matter what `__DEV__` stripped from the call sites. Measured: the barrel
 * imported `./diagnostics.js` solely to re-export it.
 *
 * So the bus, the rule table and the formatter live on `@unruffled/core/diagnostics`, which
 * is imported by `@unruffled/devtools`, `@unruffled/eslint-plugin` and `@unruffled/testing`
 * and by nothing a production build reaches. Machines import it directly and call it only
 * inside `if (__DEV__)`, which leaves the import unreferenced and removable.
 *
 * The types are re-exported below: types are erased, so they cost nothing.
 */
export type {
  DiagnosticCode,
  DiagnosticEvent,
  DiagnosticListener,
  DiagnosticRule,
  DiagnosticSeverity,
  DiagnosticsBus,
} from "./diagnostics.js";

export { computeBackoff, DEFAULT_BACKOFF, parseRetryAfter, type BackoffPolicy } from "./shared/backoff.js";

export {
  createKeyRegistry,
  globalKeyRegistry,
  type KeyRegistry,
  type ReleaseFn,
} from "./shared/keyRegistry.js";

export {
  isAbort,
  normalizeError,
  type FailureKind,
  type FieldFailure,
  type NormalizedFailure,
  type NormalizeOptions,
} from "./shared/normalizeError.js";

export { createActionMachine } from "./machines/action/machine.js";
export {
  connectAction,
  type ActionApi,
  type ActionAttrs,
  type ActionStatus,
} from "./machines/action/connect.js";
export {
  ANNOUNCE_THRESHOLD_MS,
  DEFAULT_PENDING,
  type ActionAnnouncements,
  type ActionContext,
  type ActionEvent,
  type ActionProps,
  type ActionStateValue,
  type FocusPolicy,
  type GuardMode,
  type PendingPolicy,
  type RetryPolicy,
  type StashedOutcome,
} from "./machines/action/types.js";
