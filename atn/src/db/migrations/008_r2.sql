-- ATN schema, migration 008 (R2: P2 identity extensions, P3 vaults, nonces, reservations).

ALTER TABLE principals ADD COLUMN ed25519_public_key TEXT NOT NULL DEFAULT '';
ALTER TABLE agents ADD COLUMN ed25519_public_key TEXT NOT NULL DEFAULT '';

ALTER TABLE delegations ADD COLUMN nonce TEXT NOT NULL DEFAULT '';
ALTER TABLE delegations ADD COLUMN not_before TEXT;
ALTER TABLE delegations ADD COLUMN signature TEXT NOT NULL DEFAULT '';

CREATE UNIQUE INDEX IF NOT EXISTS idx_delegations_nonce ON delegations(nonce);

CREATE TABLE IF NOT EXISTS vaults (
  id               TEXT PRIMARY KEY,
  delegation_id    INTEGER NOT NULL REFERENCES delegations(id),
  funded           INTEGER NOT NULL CHECK (
    funded >= 0 AND funded = CAST(funded AS INTEGER) AND funded <= 9007199254740991
  ),
  reserved         INTEGER NOT NULL DEFAULT 0 CHECK (
    reserved >= 0 AND reserved = CAST(reserved AS INTEGER) AND reserved <= 9007199254740991
  ),
  committed        INTEGER NOT NULL DEFAULT 0 CHECK (
    committed >= 0 AND committed = CAST(committed AS INTEGER) AND committed <= 9007199254740991
  ),
  state            TEXT NOT NULL DEFAULT 'OPEN'
                   CHECK (state IN ('OPEN', 'EXPIRED', 'CLOSED', 'REVOKED')),
  expires_at       TEXT NOT NULL,
  opened_at        TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  funding_ref_hash TEXT NOT NULL,
  CHECK (reserved + committed <= funded)
);

CREATE INDEX IF NOT EXISTS idx_vaults_delegation ON vaults(delegation_id);
CREATE INDEX IF NOT EXISTS idx_vaults_state ON vaults(state);

CREATE TABLE IF NOT EXISTS nonces (
  agent_id  TEXT NOT NULL,
  nonce     TEXT NOT NULL,
  timestamp INTEGER NOT NULL,
  PRIMARY KEY (agent_id, nonce)
);

ALTER TABLE budget_reservations ADD COLUMN reservation_ref TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS idx_budget_reservations_ref ON budget_reservations(reservation_ref);
