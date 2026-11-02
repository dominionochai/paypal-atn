CREATE TABLE escrows (
  id TEXT PRIMARY KEY,
  payer_agent_id TEXT NOT NULL,
  payee_agent_id TEXT NOT NULL,
  amount INTEGER NOT NULL CHECK (amount > 0),
  currency TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('CREATED', 'FUNDED', 'INSPECTING', 'RELEASED', 'REFUNDED', 'FAILED')),
  artifact_ref TEXT,
  idempotency_key TEXT NOT NULL UNIQUE,
  created_at INTEGER NOT NULL,
  funded_at INTEGER,
  released_at INTEGER,
  refunded_at INTEGER
);

CREATE TABLE escrow_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  escrow_id TEXT NOT NULL,
  event TEXT NOT NULL,
  detail TEXT,
  created_at INTEGER NOT NULL
);

CREATE TABLE artifact_inspections (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  escrow_id TEXT NOT NULL,
  outcome TEXT NOT NULL CHECK (outcome IN ('PASS', 'FAIL', 'INCONCLUSIVE')),
  reasons TEXT NOT NULL,
  artifact_sha256 TEXT NOT NULL,
  artifact_bytes INTEGER NOT NULL,
  inspected_at INTEGER NOT NULL
);

CREATE INDEX idx_escrows_status ON escrows(status);
CREATE INDEX idx_escrow_events_escrow_id ON escrow_events(escrow_id);
CREATE INDEX idx_artifact_inspections_escrow_id ON artifact_inspections(escrow_id);
