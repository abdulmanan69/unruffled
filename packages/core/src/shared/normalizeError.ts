/**
 * Error normalisation: one shape for every way a request can fail.
 *
 * `err.message` is not an error UX. What a user needs to know is whether the thing they did
 * can be tried again, whether it is their input that is wrong, whether they are signed out,
 * and how long to wait. Those are four different interfaces, and deciding between them is a
 * classification problem that every application solves again from scratch.
 *
 * This module turns the payloads that real APIs actually return into {@link NormalizedFailure}:
 *
 * - RFC 9457 `application/problem+json`
 * - JSON:API `errors[].source.pointer`
 * - the Rails and DRF style `field_errors` map
 * - a flat `[{ path, message }]` list
 * - a bare `{ message }` or `{ error }`
 * - a `fetch` network `TypeError`, and an aborted request
 *
 * Security note: everything produced here is plain text destined for a text node. No field
 * ever contains markup, and no consumer should pass these strings to an HTML sink. Server
 * `detail` text is carried through verbatim for the technical disclosure, which is why it is
 * kept separate from the user-facing `message`.
 */

import { parseRetryAfter } from "./backoff.js";

/**
 * What kind of failure this is, in terms of what the interface should do about it.
 *
 * Ordered roughly from "not really a failure" to "nothing the user can do".
 */
export type FailureKind =
  /** We cancelled it ourselves. Renders nothing: the user did not ask for this to be reported. */
  | "aborted"
  /** No network. Retry is worth offering, but not automatically. */
  | "offline"
  /** 401. The session is gone; the recovery action is to sign in, not to retry. */
  | "auth"
  /** 403. Retrying is pointless; the recovery action is to request access or change account. */
  | "forbidden"
  /** 404 or 410. The thing is not there; the recovery action is navigation. */
  | "missing"
  /** 409 or 412. Someone else changed it; the recovery action is to reload and merge. */
  | "conflict"
  /** 400 or 422 carrying field errors. Belongs on the form, never in a toast. */
  | "validation"
  /** 429. Retry is possible but only after a stated delay. */
  | "rateLimited"
  /** 408, 425, 5xx, or a network error. Safe to offer an immediate retry. */
  | "retryable"
  /** Classified, but nothing in the list above fits. Report and offer support, not retry. */
  | "terminal";

/** One field-scoped message, with a path in dotted form. */
export interface FieldFailure {
  /** Dotted path, for example `email` or `billing.address.postcode`. */
  readonly path: string;
  readonly message: string;
}

export interface NormalizedFailure {
  readonly kind: FailureKind;
  /** Short, user-facing, no internals. Safe to show in a toast or inline. */
  readonly message: string;
  /** Technical text for a collapsed details disclosure. Never shown by default. */
  readonly detail?: string;
  readonly status?: number;
  /** Milliseconds to wait before a retry can succeed. Present for `rateLimited`. */
  readonly retryAfterMs?: number;
  /** Field-scoped messages. Present for `validation`. */
  readonly fields?: readonly FieldFailure[];
  /** Whether offering a retry affordance is honest. False for auth, forbidden and validation. */
  readonly canRetry: boolean;
  /** The original value, for logging. Never rendered. */
  readonly raw: unknown;
}

export interface NormalizeOptions {
  /**
   * Whether the client believes it has a network.
   *
   * Injected rather than read from `navigator` so core stays DOM-free; the React adapter
   * supplies it.
   */
  readonly online?: boolean;
  /** Current time, for resolving a date-form `Retry-After`. */
  readonly nowMs?: number;
  /**
   * Replaces the default status-to-kind mapping.
   *
   * Returning `undefined` falls through to the default, so an override can special-case one
   * status without restating the table.
   */
  readonly classify?: (failure: NormalizedFailure) => FailureKind | undefined;
  /** User-facing copy, so the taxonomy can be localised without re-implementing it. */
  readonly messages?: Partial<Record<FailureKind, string>>;
}

const DEFAULT_MESSAGES: Record<FailureKind, string> = {
  aborted: "Cancelled.",
  offline: "You appear to be offline.",
  auth: "Your session has expired. Sign in to continue.",
  forbidden: "You do not have permission to do that.",
  missing: "That item no longer exists.",
  conflict: "Someone else changed this. Reload to see the latest version.",
  validation: "Some details need fixing.",
  rateLimited: "Too many requests. Try again shortly.",
  retryable: "That did not go through. Try again.",
  terminal: "Something went wrong.",
};

const RETRYABLE_STATUS = new Set([408, 425, 500, 502, 503, 504, 507, 509]);

/** Kinds for which a retry button would be a lie. */
const NO_RETRY: ReadonlySet<FailureKind> = new Set<FailureKind>([
  "aborted",
  "auth",
  "forbidden",
  "missing",
  "validation",
  "terminal",
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function asString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
}

/** Normalises the several path conventions onto a dotted path. */
function normalizePath(raw: unknown): string | undefined {
  if (Array.isArray(raw)) {
    const joined = raw.filter((part) => typeof part === "string" || typeof part === "number").join(".");
    return joined.length > 0 ? joined : undefined;
  }
  const text = asString(raw);
  if (!text) return undefined;
  // JSON:API pointers look like /data/attributes/email, and RFC 6901 escapes ~ and /.
  if (text.startsWith("/")) {
    const parts = text
      .split("/")
      .filter((part) => part.length > 0 && part !== "data" && part !== "attributes")
      .map((part) => part.replace(/~1/g, "/").replace(/~0/g, "~"));
    return parts.length > 0 ? parts.join(".") : undefined;
  }
  return text;
}

/** Pulls field errors out of whichever of the five common shapes is present. */
function extractFields(body: Record<string, unknown>): FieldFailure[] {
  const out: FieldFailure[] = [];

  const push = (path: string | undefined, message: string | undefined): void => {
    if (path && message) out.push({ path, message });
  };

  const fromMap = (map: unknown): void => {
    if (!isRecord(map)) return;
    for (const [key, value] of Object.entries(map)) {
      const path = normalizePath(key);
      if (Array.isArray(value)) {
        for (const message of value) push(path, asString(message));
      } else {
        push(path, asString(value));
      }
    }
  };

  const fromList = (list: unknown): void => {
    if (!Array.isArray(list)) return;
    for (const item of list) {
      if (!isRecord(item)) continue;
      const source = isRecord(item["source"]) ? item["source"] : undefined;
      const path = normalizePath(item["path"] ?? item["field"] ?? item["name"] ?? source?.["pointer"]);
      const message = asString(item["message"] ?? item["detail"] ?? item["title"]);
      push(path, message);
    }
  };

  // RFC 9457 allows `errors` as either a map or a list; both are seen in the wild.
  fromMap(body["field_errors"]);
  fromMap(body["fieldErrors"]);
  if (Array.isArray(body["errors"])) fromList(body["errors"]);
  else fromMap(body["errors"]);
  fromList(body["violations"]);

  return out;
}

/** Finds a response-like body on the several client shapes that wrap one. */
function findBody(raw: unknown): Record<string, unknown> | undefined {
  if (!isRecord(raw)) return undefined;
  // Axios-style: error.response.data. Fetch wrappers commonly use error.body or error.data.
  const response = isRecord(raw["response"]) ? raw["response"] : undefined;
  for (const candidate of [raw["body"], raw["data"], response?.["data"], response?.["body"], raw]) {
    if (isRecord(candidate)) return candidate;
  }
  return undefined;
}

function findStatus(raw: unknown, body: Record<string, unknown> | undefined): number | undefined {
  const candidates: unknown[] = [];
  if (isRecord(raw)) {
    candidates.push(raw["status"], raw["statusCode"]);
    if (isRecord(raw["response"])) candidates.push(raw["response"]["status"], raw["response"]["statusCode"]);
  }
  if (body) candidates.push(body["status"]);
  for (const candidate of candidates) {
    if (typeof candidate === "number" && candidate >= 100 && candidate <= 599) return candidate;
  }
  return undefined;
}

function findRetryAfter(raw: unknown, nowMs: number): number | undefined {
  if (!isRecord(raw)) return undefined;
  const response = isRecord(raw["response"]) ? raw["response"] : undefined;
  const ownHeaders = isRecord(raw["headers"]) ? raw["headers"] : undefined;
  const responseHeaders = response && isRecord(response["headers"]) ? response["headers"] : undefined;
  const headers = ownHeaders ?? responseHeaders;

  if (headers) {
    // A real Headers instance exposes `get`; a plain object does not.
    const getter = headers["get"];
    if (typeof getter === "function") {
      const value: unknown = (getter as (name: string) => unknown).call(headers, "retry-after");
      const parsed = parseRetryAfter(asString(value), nowMs);
      if (parsed !== undefined) return parsed;
    }
    const direct = asString(headers["retry-after"] ?? headers["Retry-After"]);
    const parsed = parseRetryAfter(direct, nowMs);
    if (parsed !== undefined) return parsed;
  }

  const numeric = raw["retryAfterMs"];
  return typeof numeric === "number" ? numeric : undefined;
}

/** True when `raw` is a cancellation rather than a failure. */
export function isAbort(raw: unknown): boolean {
  if (!isRecord(raw)) return false;
  if (raw["name"] === "AbortError") return true;
  // Some clients surface their own cancellation marker instead of a DOMException.
  return raw["code"] === "ERR_CANCELED" || raw["__CANCEL__"] === true;
}

function kindFromStatus(status: number, hasFields: boolean): FailureKind {
  if (status === 401) return "auth";
  if (status === 403) return "forbidden";
  if (status === 404 || status === 410) return "missing";
  if (status === 409 || status === 412) return "conflict";
  if (status === 422) return "validation";
  if (status === 400) return hasFields ? "validation" : "terminal";
  if (status === 429) return "rateLimited";
  if (RETRYABLE_STATUS.has(status)) return "retryable";
  if (status >= 500) return "retryable";
  return "terminal";
}

/**
 * Turns anything a rejected promise can carry into a {@link NormalizedFailure}.
 *
 * Never throws. An input it cannot read at all becomes `terminal`, which is the honest
 * answer rather than a crash inside error handling.
 */
export function normalizeError(raw: unknown, options: NormalizeOptions = {}): NormalizedFailure {
  const nowMs = options.nowMs ?? 0;
  const copy = { ...DEFAULT_MESSAGES, ...options.messages };

  const build = (kind: FailureKind, extra: Partial<NormalizedFailure> = {}): NormalizedFailure => {
    const base: NormalizedFailure = {
      kind,
      message: extra.message ?? copy[kind],
      canRetry: !NO_RETRY.has(kind),
      raw,
      ...(extra.detail === undefined ? {} : { detail: extra.detail }),
      ...(extra.status === undefined ? {} : { status: extra.status }),
      ...(extra.retryAfterMs === undefined ? {} : { retryAfterMs: extra.retryAfterMs }),
      ...(extra.fields === undefined || extra.fields.length === 0 ? {} : { fields: extra.fields }),
    };

    const override = options.classify?.(base);
    if (!override || override === base.kind) return base;
    return {
      ...base,
      kind: override,
      canRetry: !NO_RETRY.has(override),
      // Only replace the message if the caller did not supply one for the original kind.
      message: extra.message ?? copy[override],
    };
  };

  if (isAbort(raw)) return build("aborted");

  if (options.online === false) {
    const offlineDetail = isRecord(raw) ? asString(raw["message"]) : undefined;
    return build("offline", offlineDetail === undefined ? {} : { detail: offlineDetail });
  }

  const body = findBody(raw);
  const status = findStatus(raw, body);
  const fields = body ? extractFields(body) : [];
  const retryAfterMs = findRetryAfter(raw, nowMs);

  // Technical text, kept out of `message`. `detail` and `title` come from RFC 9457.
  const detail = body
    ? (asString(body["detail"]) ??
      asString(body["title"]) ??
      asString(body["message"]) ??
      asString(body["error"]))
    : undefined;

  if (status !== undefined) {
    const kind = kindFromStatus(status, fields.length > 0);
    return build(kind, {
      ...(detail === undefined ? {} : { detail }),
      status,
      ...(retryAfterMs === undefined ? {} : { retryAfterMs }),
      fields,
    });
  }

  if (fields.length > 0) return build("validation", { ...(detail === undefined ? {} : { detail }), fields });

  // A fetch network failure is a TypeError with no status and no body. It is the only
  // common case where "retryable" is the right answer with no server input at all.
  if (raw instanceof TypeError) {
    return build(options.online === undefined ? "retryable" : "offline", { detail: raw.message });
  }

  if (raw instanceof Error) return build("terminal", { detail: raw.message });

  return build("terminal", { ...(detail === undefined ? {} : { detail }) });
}
