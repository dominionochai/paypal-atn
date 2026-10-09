/**
 * Append-only audit log.
 *
 * `record` inserts a single row and deliberately does NOT open its own
 * transaction: it writes inside whatever transaction the caller has already
 * begun, so an audit event and the business change it describes commit or roll
 * back together. The schema enforces append-only with BEFORE UPDATE/DELETE
 * triggers; this module offers no update or delete path either.
 *
 * Secrets are never logged: `record` recursively rejects payloads that
 * contain secret-bearing keys before they can be serialized.
 */
import type { Database } from "better-sqlite3";

const BANNED_PAYLOAD_KEYS = new Set([
  "secret",
  "secrets",
  "password",
  "passwd",
  "apikey",
  "api_key",
  "clientsecret",
  "client_secret",
  "privatekey",
  "private_key",
  "accesstoken",
  "access_token",
  "refreshtoken",
  "refresh_token",
  "authorization",
  "bearer",
  "credential",
  "credentials",
  "sessionid",
  "session_id",
  "cookie",
  "cookies",
  "cvv",
  "cvc",
  "pin",
  "otp",
  "pan",
  "cardnumber",
  "card_number",
  "ssn",
  "bankaccount",
  "bank_account",
]);

function normalizeKey(key: string): string {
  return key.replace(/[^a-z0-9]/gi, "").toLowerCase();
}

function assertNoSecrets(value: unknown, path: string): void {
  if (value === null || typeof value !== "object") {
    return;
  }
  for (const [key, child] of Object.entries(value)) {
    if (BANNED_PAYLOAD_KEYS.has(normalizeKey(key))) {
      throw new Error(
        `refusing to log potential secret in payload at ${path === "" ? key : `${path}.${key}`}`,
      );
    }
    assertNoSecrets(child, path === "" ? key : `${path}.${key}`);
  }
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
 * begin one). Throws if the event references a secret-bearing payload key.
 * Returns the new row id.
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
    assertNoSecrets(event.payload, "");
    payloadJson = JSON.stringify(event.payload);
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