/**
 * Append-only audit log.
 *
 * `record` inserts a single row and deliberately does NOT open its own
 * transaction: it writes inside whatever transaction the caller has already
 * begun, so an audit event and the business change it describes commit or roll
 * back together. The schema enforces append-only with BEFORE UPDATE/DELETE
 * triggers; this module offers no update or delete path either.
 *
 * Secrets are never logged. `record` recursively rejects payloads whose keys
 * match a banned fragment, whose values look like bearer tokens / JWTs /
 * private PEM keys, or that exceed the nesting/size safety limits. This is a
 * key/value heuristic, not a cryptographic guarantee (see README).
 */
import type { Database } from "better-sqlite3";

/**
 * Banned key fragments. A normalized key is rejected when any of these appears
 * as a substring, so names like `delegationToken`, `stripeApiKey` and
 * `x-api-key` are caught.
 */
const SUBSTRING_FRAGMENTS = [
  "secret",
  "token",
  "password",
  "passwd",
  "passphrase",
  "apikey",
  "privatekey",
  "signingkey",
  "credential",
  "authorization",
  "bearer",
  "cookie",
  "sessionid",
  "cardnumber",
  "bankaccount",
  "mnemonic",
  "seed",
] as const;

/**
 * Short sensitive keys that must match EXACTLY (not as a substring):
 * "shipping" contains "pin"-like sequences and "company" contains "pan", so a
 * substring rule would produce false positives.
 */
const EXACT_ONLY_KEYS = new Set(["pin", "pan", "otp", "cvv", "cvc", "ssn"]);

/**
 * Keys that are safe despite otherwise matching a fragment or a token-shaped
 * value. A `signature` is public and verifiable, so it is never redacted.
 */
const ALLOWLIST_KEYS = new Set(["signature"]);

const BEARER_PATTERN = /^Bearer\s+\S+/i;
const JWT_PATTERN = /^eyJ[A-Za-z0-9_-]*\.[A-Za-z0-9_-]*\.[A-Za-z0-9_-]*$/;
const PEM_PRIVATE_PATTERN = /-----BEGIN[^-]*PRIVATE KEY-----/;

const MAX_NESTING_DEPTH = 8;
const MAX_PAYLOAD_BYTES = 16 * 1024;

function normalizeKey(key: string): string {
  return key.replace(/[^a-z0-9]/gi, "").toLowerCase();
}

function assertSafeValue(value: string, path: string): void {
  if (BEARER_PATTERN.test(value)) {
    throw new Error(`refusing to log potential bearer token at ${path}`);
  }
  if (JWT_PATTERN.test(value)) {
    throw new Error(`refusing to log potential JWT at ${path}`);
  }
  if (PEM_PRIVATE_PATTERN.test(value)) {
    throw new Error(`refusing to log potential private key at ${path}`);
  }
}

/**
 * Recursively validate a payload. Tracks the current object path to detect
 * cycles (thrown as TypeError, never a stack overflow) and bounds nesting
 * depth so pathological payloads cannot exhaust memory.
 */
function walk(value: unknown, path: string, depth: number, visiting: Set<object>): void {
  if (value === null || typeof value !== "object") {
    if (typeof value === "string") {
      assertSafeValue(value, path);
    }
    return;
  }
  if (depth > MAX_NESTING_DEPTH) {
    throw new RangeError(
      `audit payload nesting exceeds the maximum depth of ${MAX_NESTING_DEPTH}`,
    );
  }
  if (visiting.has(value)) {
    throw new TypeError(`audit payload contains a circular reference at ${path}`);
  }
  visiting.add(value);
  for (const [key, child] of Object.entries(value)) {
    const normalized = normalizeKey(key);
    if (ALLOWLIST_KEYS.has(normalized)) {
      continue;
    }
    const banned =
      EXACT_ONLY_KEYS.has(normalized) ||
      SUBSTRING_FRAGMENTS.some((fragment) => normalized.includes(fragment));
    if (banned) {
      throw new Error(
        `refusing to log potential secret in payload at ${path === "" ? key : `${path}.${key}`}`,
      );
    }
    walk(child, path === "" ? key : `${path}.${key}`, depth + 1, visiting);
  }
  visiting.delete(value);
}

function assertSafePayload(payload: Readonly<Record<string, unknown>>): void {
  walk(payload, "", 0, new Set<object>());
}

export interface AuditEvent {
  readonly entityType: string;
  readonly entityId?: number | null;
  readonly event: string;
  readonly payload?: Readonly<Record<string, unknown>>;
  readonly actor?: string | null;
}

/**
 * Insert an audit event. Runs within the caller's DB transaction (it does not
 * begin one). Throws if the payload carries a secret-bearing key or value, or
 * exceeds the nesting/size limits. Returns the new row id.
 */
export function record(db: Database, event: AuditEvent): number {
  if (typeof event.entityType !== "string" || event.entityType.length === 0) {
    throw new TypeError("audit event requires a non-empty entityType");
  }
  if (typeof event.event !== "string" || event.event.length === 0) {
    throw new TypeError("audit event requires a non-empty event name");
  }

  let payloadJson = "{}";
  if (event.payload !== undefined) {
    assertSafePayload(event.payload);
    payloadJson = JSON.stringify(event.payload);
    if (Buffer.byteLength(payloadJson, "utf8") > MAX_PAYLOAD_BYTES) {
      throw new RangeError(
        `audit payload serializes to more than ${MAX_PAYLOAD_BYTES} bytes (16 KiB)`,
      );
    }
  }

  const result = db
    .prepare(
      "INSERT INTO audit_events (entity_type, entity_id, event, payload, actor) VALUES (?, ?, ?, ?, ?)",
    )
    .run(
      event.entityType,
      event.entityId === undefined ? null : event.entityId,
      event.event,
      payloadJson,
      event.actor === undefined ? null : event.actor,
    );

  return Number(result.lastInsertRowid);
}