/**
 * The playground.
 *
 * Every knob here changes a real `useAction` call, not a simulation of one. The trace, the
 * failure panel, the diagnostics console and the code snippet are all reading the same live
 * machine, which is the point: you can reproduce the bug you are arguing about, see which
 * rule fires, and copy the configuration that fixed it.
 *
 * Three things are worth deliberately breaking while you are here:
 *
 * - Turn the live region off and run a slow save. UX1003 fires, because the outcome was
 *   announced into nothing.
 * - Turn on "destructive" without a recovery path. UX1001 fires.
 * - Turn the resource key off and double-click. UX1002 fires, because without a key the
 *   library cannot tell whether two triggers touch the same record.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { useAction, useAnnounce, useFailure, type Ports } from "@unruffled/react";
import { diagnostics, type DiagnosticEvent } from "@unruffled/core/diagnostics";
import TraceLane from "./trace/TraceLane.js";
import { useTraceSampler } from "./trace/useTraceSampler.js";
import { toPhase } from "./trace/types.js";
import "../styles/playground.css";

type OutcomeKey =
  "success" | "unavailable" | "forbidden" | "validation" | "rateLimited" | "network" | "aborted";

interface OutcomeOption {
  readonly key: OutcomeKey;
  readonly label: string;
  /** What the simulated request rejects with. `null` means it resolves. */
  readonly reject: unknown;
  readonly note: string;
}

const OUTCOMES: readonly OutcomeOption[] = [
  { key: "success", label: "Succeeds", reject: null, note: "Resolves normally." },
  {
    key: "unavailable",
    label: "503 Service Unavailable",
    reject: { status: 503 },
    note: "Retryable. An automatic retry will fire if attempts are above zero.",
  },
  {
    key: "forbidden",
    label: "403 Forbidden",
    reject: { status: 403 },
    note: "Not retryable. A retry button here would be a lie, so canRetry is false.",
  },
  {
    key: "validation",
    label: "422 with field errors",
    reject: { status: 422, body: { title: "Unprocessable", errors: { email: ["is already taken"] } } },
    note: "Belongs on the form, never in a toast. The field path is extracted for you.",
  },
  {
    key: "rateLimited",
    label: "429 with Retry-After: 30",
    reject: { status: 429, headers: { "retry-after": "30" } },
    note: "Retryable, but not yet. The countdown below is live.",
  },
  {
    key: "network",
    label: "Network error",
    reject: new TypeError("Failed to fetch"),
    note: "A fetch TypeError with no status and no body.",
  },
  {
    key: "aborted",
    label: "Aborted",
    reject: Object.assign(new Error("aborted"), { name: "AbortError" }),
    note: "A cancellation, not a failure. It returns to idle and is never announced.",
  },
];

interface Config {
  latencyMs: number;
  outcome: OutcomeKey;
  delayMs: number;
  minMs: number;
  keyed: boolean;
  destructive: boolean;
  reversible: boolean;
  announce: boolean;
  liveRegionMounted: boolean;
  retryAttempts: number;
}

const INITIAL: Config = {
  latencyMs: 700,
  outcome: "success",
  delayMs: 150,
  minMs: 400,
  keyed: true,
  destructive: false,
  reversible: false,
  announce: true,
  liveRegionMounted: true,
  retryAttempts: 0,
};

/** Axis width, rounded up so a run always fits with a little room after it. */
function windowFor(config: Config): number {
  const worst = config.latencyMs + config.delayMs + config.minMs;
  return Math.max(800, Math.ceil((worst * 1.25) / 200) * 200);
}

function buildSnippet(config: Config): string {
  const lines: string[] = [];
  lines.push("const save = useAction(");
  lines.push("  () => api.saveCustomer(form),");
  lines.push("  {");
  if (config.keyed) lines.push("    key: `customer:${id}`,");
  if (config.delayMs !== 150 || config.minMs !== 400) {
    lines.push(`    pending: { delay: ${String(config.delayMs)}, min: ${String(config.minMs)} },`);
  }
  if (config.destructive) lines.push("    destructive: true,");
  if (config.reversible) lines.push("    reversible: true,");
  if (config.retryAttempts > 0) lines.push(`    retry: { attempts: ${String(config.retryAttempts)} },`);
  lines.push(
    config.announce
      ? '    announce: { success: "Customer saved" },'
      : "    announce: false, // not recommended",
  );
  lines.push("    onError: (failure) => setFailure(failure),");
  lines.push("  },");
  lines.push(");");
  lines.push("");
  lines.push("<button {...save.triggerProps}>");
  lines.push('  {save.pending ? "Saving" : "Save customer"}');
  lines.push("</button>");
  return lines.join("\n");
}

export default function Playground() {
  const [config, setConfig] = useState<Config>(INITIAL);
  const [events, setEvents] = useState<readonly DiagnosticEvent[]>([]);
  const [runToken, setRunToken] = useState(0);

  const set = useCallback(<K extends keyof Config>(key: K, value: Config[K]): void => {
    setConfig((previous) => ({ ...previous, [key]: value }));
  }, []);

  const { announce } = useAnnounce();

  /**
   * The live-region toggle is a port override rather than an unmount of the real region, so
   * the demo exercises the same code path a real app does: `live()` is what UX1003 reads.
   */
  const ports = useMemo<Partial<Ports>>(
    () => ({ announcer: { announce, live: () => config.liveRegionMounted } }),
    [announce, config.liveRegionMounted],
  );

  const outcome = OUTCOMES.find((option) => option.key === config.outcome) ?? OUTCOMES[0];

  const run = useCallback(
    (_args: void, signal: AbortSignal) =>
      new Promise<string>((resolve, reject) => {
        const timer = setTimeout(() => {
          if (!outcome || outcome.reject === null) resolve("saved");
          else reject(outcome.reject);
        }, config.latencyMs);
        signal.addEventListener("abort", () => {
          clearTimeout(timer);
        });
      }),
    [outcome, config.latencyMs],
  );

  const options = useMemo(
    () => ({
      ports,
      ...(config.keyed ? { key: "customer:42" } : {}),
      pending: { delay: config.delayMs, min: config.minMs },
      destructive: config.destructive,
      reversible: config.reversible,
      ...(config.retryAttempts > 0
        ? { retry: { attempts: config.retryAttempts, backoff: { baseMs: 800, jitter: 0 } } }
        : {}),
      announce: config.announce ? ({ success: "Customer saved" } as const) : (false as const),
      resetAfterMs: false as const,
      onError: () => {
        // The failure panel renders it. Declared so UX1004 does not fire for a demo that is
        // deliberately producing failures.
      },
    }),
    [ports, config],
  );

  const save = useAction<string, void>(run, options);
  const second = useAction<string, void>(run, options);

  const failure = useFailure(save.failure, { ports });

  const windowMs = windowFor(config);
  const phase = toPhase(save.state, save.pending);
  const sample = useTraceSampler(save.busy, phase, windowMs, runToken);

  // Subscribe once. The bus de-duplicates by code and call site, so resetting it when the
  // configuration changes is what lets a rule fire again for the new configuration.
  useEffect(
    () =>
      diagnostics.subscribe((event) => {
        setEvents((previous) => [...previous, event]);
      }),
    [],
  );

  useEffect(() => {
    diagnostics.reset();
    setEvents([]);
  }, [config]);

  const snippet = buildSnippet(config);

  return (
    <div className="pg">
      <form
        className="pg__controls panel"
        onSubmit={(event) => {
          event.preventDefault();
        }}
      >
        <fieldset className="pg__group">
          <legend className="label">Request</legend>

          <label className="pg__field">
            <span className="pg__field-label">
              Latency <output>{config.latencyMs}ms</output>
            </span>
            <input
              type="range"
              min={0}
              max={3000}
              step={50}
              value={config.latencyMs}
              onChange={(event) => {
                set("latencyMs", Number(event.target.value));
              }}
            />
          </label>

          <label className="pg__field">
            <span className="pg__field-label">Outcome</span>
            <select
              value={config.outcome}
              onChange={(event) => {
                set("outcome", event.target.value as OutcomeKey);
              }}
            >
              {OUTCOMES.map((option) => (
                <option key={option.key} value={option.key}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
          <p className="pg__note">{outcome?.note}</p>

          <label className="pg__field">
            <span className="pg__field-label">
              Automatic retries <output>{config.retryAttempts}</output>
            </span>
            <input
              type="range"
              min={0}
              max={3}
              step={1}
              value={config.retryAttempts}
              onChange={(event) => {
                set("retryAttempts", Number(event.target.value));
              }}
            />
          </label>
        </fieldset>

        <fieldset className="pg__group">
          <legend className="label">Pending policy</legend>

          <label className="pg__field">
            <span className="pg__field-label">
              Delay before showing <output>{config.delayMs}ms</output>
            </span>
            <input
              type="range"
              min={0}
              max={600}
              step={10}
              value={config.delayMs}
              onChange={(event) => {
                set("delayMs", Number(event.target.value));
              }}
            />
          </label>

          <label className="pg__field">
            <span className="pg__field-label">
              Minimum visible <output>{config.minMs}ms</output>
            </span>
            <input
              type="range"
              min={0}
              max={1200}
              step={50}
              value={config.minMs}
              onChange={(event) => {
                set("minMs", Number(event.target.value));
              }}
            />
          </label>
          <p className="pg__note">
            Set latency below the delay and the affordance never appears. Set it just above and the minimum
            keeps it from flickering.
          </p>
        </fieldset>

        <fieldset className="pg__group">
          <legend className="label">Wiring</legend>

          <label className="pg__check">
            <input
              type="checkbox"
              checked={config.keyed}
              onChange={(event) => {
                set("keyed", event.target.checked);
              }}
            />
            <span>
              Resource key
              <small>Off: the two buttons stop contending, and UX1002 fires.</small>
            </span>
          </label>

          <label className="pg__check">
            <input
              type="checkbox"
              checked={config.destructive}
              onChange={(event) => {
                set("destructive", event.target.checked);
              }}
            />
            <span>
              Destructive action
              <small>On without a recovery path: UX1001 fires.</small>
            </span>
          </label>

          <label className="pg__check">
            <input
              type="checkbox"
              checked={config.reversible}
              disabled={!config.destructive}
              onChange={(event) => {
                set("reversible", event.target.checked);
              }}
            />
            <span>
              Has a recovery path
              <small>What a confirmation or undo window would set.</small>
            </span>
          </label>

          <label className="pg__check">
            <input
              type="checkbox"
              checked={config.announce}
              onChange={(event) => {
                set("announce", event.target.checked);
              }}
            />
            <span>
              Announce outcomes
              <small>On by default. Silence is the opt-out.</small>
            </span>
          </label>

          <label className="pg__check">
            <input
              type="checkbox"
              checked={config.liveRegionMounted}
              onChange={(event) => {
                set("liveRegionMounted", event.target.checked);
              }}
            />
            <span>
              Live region mounted
              <small>Off plus a slow request: UX1003 fires.</small>
            </span>
          </label>
        </fieldset>
      </form>

      <div className="pg__stage">
        <section className="pg__panel panel" aria-labelledby="pg-demo">
          <h2 id="pg-demo" className="pg__panel-title">
            Live
          </h2>

          <div className="pg__buttons">
            <button
              {...save.getTriggerProps({
                onClick: () => {
                  setRunToken((token) => token + 1);
                },
              })}
              className={`btn ${config.destructive ? "btn--danger" : "btn--primary"}`}
            >
              {save.pending ? <span className="spinner" aria-hidden="true" /> : null}
              {save.pending ? "Saving" : config.destructive ? "Delete customer" : "Save customer"}
            </button>

            <button {...second.triggerProps} className="btn">
              {second.pending ? <span className="spinner" aria-hidden="true" /> : null}
              Second component, same record
            </button>

            {save.state !== "idle" && (
              <button type="button" className="btn" onClick={save.reset}>
                Reset
              </button>
            )}
          </div>

          <p className="pg__hint">
            Double-click the first button, or press both quickly. With a resource key they contend; without
            one they both fire.
          </p>

          <dl className="trace__readout pg__readout">
            <div>
              <dt className="label">state</dt>
              <dd className={`trace__value trace__value--${phase}`}>{save.state}</dd>
            </div>
            <div>
              <dt className="label">attempt</dt>
              <dd className="trace__value">{save.attempt}</dd>
            </div>
            <div>
              <dt className="label">elapsed</dt>
              <dd className="trace__value">{Math.round(sample.elapsed)}ms</dd>
            </div>
            <div>
              <dt className="label">retry in</dt>
              <dd className="trace__value">
                {save.retryInMs === null ? "—" : `${String(Math.ceil(save.retryInMs / 100) / 10)}s`}
              </dd>
            </div>
          </dl>

          <TraceLane
            segments={sample.segments}
            elapsed={sample.elapsed}
            settledAt={sample.settledAt}
            windowMs={windowMs}
            pendingDelayMs={config.delayMs}
            pendingMinMs={config.minMs}
            outcome={config.outcome === "success" ? "success" : "failure"}
            axisStepMs={windowMs > 2000 ? 500 : 250}
          />
        </section>

        <section className="pg__panel panel" aria-labelledby="pg-failure">
          <h2 id="pg-failure" className="pg__panel-title">
            Failure
          </h2>

          {failure === null ? (
            <p className="pg__empty">No failure. Choose a failing outcome and run it.</p>
          ) : (
            <>
              <p {...failure.summaryProps} className="pg__failure-summary">
                {failure.message}
              </p>
              <dl className="pg__kv">
                <div>
                  <dt className="label">kind</dt>
                  <dd className={`trace__value trace__value--${failure.canRetry ? "shown" : "error"}`}>
                    {failure.kind}
                  </dd>
                </div>
                <div>
                  <dt className="label">status</dt>
                  <dd className="trace__value">{failure.status ?? "—"}</dd>
                </div>
                <div>
                  <dt className="label">canRetry</dt>
                  <dd className="trace__value">{String(failure.canRetry)}</dd>
                </div>
                <div>
                  <dt className="label">canRetryNow</dt>
                  <dd className="trace__value">{String(failure.canRetryNow)}</dd>
                </div>
                <div>
                  <dt className="label">retryInMs</dt>
                  <dd className="trace__value">
                    {failure.retryInMs === null ? "—" : String(Math.round(failure.retryInMs))}
                  </dd>
                </div>
              </dl>

              {failure.fields && failure.fields.length > 0 && (
                <ul className="pg__fields">
                  {failure.fields.map((field) => (
                    <li key={field.path}>
                      <code>{field.path}</code> {field.message}
                    </li>
                  ))}
                </ul>
              )}

              {failure.canRetryNow && (
                <button type="button" className="btn" onClick={save.retry}>
                  Try again
                </button>
              )}
            </>
          )}
        </section>

        <section className="pg__panel panel" aria-labelledby="pg-diagnostics">
          <h2 id="pg-diagnostics" className="pg__panel-title">
            Diagnostics
          </h2>

          {events.length === 0 ? (
            <p className="pg__empty">
              Nothing reported. This configuration is sound. Break something in the Wiring panel.
            </p>
          ) : (
            <ul className="pg__diagnostics">
              {events.map((event, index) => (
                <li key={`${event.code}-${String(index)}`} data-severity={event.rule.severity}>
                  <p className="pg__diag-head">
                    <code>{event.code}</code> {event.rule.title}
                  </p>
                  <p className="pg__diag-detail">{event.rule.detail}</p>
                  <p className="pg__diag-fix">Fix: {event.rule.fix}</p>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="pg__panel panel" aria-labelledby="pg-code">
          <h2 id="pg-code" className="pg__panel-title">
            Your configuration
          </h2>
          <pre className="pg__code">
            <code>{snippet}</code>
          </pre>
        </section>
      </div>
    </div>
  );
}
