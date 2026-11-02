-- ATN schema, migration 007 (trust authority).
-- The migration runner records each numbered filename in _migrations and applies
-- each file once, inside its own transaction.

ALTER TABLE agents ADD COLUMN revoked_at INTEGER;
ALTER TABLE agents ADD COLUMN budget_micro INTEGER;

ALTER TABLE delegations ADD COLUMN scope_json TEXT;
ALTER TABLE delegations ADD COLUMN counterparty_allowlist_json TEXT;
ALTER TABLE delegations ADD COLUMN revoked_at INTEGER;

-- Rebuild budget_reservations using SQLite's create/copy/drop/rename pattern.
-- Existing reservations expire at migration time because the old schema did not
-- record a TTL. EXPIRED is added to the existing status constraint for the sweep.
PRAGMA defer_foreign_keys = ON;

DROP TABLE IF EXISTS budget_reservations_new;
CREATE TABLE budget_reservations_new (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  delegation_id   INTEGER NOT NULL REFERENCES delegations(id),
  transaction_id  INTEGER UNIQUE REFERENCES transactions(id),
  amount          INTEGER NOT NULL CHECK (
    amount >= 0
    AND amount = CAST(amount AS INTEGER)
    AND amount <= 9007199254740991
  ),
  status          TEXT NOT NULL DEFAULT 'RESERVED'
                  CHECK (status IN ('RESERVED', 'RELEASED', 'SETTLED', 'EXPIRED')),
  created_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  released_at     TEXT,
  expires_at      INTEGER NOT NULL
);

INSERT INTO budget_reservations_new (
  id, delegation_id, transaction_id, amount, status, created_at, released_at, expires_at
)
SELECT
  id,
  delegation_id,
  transaction_id,
  amount,
  status,
  created_at,
  released_at,
  CAST(strftime('%s', 'now') AS INTEGER) * 1000
FROM budget_reservations;

DROP TABLE budget_reservations;
ALTER TABLE budget_reservations_new RENAME TO budget_reservations;

CREATE INDEX IF NOT EXISTS idx_budget_reservations_delegation
  ON budget_reservations(delegation_id);
CREATE INDEX IF NOT EXISTS idx_budget_reservations_delegation_status
  ON budget_reservations(delegation_id, status);
CREATE INDEX IF NOT EXISTS idx_budget_reservations_expires_at
  ON budget_reservations(expires_at);
CREATE INDEX IF NOT EXISTS idx_delegations_agent_status
  ON delegations(agent_id, status);
CREATE INDEX IF NOT EXISTS idx_agents_revoked_at
  ON agents(revoked_at);
