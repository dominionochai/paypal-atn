-- M4 payment idempotency ledger. Provider calls are never made inside a SQLite
-- transaction; IN_FLIGHT and UNKNOWN rows prevent unsafe duplicate attempts.
CREATE TABLE IF NOT EXISTS payment_idempotency (
  idempotency_key TEXT PRIMARY KEY NOT NULL,
  request_hash TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('IN_FLIGHT', 'SUCCEEDED', 'FAILED', 'UNKNOWN')),
  result_json TEXT,
  error_message TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  CHECK ((status = 'SUCCEEDED' AND result_json IS NOT NULL) OR
         (status <> 'SUCCEEDED' AND result_json IS NULL))
);

CREATE INDEX IF NOT EXISTS idx_payment_idempotency_status
  ON payment_idempotency(status, updated_at);
