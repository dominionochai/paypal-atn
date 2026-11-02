import { createHash } from "node:crypto";
import type { Database } from "../db/db.js";

export type IdempotencyStatus = "IN_FLIGHT" | "SUCCEEDED" | "FAILED" | "UNKNOWN";

export interface IdempotencyRecord {
  readonly idempotencyKey: string;
  readonly requestHash: string;
  readonly status: IdempotencyStatus;
  readonly resultJson: string | null;
  readonly errorMessage: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export type IdempotencyClaim<T> =
  | { readonly kind: "acquired" }
  | { readonly kind: "replay"; readonly value: T };

export class IdempotencyConflictError extends Error {
  readonly code = "IDEMPOTENCY_CONFLICT";
  constructor(readonly idempotencyKey: string) {
    super(`Idempotency key ${JSON.stringify(idempotencyKey)} was already used for a different request`);
    this.name = "IdempotencyConflictError";
  }
}

export class IdempotencyInFlightError extends Error {
  readonly code = "IDEMPOTENCY_IN_FLIGHT";
  constructor(readonly idempotencyKey: string) {
    super(`Request ${JSON.stringify(idempotencyKey)} is already in flight; do not submit it again`);
    this.name = "IdempotencyInFlightError";
  }
}

export class PaymentOutcomeUnknownError extends Error {
  readonly code = "PAYMENT_OUTCOME_UNKNOWN";
  constructor(
    readonly idempotencyKey: string,
    message = `Payment outcome for ${JSON.stringify(idempotencyKey)} is unknown; reconcile before retrying`,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "PaymentOutcomeUnknownError";
  }
}

function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") {
    if (typeof value === "number" && !Number.isFinite(value)) throw new TypeError("Cannot hash a non-finite number");
    const encoded = JSON.stringify(value);
    if (encoded === undefined) throw new TypeError("Request must be JSON serializable");
    return encoded;
  }
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  const entries = Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b));
  return `{${entries.map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`).join(",")}}`;
}

/** Stable SHA-256 fingerprint for normalized request data (not a secret). */
export function createRequestHash(value: unknown): string {
  return createHash("sha256").update(canonicalJson(value)).digest("hex");
}

interface DbRow {
  idempotency_key: string;
  request_hash: string;
  status: string;
  result_json: string | null;
  error_message: string | null;
  created_at: string;
  updated_at: string;
}

function fromRow(row: DbRow): IdempotencyRecord {
  return {
    idempotencyKey: row.idempotency_key,
    requestHash: row.request_hash,
    status: row.status as IdempotencyStatus,
    resultJson: row.result_json,
    errorMessage: row.error_message,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** SQLite-backed reservation and result ledger. Network I/O stays outside transactions. */
export class SqliteIdempotencyStore {
  constructor(private readonly db: Database) {}

  claim<T>(idempotencyKey: string, requestHash: string): IdempotencyClaim<T> {
    this.validateKeyAndHash(idempotencyKey, requestHash);
    return this.db.transaction((): IdempotencyClaim<T> => {
      const row = this.db.prepare("SELECT * FROM payment_idempotency WHERE idempotency_key = ?")
        .get(idempotencyKey) as DbRow | undefined;
      if (!row) {
        this.db.prepare("INSERT INTO payment_idempotency (idempotency_key, request_hash, status) VALUES (?, ?, 'IN_FLIGHT')")
          .run(idempotencyKey, requestHash);
        return { kind: "acquired" };
      }
      if (row.request_hash !== requestHash) throw new IdempotencyConflictError(idempotencyKey);
      if (row.status === "SUCCEEDED") {
        if (row.result_json === null) throw new Error(`Corrupt successful idempotency record ${idempotencyKey}`);
        return { kind: "replay", value: JSON.parse(row.result_json) as T };
      }
      if (row.status === "IN_FLIGHT") throw new IdempotencyInFlightError(idempotencyKey);
      if (row.status === "UNKNOWN") {
        throw new PaymentOutcomeUnknownError(idempotencyKey, row.error_message ?? undefined);
      }
      if (row.status !== "FAILED") throw new Error(`Unsupported idempotency status ${row.status}`);
      this.db.prepare(
        "UPDATE payment_idempotency SET status = 'IN_FLIGHT', error_message = NULL, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE idempotency_key = ? AND request_hash = ? AND status = 'FAILED'",
      ).run(idempotencyKey, requestHash);
      return { kind: "acquired" };
    })();
  }

  markSucceeded(idempotencyKey: string, requestHash: string, result: unknown): void {
    const json = JSON.stringify(result);
    if (json === undefined) throw new TypeError("Idempotency result must be JSON serializable");
    const update = this.db.prepare(
      "UPDATE payment_idempotency SET status = 'SUCCEEDED', result_json = ?, error_message = NULL, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE idempotency_key = ? AND request_hash = ? AND status = 'IN_FLIGHT'",
    ).run(json, idempotencyKey, requestHash);
    if (update.changes !== 1) throw new Error(`Cannot complete idempotency reservation ${idempotencyKey}`);
  }

  markFailed(idempotencyKey: string, requestHash: string, error: unknown): void {
    const update = this.db.prepare(
      "UPDATE payment_idempotency SET status = 'FAILED', result_json = NULL, error_message = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE idempotency_key = ? AND request_hash = ? AND status = 'IN_FLIGHT'",
    ).run(messageOf(error), idempotencyKey, requestHash);
    if (update.changes !== 1) throw new Error(`Cannot fail idempotency reservation ${idempotencyKey}`);
  }

  markUnknown(idempotencyKey: string, requestHash: string, error: unknown): void {
    const update = this.db.prepare(
      "UPDATE payment_idempotency SET status = 'UNKNOWN', result_json = NULL, error_message = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE idempotency_key = ? AND request_hash = ? AND status = 'IN_FLIGHT'",
    ).run(messageOf(error), idempotencyKey, requestHash);
    if (update.changes !== 1) throw new Error(`Cannot mark idempotency reservation ${idempotencyKey} unknown`);
  }

  get(idempotencyKey: string): IdempotencyRecord | undefined {
    const row = this.db.prepare("SELECT * FROM payment_idempotency WHERE idempotency_key = ?")
      .get(idempotencyKey) as DbRow | undefined;
    return row ? fromRow(row) : undefined;
  }

  /** Definitive errors are retryable after FAILED; unknown errors are locked for reconciliation. */
  async execute<T>(idempotencyKey: string, requestHash: string, operation: () => Promise<T>): Promise<T> {
    const claim = this.claim<T>(idempotencyKey, requestHash);
    if (claim.kind === "replay") return claim.value;
    try {
      const result = await operation();
      this.markSucceeded(idempotencyKey, requestHash, result);
      return result;
    } catch (error) {
      const definitive = typeof error === "object" && error !== null &&
        "definitive" in error && (error as { definitive?: unknown }).definitive === true;
      if (definitive) {
        this.markFailed(idempotencyKey, requestHash, error);
        throw error;
      }
      this.markUnknown(idempotencyKey, requestHash, error);
      if (error instanceof PaymentOutcomeUnknownError) throw error;
      throw new PaymentOutcomeUnknownError(idempotencyKey, undefined, { cause: error });
    }
  }

  private validateKeyAndHash(idempotencyKey: string, requestHash: string): void {
    if (!idempotencyKey.trim()) throw new TypeError("Idempotency key must not be empty");
    if (!requestHash.trim()) throw new TypeError("Request hash must not be empty");
  }
}
