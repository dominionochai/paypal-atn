-- ATN schema, migration 001 (initial).
--
-- Migrations in src/db/migrations/ are the single source of truth for the
-- schema. From Milestone 1 onward, every schema change is a NEW numbered
-- migration; never edit an applied migration after it ships. Money is stored
-- as INTEGER micro-dollars (1 USD = 1_000_000 micro-dollars); no
-- floating-point money anywhere, and no amount may exceed
-- Number.MAX_SAFE_INTEGER (9007199254740991).
--
-- This schema is enforcement-layer only. It does NOT include signing,
-- vouchers, escrow, or HTTP concerns - those arrive in later milestones and
-- will add their own migrations.
--
-- The migration runner owns the `_migrations` bookkeeping table, so it is not
-- created here. `PRAGMA foreign_keys` is a connection-level setting owned by
-- src/db/db.ts, so it is not repeated here either.

CREATE TABLE IF NOT EXISTS principals (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  external_id TEXT NOT NULL UNIQUE,
  name        TEXT NOT NULL,
  created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE IF NOT EXISTS agents (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  external_id  TEXT NOT NULL UNIQUE,
  principal_id INTEGER NOT NULL REFERENCES principals(id),
  name         TEXT NOT NULL,
  created_at   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE INDEX IF NOT EXISTS idx_agents_principal ON agents(principal_id);

-- A principal grants an agent a spending ceiling. All funds stay under the
-- principal's authority; the agent can never raise this ceiling.
CREATE TABLE IF NOT EXISTS delegations (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  external_id    TEXT NOT NULL UNIQUE,
  principal_id   INTEGER NOT NULL REFERENCES principals(id),
  agent_id       INTEGER NOT NULL REFERENCES agents(id),
  budget_ceiling INTEGER NOT NULL CHECK (
    budget_ceiling >= 0
    AND budget_ceiling = CAST(budget_ceiling AS INTEGER)
    AND budget_ceiling <= 9007199254740991
  ),
  currency       TEXT NOT NULL DEFAULT 'USD',
  status         TEXT NOT NULL DEFAULT 'ACTIVE'
                 CHECK (status IN ('ACTIVE', 'REVOKED', 'EXPIRED')),
  expires_at     TEXT,
  created_at     TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE INDEX IF NOT EXISTS idx_delegations_principal ON delegations(principal_id);
CREATE INDEX IF NOT EXISTS idx_delegations_agent ON delegations(agent_id);

-- A transaction between a buyer agent and a worker agent. The `version`
-- column is the optimistic-concurrency token: every state-changing write must
-- bump it by exactly 1 (enforced by a trigger below), and callers must
-- compare-and-swap on it. `state` is constrained to the same set as the
-- domain state machine in src/domain/state.ts. `amount` is immutable once the
-- transaction is agreed (also enforced by a trigger below).
CREATE TABLE IF NOT EXISTS transactions (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  external_id      TEXT NOT NULL UNIQUE,
  delegation_id    INTEGER REFERENCES delegations(id),
  buyer_agent_id   INTEGER NOT NULL REFERENCES agents(id),
  worker_agent_id  INTEGER NOT NULL REFERENCES agents(id),
  amount           INTEGER NOT NULL CHECK (
    amount >= 0
    AND amount = CAST(amount AS INTEGER)
    AND amount <= 9007199254740991
  ),
  currency         TEXT NOT NULL DEFAULT 'USD',
  state            TEXT NOT NULL DEFAULT 'CREATED'
                   CHECK (state IN (
                     'CREATED', 'AUTHORIZED', 'ACTIVE', 'COMPLETED',
                     'SETTLEMENT_PENDING', 'SETTLED', 'REJECTED', 'EXPIRED',
                     'CANCELLED', 'DISPUTED', 'VERIFICATION_PENDING',
                     'VERIFICATION_FAILED', 'REFUND_PENDING', 'REFUND_FAILED',
                     'REFUNDED', 'SETTLEMENT_FAILED'
                   )),
  version          INTEGER NOT NULL DEFAULT 1 CHECK (version >= 1),
  created_at       TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at       TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  expires_at       TEXT
);

CREATE INDEX IF NOT EXISTS idx_transactions_buyer ON transactions(buyer_agent_id);
CREATE INDEX IF NOT EXISTS idx_transactions_worker ON transactions(worker_agent_id);
CREATE INDEX IF NOT EXISTS idx_transactions_delegation ON transactions(delegation_id);
CREATE INDEX IF NOT EXISTS idx_transactions_state ON transactions(state);

-- Database-level guards on transactions. These are the last line of defense
-- behind the state machine: no prompt, agent, or buggy caller can circumvent
-- them with a raw UPDATE.

-- Terminal states are absorbing: once SETTLED / REFUNDED / REJECTED /
-- EXPIRED / CANCELLED, the state may never change again.
CREATE TRIGGER IF NOT EXISTS transactions_no_state_change_from_terminal
BEFORE UPDATE ON transactions
FOR EACH ROW
WHEN OLD.state IN ('SETTLED', 'REFUNDED', 'REJECTED', 'EXPIRED', 'CANCELLED')
     AND NEW.state IS NOT OLD.state
BEGIN
  SELECT RAISE(ABORT, 'transactions in a terminal state cannot change state');
END;

-- Optimistic concurrency: every write must bump version by exactly 1, so a
-- stale compare-and-swap can never win.
CREATE TRIGGER IF NOT EXISTS transactions_version_must_increment
BEFORE UPDATE ON transactions
FOR EACH ROW
WHEN NEW.version IS NOT OLD.version + 1
BEGIN
  SELECT RAISE(ABORT, 'transactions.version must increment by exactly 1');
END;

-- The agreed amount is immutable: agents may never silently reprice a job.
CREATE TRIGGER IF NOT EXISTS transactions_amount_immutable
BEFORE UPDATE ON transactions
FOR EACH ROW
WHEN NEW.amount IS NOT OLD.amount
BEGIN
  SELECT RAISE(ABORT, 'transactions.amount is immutable');
END;

-- A reservation of delegation budget against a specific transaction. One
-- reservation per transaction (UNIQUE). Released or settled only by the server.
CREATE TABLE IF NOT EXISTS budget_reservations (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  delegation_id  INTEGER NOT NULL REFERENCES delegations(id),
  transaction_id INTEGER NOT NULL UNIQUE REFERENCES transactions(id),
  amount         INTEGER NOT NULL CHECK (
    amount >= 0
    AND amount = CAST(amount AS INTEGER)
    AND amount <= 9007199254740991
  ),
  status         TEXT NOT NULL DEFAULT 'RESERVED'
                 CHECK (status IN ('RESERVED', 'RELEASED', 'SETTLED')),
  created_at     TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  released_at    TEXT
);

CREATE INDEX IF NOT EXISTS idx_budget_reservations_delegation ON budget_reservations(delegation_id);

-- Append-only audit log. Nothing here may ever be updated or deleted; the
-- triggers enforce that at the database level as well as in the application
-- layer (see src/audit/audit.ts). Payload is a JSON document; the application
-- layer refuses to serialize secret-bearing fields before they reach here.
CREATE TABLE IF NOT EXISTS audit_events (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  entity_type TEXT NOT NULL,
  entity_id   INTEGER,
  event       TEXT NOT NULL,
  payload     TEXT NOT NULL DEFAULT '{}',
  actor       TEXT,
  created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE INDEX IF NOT EXISTS idx_audit_entity ON audit_events(entity_type, entity_id);

CREATE TRIGGER IF NOT EXISTS audit_events_no_update
BEFORE UPDATE ON audit_events
BEGIN
  SELECT RAISE(ABORT, 'audit_events is append-only; UPDATE is forbidden');
END;

CREATE TRIGGER IF NOT EXISTS audit_events_no_delete
BEFORE DELETE ON audit_events
BEGIN
  SELECT RAISE(ABORT, 'audit_events is append-only; DELETE is forbidden');
END;