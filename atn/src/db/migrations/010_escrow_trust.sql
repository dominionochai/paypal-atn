-- ATN schema, migration 010 (Escrow trust, vault integration, and merchant trust).
ALTER TABLE delegations ADD COLUMN min_counterparty_trust INTEGER CHECK (min_counterparty_trust IS NULL OR (min_counterparty_trust >= 0 AND min_counterparty_trust <= 1000));

ALTER TABLE escrows ADD COLUMN vault_id TEXT REFERENCES vaults(id);
ALTER TABLE escrows ADD COLUMN reservation_ref TEXT;
ALTER TABLE escrows ADD COLUMN deadline_at INTEGER;
ALTER TABLE escrows ADD COLUMN attempts INTEGER NOT NULL DEFAULT 0;
ALTER TABLE escrows ADD COLUMN spec TEXT;
ALTER TABLE escrows ADD COLUMN auth_ref TEXT;
ALTER TABLE escrows ADD COLUMN capture_ref TEXT;
ALTER TABLE escrows ADD COLUMN payout_ref TEXT;

CREATE TABLE IF NOT EXISTS merchant_trust (
  agent_id TEXT PRIMARY KEY,
  score INTEGER NOT NULL CHECK (score >= 0 AND score <= 1000) DEFAULT 500,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS trust_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  agent_id TEXT NOT NULL,
  delta INTEGER NOT NULL,
  reason TEXT NOT NULL,
  escrow_id TEXT,
  created_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_trust_events_agent ON trust_events(agent_id);