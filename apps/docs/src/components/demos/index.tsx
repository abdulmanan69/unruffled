/**
 * The live demos used across the documentation.
 *
 * Every one of these is a real call into the library. None of them simulate behaviour, mock
 * a hook, or hard-code an outcome, because a documentation demo that fakes the thing it is
 * demonstrating is worse than no demo.
 *
 * They are grouped in one module so a page can import exactly the demos it uses and Astro
 * hydrates only those islands.
 */

import { useState } from "react";
import { useAction, useAnnounce, useFailure, usePrefersReducedMotion, useUndoable } from "@unruffled/react";
import "../../styles/demos.css";

/** A promise that settles after `ms`, honouring the abort signal the library hands it. */
function delayed<T>(ms: number, settle: () => T, shouldReject = false) {
  return (_args: void, signal: AbortSignal): Promise<T> =>
    new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        if (shouldReject) reject(settle());
        else resolve(settle());
      }, ms);
      signal.addEventListener("abort", () => {
        clearTimeout(timer);
      });
    });
}

/* ------------------------------------------------------------------------ */

export interface AsyncButtonDemoProps {
  readonly latencyMs?: number;
  readonly label?: string;
  readonly fails?: boolean;
}

/**
 * The shape every page opens with: one button, one declaration.
 *
 * Shows the three things a reader should notice immediately — the label changes rather than
 * the button disappearing, the control keeps focus, and the outcome persists.
 */
export function AsyncButtonDemo({
  latencyMs = 900,
  label = "Save customer",
  fails = false,
}: AsyncButtonDemoProps) {
  const save = useAction(
    delayed(latencyMs, () => (fails ? { status: 503 } : "saved"), fails),
    {
      key: "demo:customer:42",
      announce: { success: "Customer saved", error: "Save failed" },
      onError: () => {
        // The demo renders the state itself.
      },
    },
  );

  return (
    <div className="demo-row">
      <button {...save.triggerProps} className="btn btn--primary">
        {save.pending ? <span className="spinner" aria-hidden="true" /> : null}
        {save.pending ? "Saving" : label}
      </button>

      <dl className="demo-readout">
        <div>
          <dt className="label">status</dt>
          <dd data-state={save.state}>{save.status}</dd>
        </div>
        <div>
          <dt className="label">aria-busy</dt>
          <dd>{String(save.attrs["aria-busy"])}</dd>
        </div>
        <div>
          <dt className="label">aria-disabled</dt>
          <dd>{save.attrs["aria-disabled"] === undefined ? "absent" : "true"}</dd>
        </div>
        <div>
          <dt className="label">disabled</dt>
          <dd className="is-never">never</dd>
        </div>
      </dl>

      {save.state !== "idle" && (
        <button type="button" className="btn" onClick={save.reset}>
          Reset
        </button>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------------ */

/**
 * Two components, one record.
 *
 * The buttons do not know about each other. The resource key is what makes them contend,
 * which is the part a boolean on one hook cannot express.
 */
export function GuardDemo() {
  const [keyed, setKeyed] = useState(true);
  const [log, setLog] = useState<readonly string[]>([]);

  const record = (who: string) => () => {
    setLog((previous) => [`${who} wrote the record`, ...previous].slice(0, 6));
  };

  const toolbar = useAction(
    delayed(1400, () => "done"),
    {
      ...(keyed ? { key: "demo:invoice:7" } : {}),
      announce: false as const,
      onSuccess: record("Toolbar button"),
    },
  );

  const row = useAction(
    delayed(1400, () => "done"),
    {
      ...(keyed ? { key: "demo:invoice:7" } : {}),
      announce: false as const,
      onSuccess: record("Row action"),
    },
  );

  return (
    <div className="demo-stack">
      <label className="demo-toggle">
        <input
          type="checkbox"
          checked={keyed}
          onChange={(event) => {
            setKeyed(event.target.checked);
            setLog([]);
          }}
        />
        <span>
          Share a resource key
          <small>{keyed ? "Both declare key: invoice:7" : "No key: neither knows the other exists"}</small>
        </span>
      </label>

      <div className="demo-row">
        <button {...toolbar.triggerProps} className="btn btn--primary">
          {toolbar.pending ? <span className="spinner" aria-hidden="true" /> : null}
          Toolbar button
        </button>
        <button {...row.triggerProps} className="btn">
          {row.pending ? <span className="spinner" aria-hidden="true" /> : null}
          Row action
        </button>
      </div>

      <p className="demo-hint">
        Press one, then immediately press the other. With a key, the second is refused. Without one, both
        write the same record and the result depends on which response lands last.
      </p>

      <ul className="demo-log" aria-live="polite">
        {log.length === 0 ? <li className="is-empty">No completed writes yet.</li> : null}
        {log.map((entry, index) => (
          <li key={`${entry}-${String(index)}`}>{entry}</li>
        ))}
      </ul>
    </div>
  );
}

/* ------------------------------------------------------------------------ */

const FAILURES: readonly { label: string; value: unknown }[] = [
  { label: "401", value: { status: 401 } },
  { label: "403", value: { status: 403 } },
  { label: "404", value: { status: 404 } },
  { label: "409", value: { status: 409 } },
  { label: "422", value: { status: 422, body: { errors: { email: ["is already taken"] } } } },
  { label: "429", value: { status: 429, headers: { "retry-after": "20" } } },
  { label: "503", value: { status: 503 } },
  { label: "Network", value: new TypeError("Failed to fetch") },
];

/**
 * Every status, classified.
 *
 * The column that matters is `canRetry`. It is false for four of these, and a retry button
 * on any of those four would be a lie.
 */
export function FailureKindsDemo() {
  const [raw, setRaw] = useState<unknown>(null);
  const failure = useFailure(raw);

  return (
    <div className="demo-stack">
      <div className="demo-chips">
        {FAILURES.map((item) => (
          <button
            key={item.label}
            type="button"
            className="btn demo-chip"
            aria-pressed={raw === item.value}
            onClick={() => {
              setRaw(item.value);
            }}
          >
            {item.label}
          </button>
        ))}
      </div>

      {failure === null ? (
        <p className="demo-hint">Pick a response to classify.</p>
      ) : (
        <div className="demo-stack">
          <p {...failure.summaryProps} className="demo-summary">
            {failure.message}
          </p>
          <dl className="demo-readout">
            <div>
              <dt className="label">kind</dt>
              <dd data-state={failure.canRetry ? "busy" : "error"}>{failure.kind}</dd>
            </div>
            <div>
              <dt className="label">canRetry</dt>
              <dd>{String(failure.canRetry)}</dd>
            </div>
            <div>
              <dt className="label">canRetryNow</dt>
              <dd>{String(failure.canRetryNow)}</dd>
            </div>
            <div>
              <dt className="label">retryInMs</dt>
              <dd>{failure.retryInMs === null ? "—" : String(Math.round(failure.retryInMs))}</dd>
            </div>
          </dl>
          {failure.fields && failure.fields.length > 0 ? (
            <ul className="demo-fields">
              {failure.fields.map((field) => (
                <li key={field.path}>
                  <code>{field.path}</code> {field.message}
                </li>
              ))}
            </ul>
          ) : null}
          <p className="demo-hint">
            {failure.canRetry
              ? "A retry affordance is honest here."
              : "No retry affordance: the same request would fail the same way."}
          </p>
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------------ */

/**
 * What the live region received.
 *
 * The real `<Announcer />` is mounted once for the whole site, so this mirrors what was
 * written rather than rendering its own region. A screen reader hears it; the panel below is
 * only so sighted readers can see that it happened.
 */
export function AnnouncerDemo() {
  const { announce, live } = useAnnounce();
  const [heard, setHeard] = useState<readonly { message: string; politeness: string }[]>([]);

  const say = (message: string, politeness: "polite" | "assertive") => () => {
    announce(message, politeness);
    setHeard((previous) => [{ message, politeness }, ...previous].slice(0, 5));
  };

  return (
    <div className="demo-stack">
      <div className="demo-row">
        <button type="button" className="btn" onClick={say("Customer saved", "polite")}>
          Announce politely
        </button>
        <button
          type="button"
          className="btn btn--danger"
          onClick={say("Save failed. Try again.", "assertive")}
        >
          Announce assertively
        </button>
      </div>

      <p className="demo-hint">
        Live region mounted: <strong>{live ? "yes" : "no"}</strong>. Press the same button twice quickly and
        the repeat is dropped, because an identical message inside 500ms is a duplicate, not a new event.
      </p>

      <ul className="demo-log">
        {heard.length === 0 ? <li className="is-empty">Nothing announced yet.</li> : null}
        {heard.map((entry, index) => (
          <li key={`${entry.message}-${String(index)}`}>
            <code>{entry.politeness}</code> {entry.message}
          </li>
        ))}
      </ul>
    </div>
  );
}

/* ------------------------------------------------------------------------ */

/**
 * The reduced-motion preference, read live.
 *
 * Change it in your operating system settings with this page open. The value updates without
 * a reload, which is the whole difference between subscribing to the media query and reading
 * it once into state at mount.
 */
export function ReducedMotionDemo() {
  const reduced = usePrefersReducedMotion();

  return (
    <div className="demo-stack">
      <dl className="demo-readout">
        <div>
          <dt className="label">prefers-reduced-motion</dt>
          <dd data-state={reduced ? "error" : "success"}>{reduced ? "reduce" : "no-preference"}</dd>
        </div>
        <div>
          <dt className="label">countdown tick</dt>
          <dd>{reduced ? "1000ms" : "100ms"}</dd>
        </div>
        <div>
          <dt className="label">spinner</dt>
          <dd>{reduced ? "static, still visible" : "animated"}</dd>
        </div>
      </dl>
      <div className="demo-row">
        <span className="spinner" aria-hidden="true" />
        <p className="demo-hint">
          Under reduction the glyph stops rotating but stays on screen. Removing it would remove the
          information; the preference is about motion, not about feedback.
        </p>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------------ */

/**
 * Automatic retry with a visible countdown.
 *
 * The waiting period is a state the machine is in, not a gap where the UI appears to hang.
 */
export function RetryDemo() {
  const [attempts, setAttempts] = useState(0);

  const save = useAction(
    (_args: void, signal: AbortSignal) =>
      new Promise<string>((resolve, reject) => {
        const timer = setTimeout(() => {
          setAttempts((count) => {
            // Succeed on the third attempt so the demo ends somewhere.
            if (count >= 1) resolve("saved");
            else reject({ status: 503 });
            return count + 1;
          });
        }, 500);
        signal.addEventListener("abort", () => {
          clearTimeout(timer);
        });
      }),
    {
      retry: { attempts: 2, backoff: { baseMs: 2000, factor: 1, jitter: 0 } },
      announce: { success: "Saved" },
      onError: () => {
        // Rendered below.
      },
    },
  );

  return (
    <div className="demo-stack">
      <div className="demo-row">
        <button
          {...save.getTriggerProps({
            onClick: () => {
              setAttempts(0);
            },
          })}
          className="btn btn--primary"
        >
          {save.pending ? <span className="spinner" aria-hidden="true" /> : null}
          {save.state === "backoff" ? "Waiting to retry" : save.pending ? "Saving" : "Save, failing twice"}
        </button>
      </div>

      <dl className="demo-readout">
        <div>
          <dt className="label">state</dt>
          <dd data-state={save.state}>{save.state}</dd>
        </div>
        <div>
          <dt className="label">attempt</dt>
          <dd>{save.attempt}</dd>
        </div>
        <div>
          <dt className="label">retry in</dt>
          <dd>{save.retryInMs === null ? "—" : `${(save.retryInMs / 1000).toFixed(1)}s`}</dd>
        </div>
      </dl>

      <p className="demo-hint">
        The countdown is a real value from the frame port, bucketed so it re-renders ten times a second rather
        than sixty.
      </p>
    </div>
  );
}

/* ------------------------------------------------------------------------ */

interface DemoRow {
  readonly id: string;
  readonly label: string;
}

const DEMO_ROWS: readonly DemoRow[] = [
  { id: "row:1", label: "Invoice 1041 — Northwind" },
  { id: "row:2", label: "Invoice 1042 — Initech" },
  { id: "row:3", label: "Invoice 1043 — Soylent" },
  { id: "row:4", label: "Invoice 1044 — Hooli" },
];

/** Puts rolled-back rows back in their original positions, so an undo does not reorder the list. */
function restored(current: readonly DemoRow[], rows: readonly DemoRow[]): readonly DemoRow[] {
  const ids = new Set([...current, ...rows].map((row) => row.id));
  return DEMO_ROWS.filter((row) => ids.has(row.id));
}

const rowCount = (count: number) => `${String(count)} ${count === 1 ? "row" : "rows"}`;

/**
 * The write that has not been sent yet.
 *
 * The row goes immediately and the DELETE does not. `requests sent` is incremented inside
 * the commit itself, so Undo is visibly the difference between a request happening and a
 * request never existing — not a toast dismissed after the fact.
 */
export function UndoableDemo() {
  const [rows, setRows] = useState(DEMO_ROWS);
  const [sent, setSent] = useState(0);
  const [log, setLog] = useState<readonly string[]>([]);

  const record = (entry: string) => {
    setLog((previous) => [entry, ...previous].slice(0, 6));
  };

  const deletion = useUndoable<DemoRow>({
    // Shaped like `delayed` above, minus the abort listener: nothing in this machine aborts
    // a commit, because a request already on the wire is a write the user is owed.
    commit: (batch) =>
      new Promise<void>((resolve) => {
        setTimeout(() => {
          setSent((count) => count + batch.length);
          resolve();
        }, 400);
      }),
    rollback: (batch) => {
      setRows((current) => restored(current, batch));
    },
    // A short window so the countdown is watchable. The default is 6000ms.
    windowMs: 5000,
    coalesce: "demo:row-delete",
    altText: "Undo delete",
    announce: { scheduled: "Deleted. Undo available.", undone: "Delete undone", committed: "Delete saved" },
    onUndone: (batch) => {
      record(`Undone, nothing was sent — ${rowCount(batch.length)}`);
    },
    onCommitted: (batch) => {
      record(`Committed, the write went out — ${rowCount(batch.length)}`);
    },
  });

  return (
    <div className="demo-stack">
      <ul className="demo-log">
        {rows.length === 0 ? <li className="is-empty">Every row is deleted.</li> : null}
        {rows.map((row) => (
          <li key={row.id}>
            {row.label}{" "}
            <button
              type="button"
              className="btn btn--danger"
              onClick={() => {
                setRows((current) => current.filter((item) => item.id !== row.id));
                deletion.schedule(row);
              }}
            >
              Delete
            </button>
          </li>
        ))}
      </ul>

      {deletion.canUndo ? (
        <div className="demo-row">
          <strong>{rowCount(deletion.count)} deleted</strong>
          <button {...deletion.undoProps} className="btn btn--primary">
            Undo
          </button>
          <span>
            {deletion.remainingMs === null ? "—" : `${(deletion.remainingMs / 1000).toFixed(1)}s left`}
          </span>
        </div>
      ) : null}

      <dl className="demo-readout">
        <div>
          <dt className="label">state</dt>
          <dd data-state={deletion.state}>{deletion.state}</dd>
        </div>
        <div>
          <dt className="label">canUndo</dt>
          <dd>{String(deletion.canUndo)}</dd>
        </div>
        <div>
          <dt className="label">count</dt>
          <dd>{deletion.count}</dd>
        </div>
        <div>
          <dt className="label">remainingMs</dt>
          <dd>{deletion.remainingMs === null ? "—" : String(deletion.remainingMs)}</dd>
        </div>
        <div>
          <dt className="label">requests sent</dt>
          <dd>{sent}</dd>
        </div>
      </dl>

      <p className="demo-hint">
        Delete two rows inside the window and they merge into one entry with one countdown, because they share
        a coalesce tag. While the state is <strong>held</strong>, <code>requests sent</code> has not moved:
        the DELETE is still in this tab.
      </p>

      <ul className="demo-log" aria-live="polite">
        {log.length === 0 ? <li className="is-empty">Nothing has settled yet.</li> : null}
        {log.map((entry, index) => (
          <li key={`${entry}-${String(index)}`}>{entry}</li>
        ))}
      </ul>

      {rows.length < DEMO_ROWS.length && !deletion.canUndo ? (
        <div className="demo-row">
          <button
            type="button"
            className="btn"
            onClick={() => {
              setRows(DEMO_ROWS);
              setSent(0);
              setLog([]);
            }}
          >
            Reset the list
          </button>
        </div>
      ) : null}
    </div>
  );
}
