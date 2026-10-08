/**
 * The diagnostics bus, and the single rule table behind it.
 *
 * This is the part of the library that creates demand rather than assuming it. A team that
 * does not yet believe they need an undo primitive will still believe the console when it
 * tells them, with a file and a line, that their delete has neither a confirmation step nor
 * an undo path.
 *
 * Three consumers read {@link RULES} and nothing re-states it:
 *
 * - `@unruffled/devtools` subscribes to this bus at runtime and formats warnings.
 * - `@unruffled/eslint-plugin` implements the statically decidable subset as lint rules.
 * - `@unruffled/testing` exposes `expectExhaustive()`, the test-time twin.
 *
 * Everything here is behind `__DEV__`, which tsdown replaces with `false` in the default
 * build. The rule table, the formatter and every call site collapse to nothing, so the
 * production bundle carries no diagnostics bytes at all. The `development` export condition
 * resolves to the build where `__DEV__` is `true`.
 */

/**
 * Stable diagnostic codes.
 *
 * Codes are permanent public API: they appear in consumer lint configs, suppression
 * comments and bug reports. A rule may be reworded or have its detection improved, but a
 * code is never reassigned to a different problem and never recycled after removal.
 */
export type DiagnosticCode =
  "UX1001" | "UX1002" | "UX1003" | "UX1004" | "UX1005" | "UX1006" | "UX1007" | "UX1008" | "UX1009";

export type DiagnosticSeverity = "error" | "warning";

export interface DiagnosticRule {
  readonly code: DiagnosticCode;
  /** One line, imperative, names the defect rather than the fix. */
  readonly title: string;
  /** Why this is wrong, in terms of what the user experiences. */
  readonly detail: string;
  /** The smallest change that resolves it. */
  readonly fix: string;
  readonly severity: DiagnosticSeverity;
  /** True when the condition is decidable from source alone, so the ESLint rule can own it. */
  readonly static: boolean;
  readonly docs: string;
}

const DOCS_BASE = "https://abdulmanan69.github.io/ui-ux/diagnostics";

const rule = (
  code: DiagnosticCode,
  title: string,
  detail: string,
  fix: string,
  severity: DiagnosticSeverity,
  isStatic: boolean,
): DiagnosticRule => ({
  code,
  title,
  detail,
  fix,
  severity,
  static: isStatic,
  docs: `${DOCS_BASE}/${code.toLowerCase()}/`,
});

/**
 * Every rule, keyed by code.
 *
 * Each one fires when the wiring is *wrong*. That is the opposite of the common pattern of
 * warning when an accessibility feature is enabled, which trains developers to disable the
 * warning rather than fix the code.
 */
export const RULES: Readonly<Record<DiagnosticCode, DiagnosticRule>> = {
  UX1001: rule(
    "UX1001",
    "Destructive action has neither a confirmation nor an undo path",
    "An irreversible action can be triggered by a single mis-click or a stray Enter on a focused control, and the user has no way back.",
    "Either wrap the action in useConfirm, or give it an undo window with useUndoable. One of the two is required when destructive is true.",
    "error",
    true,
  ),
  UX1002: rule(
    "UX1002",
    "Unkeyed action mutating a resource that already has a request in flight",
    "Two overlapping writes to the same resource land in nondeterministic order, so the value the user ends up with depends on network timing.",
    "Give the action a key derived from the resource identity. Actions sharing a key are serialised, and the guard rejects the duplicate synchronously.",
    "error",
    false,
  ),
  UX1003: rule(
    "UX1003",
    "Pending state lasted longer than the announcement threshold with no live region mounted",
    "A screen-reader user pressed a button, waited, and received no feedback that anything was happening or that it finished.",
    "Render <Announcer /> once near the root of the app. Announcement is on by default; mounting the region is the only step.",
    "error",
    false,
  ),
  UX1004: rule(
    "UX1004",
    "Action rejected with no failure classifier in scope",
    "The rejection reaches the console but not the user, so a failed save looks identical to a successful one.",
    "Pass the error to useFailure, or supply onError. useFailure also decides whether the failure is retryable and whether it belongs on a field.",
    "error",
    false,
  ),
  UX1005: rule(
    "UX1005",
    "disabled used on a control that has a gate reason",
    "A disabled element is removed from the tab order, so a keyboard or screen-reader user can neither reach the control nor discover why it is unavailable.",
    "Use the props from useGate instead. It keeps the control focusable, sets aria-disabled, suppresses activation and exposes the reason via aria-describedby.",
    "error",
    true,
  ),
  UX1006: rule(
    "UX1006",
    "Data region rendered with active filters but no emptyFiltered branch",
    "When filters match nothing the user sees the first-run empty state, which invites them to create a record they almost certainly already have.",
    "Handle the emptyFiltered case from useDataState and render its clearFilters recovery action.",
    "error",
    true,
  ),
  UX1007: rule(
    "UX1007",
    "Undo window scheduled with no navigation flush port",
    "The deferred write is lost if the user navigates or closes the tab before the window expires, so the UI claims a change that never happened.",
    "Provide the navigation port, which the React adapter supplies by default, or set flushOn to an empty array to accept the loss deliberately.",
    "error",
    false,
  ),
  UX1008: rule(
    "UX1008",
    "Form is dirty with no unsaved-changes guard",
    "Edits are lost silently on route change, tab close or dialog dismissal, which is where this data loss actually happens in admin tools.",
    "Wire useDirtyGuard to the form dirty flag. It covers all three exits; the dialog case is the one that is normally missed.",
    "warning",
    true,
  ),
  UX1009: rule(
    "UX1009",
    "ConfirmHost is mounted outside the application providers",
    "The dialog renders in a tree without your theme, router or query client, so its content cannot resolve context and may throw on open rather than on mount.",
    "Move <ConfirmHost /> inside the providers it depends on. It renders in place and does not need to be at the document root.",
    "warning",
    false,
  ),
};

/** A single reported problem. */
export interface DiagnosticEvent {
  readonly code: DiagnosticCode;
  readonly rule: DiagnosticRule;
  /** Machine id that reported it, when it came from a machine. */
  readonly machine?: string;
  /** Best guess at the consumer call site, taken from a captured stack. */
  readonly site?: string;
  /** Extra values worth printing, such as the elapsed pending duration. */
  readonly data?: Readonly<Record<string, unknown>>;
}

export type DiagnosticListener = (event: DiagnosticEvent) => void;

export interface DiagnosticsBus {
  /** Reports a problem. No-op in a production build. */
  report(code: DiagnosticCode, info?: Omit<DiagnosticEvent, "code" | "rule">): void;
  subscribe(listener: DiagnosticListener): () => void;
  /** Clears the de-duplication memory. Tests call this between cases. */
  reset(): void;
  /** Suppresses a code for the rest of the session. */
  suppress(code: DiagnosticCode): void;
  /** Every event reported so far, for assertions and for the devtools panel. */
  history(): readonly DiagnosticEvent[];
}

/** Frames matching these are library internals and are skipped when attributing a call site. */
const INTERNAL_FRAME = /(unruffled|node_modules)/;

/**
 * Best-effort consumer call site.
 *
 * Stack formats differ per engine, so this is presentation only: a missing site degrades the
 * message, never the detection.
 */
function captureSite(): string | undefined {
  const stack = new Error("site").stack;
  if (!stack) return undefined;
  for (const line of stack.split("\n").slice(2)) {
    const frame = line.trim();
    if (frame.length > 0 && !INTERNAL_FRAME.test(frame)) return frame.replace(/^at\s+/, "");
  }
  return undefined;
}

/** Cap on retained events so a long dev session cannot grow without bound. */
const MAX_HISTORY = 200;

export function createDiagnosticsBus(): DiagnosticsBus {
  const listeners = new Set<DiagnosticListener>();
  const seen = new Set<string>();
  const suppressed = new Set<DiagnosticCode>();
  const events: DiagnosticEvent[] = [];

  return {
    report(code, info) {
      if (!__DEV__) return;
      if (suppressed.has(code)) return;

      // One report per code per call site. Without this a rule inside a list row fires once
      // per row and buries everything else in the console.
      const site = info?.site ?? captureSite();
      const fingerprint = `${code}@${site ?? "unknown"}`;
      if (seen.has(fingerprint)) return;
      seen.add(fingerprint);

      const event: DiagnosticEvent = {
        code,
        rule: RULES[code],
        ...(info?.machine === undefined ? {} : { machine: info.machine }),
        ...(site === undefined ? {} : { site }),
        ...(info?.data === undefined ? {} : { data: info.data }),
      };

      events.push(event);
      if (events.length > MAX_HISTORY) events.shift();
      for (const listener of listeners) listener(event);
    },
    subscribe(listener) {
      if (!__DEV__) return () => {};
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    reset() {
      seen.clear();
      suppressed.clear();
      events.length = 0;
    },
    suppress(code) {
      suppressed.add(code);
    },
    history: () => events,
  };
}

/**
 * The process-wide bus.
 *
 * A singleton rather than a provider value on purpose: devtools must be able to attach
 * without the consumer threading anything through their tree, and a diagnostic reported
 * during module evaluation has no provider to reach.
 */
export const diagnostics: DiagnosticsBus = createDiagnosticsBus();

/**
 * Formats an event as the multi-line console message devtools prints.
 *
 * Lives in core so the ESLint plugin and the test matcher produce identical wording.
 */
export function formatDiagnostic(event: DiagnosticEvent): string {
  const lines = [
    `[unruffled ${event.code}] ${event.rule.title}`,
    "",
    event.rule.detail,
    "",
    `Fix: ${event.rule.fix}`,
  ];
  if (event.site) lines.push(`Site: ${event.site}`);
  if (event.machine) lines.push(`Machine: ${event.machine}`);
  if (event.data) {
    for (const [key, raw] of Object.entries(event.data)) lines.push(`${key}: ${String(raw)}`);
  }
  lines.push(`Docs: ${event.rule.docs}`);
  lines.push(`Suppress: diagnostics.suppress("${event.code}")`);
  return lines.join("\n");
}
