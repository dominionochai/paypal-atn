import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { hardenDatabase } from '../src/db/hardening.js';
import { authorize, reserve, commit, release, reserveAndCommit } from '../src/trust/authority.js';

type SqlValue = string | number | bigint | Buffer | null;
type AgentSeed = { id?: string; revokedAt?: string | null; budgetMicro?: number };
type DelegationSeed = {
  id?: string;
  agentId?: string;
  counterparty?: string;
  budgetCeiling?: number;
  status?: string;
  expiresAt?: number | string;
  scope?: string[];
  counterpartyAllowlist?: string[];
  revokedAt?: string | null;
};
type TrustRequest = {
  agentId: string;
  delegationId: string;
  action: string;
  counterparty: string;
  amountMicro: number;
  now: number;
};
type TableColumn = { name: string };
type ReservationRow = Record<string, unknown>;

const migrationsDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../src/db/migrations');
const defaultNow = 1_800_000_000_000;
const defaultAction = 'invoice.pay';
const defaultCounterparty = 'merchant-1';
const defaultAgentId = 'agent-1';
const defaultDelegationId = 'delegation-1';
const defaultCeiling = 5_000_000;

let db: Database.Database;
let tempDir: string;

function insertOrExplain(sql: string, columns: readonly string[], values: readonly SqlValue[]): void {
  try {
    db.prepare(sql).run(...values);
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error(`SQL failed: ${sql}; columns: ${columns.join(', ')}; cause: ${detail}`, { cause: error });
  }
}

function tableColumns(table: string): string[] {
  const rows = db.prepare(`PRAGMA table_info('${table}')`).all() as TableColumn[];
  return rows.map((row) => row.name);
}

function seedAgent(seed: AgentSeed = {}): string {
  const id = seed.id ?? defaultAgentId;
  const columns = ['id', 'revoked_at', 'budget_micro'];
  const sql = `INSERT INTO agents (${columns.join(', ')}) VALUES (?, ?, ?)`;
  insertOrExplain(sql, columns, [id, seed.revokedAt ?? null, seed.budgetMicro ?? 10_000_000]);
  return id;
}

function seedDelegation(seed: DelegationSeed = {}): string {
  const id = seed.id ?? defaultDelegationId;
  const agentId = seed.agentId ?? defaultAgentId;
  const available = tableColumns('delegations');
  const partyColumn = available.includes('payee') ? 'payee' : 'counterparty';
  if (!available.includes(partyColumn)) {
    throw new Error(`SQL not executed: delegations lacks payee/counterparty; columns: ${available.join(', ')}`);
  }
  const columns = [
    'id', 'agent_id', partyColumn, 'budget_ceiling', 'status', 'expires_at',
    'scope_json', 'counterparty_allowlist_json', 'revoked_at',
  ];
  const values: SqlValue[] = [
    id,
    agentId,
    seed.counterparty ?? defaultCounterparty,
    seed.budgetCeiling ?? defaultCeiling,
    seed.status ?? 'active',
    seed.expiresAt ?? 2_000_000_000_000,
    JSON.stringify({ actions: seed.scope ?? [defaultAction] }),
    JSON.stringify(seed.counterpartyAllowlist ?? [defaultCounterparty]),
    seed.revokedAt ?? null,
  ];
  const sql = `INSERT INTO delegations (${columns.join(', ')}) VALUES (${columns.map(() => '?').join(', ')})`;
  insertOrExplain(sql, columns, values);
  return id;
}

function seedReservation(id: string, agentId: string, delegationId: string, amountMicro: number, status: string): void {
  const available = tableColumns('budget_reservations');
  const valueByColumn = new Map<string, SqlValue>([
    ['id', id], ['reservation_id', id], ['agent_id', agentId], ['delegation_id', delegationId],
    ['amount_micro', amountMicro], ['amount', amountMicro], ['status', status],
    ['created_at', new Date(defaultNow).toISOString()],
    ['updated_at', new Date(defaultNow).toISOString()],
    ['expires_at', new Date(defaultNow + 60_000).toISOString()],
  ]);
  const columns = available.filter((column) => valueByColumn.has(column));
  const values = columns.map((column) => valueByColumn.get(column) ?? null);
  const sql = `INSERT INTO budget_reservations (${columns.join(', ')}) VALUES (${columns.map(() => '?').join(', ')})`;
  insertOrExplain(sql, columns, values);
}

function request(overrides: Partial<TrustRequest> = {}): TrustRequest {
  return {
    agentId: defaultAgentId,
    delegationId: defaultDelegationId,
    action: defaultAction,
    counterparty: defaultCounterparty,
    amountMicro: 1_000_000,
    now: defaultNow,
    ...overrides,
  };
}

function latestReservation(): ReservationRow {
  const row = db.prepare('SELECT * FROM budget_reservations ORDER BY rowid DESC LIMIT 1').get() as ReservationRow | undefined;
  if (row === undefined) throw new Error('Expected a budget_reservations row, but none was written');
  return row;
}

function reservationId(row: ReservationRow): string {
  const value = row.id ?? row.reservation_id;
  if (typeof value !== 'string') throw new Error('Reservation row has no string id/reservation_id');
  return value;
}

function auditEventCount(): number {
  const row = db.prepare('SELECT COUNT(*) AS count FROM audit_events').get() as { count: number };
  return row.count;
}

function remainingBudget(input: TrustRequest): number {
  const result = authorize(db, input);
  if (typeof result.remainingBudget !== 'number') throw new Error('authorize did not return numeric remainingBudget');
  return result.remainingBudget;
}

describe('trust authority', () => {
  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'atn-trust-'));
    const dbPath = path.join(tempDir, 'trust.sqlite');
    db = new Database(dbPath);
    const migrations = fs.readdirSync(migrationsDir).filter((name) => name.endsWith('.sql')).sort();
    for (const migration of migrations) db.exec(fs.readFileSync(path.join(migrationsDir, migration), 'utf8'));
  });

  afterEach(() => {
    db.close();
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it('allows a valid in-scope delegation and returns the remaining budget', () => {
    seedAgent();
    seedDelegation();
    seedReservation('released-history', defaultAgentId, defaultDelegationId, 1, 'released');
    const result = authorize(db, request());
    expect(result.allowed).toBe(true);
    expect(result.remainingBudget).toBe(4_000_000);
  });

  it('denies an unknown agent with UNKNOWN_AGENT', () => {
    seedDelegation({ agentId: 'missing-agent' });
    const result = authorize(db, request({ agentId: 'missing-agent' }));
    expect(result.allowed).toBe(false);
    expect(result.reason).toBe('UNKNOWN_AGENT');
  });

  it('denies a revoked agent with AGENT_REVOKED', () => {
    seedAgent({ revokedAt: '2026-01-01T00:00:00.000Z' });
    seedDelegation();
    const result = authorize(db, request());
    expect(result.allowed).toBe(false);
    expect(result.reason).toBe('AGENT_REVOKED');
  });

  it('denies a missing delegation with DELEGATION_MISSING', () => {
    seedAgent();
    const result = authorize(db, request());
    expect(result.allowed).toBe(false);
    expect(result.reason).toBe('DELEGATION_MISSING');
  });

  it('denies an expired delegation using the supplied now with DELEGATION_EXPIRED', () => {
    seedAgent();
    seedDelegation({ expiresAt: defaultNow - 1 });
    const result = authorize(db, request({ now: defaultNow }));
    expect(result.allowed).toBe(false);
    expect(result.reason).toBe('DELEGATION_EXPIRED');
  });

  it('denies a revoked delegation with DELEGATION_REVOKED', () => {
    seedAgent();
    seedDelegation({ revokedAt: '2026-01-01T00:00:00.000Z' });
    const result = authorize(db, request());
    expect(result.allowed).toBe(false);
    expect(result.reason).toBe('DELEGATION_REVOKED');
  });

  it('denies a counterparty missing from the allowlist with COUNTERPARTY_DENIED', () => {
    seedAgent();
    seedDelegation({ counterpartyAllowlist: ['other-merchant'] });
    const result = authorize(db, request());
    expect(result.allowed).toBe(false);
    expect(result.reason).toBe('COUNTERPARTY_DENIED');
  });

  it('denies an action missing from scope with SCOPE_DENIED', () => {
    seedAgent();
    seedDelegation({ scope: ['invoice.read'] });
    const result = authorize(db, request());
    expect(result.allowed).toBe(false);
    expect(result.reason).toBe('SCOPE_DENIED');
  });

  it('denies an amount above the delegation ceiling with CEILING_EXCEEDED', () => {
    seedAgent();
    seedDelegation({ budgetCeiling: 500_000 });
    const result = authorize(db, request());
    expect(result.allowed).toBe(false);
    expect(result.reason).toBe('CEILING_EXCEEDED');
  });

  it('denies an amount above agent budget with BUDGET_EXHAUSTED', () => {
    seedAgent({ budgetMicro: 500_000 });
    seedDelegation({ budgetCeiling: 5_000_000 });
    const result = authorize(db, request());
    expect(result.allowed).toBe(false);
    expect(result.reason).toBe('BUDGET_EXHAUSTED');
  });

  it('commits a reservation, writes an audit event, and reduces remaining budget', () => {
    seedAgent();
    seedDelegation({ budgetCeiling: 10_000_000 });
    const eventsBefore = auditEventCount();
    reserve(db, request());
    const row = latestReservation();
    commit(db, reservationId(row));
    const committed = latestReservation();
    expect(committed.status).toBe('committed');
    expect(auditEventCount()).toBeGreaterThan(eventsBefore);
    expect(remainingBudget(request())).toBe(9_000_000);
  });

  it('releases a reservation, restores budget, and writes an audit event', () => {
    seedAgent();
    seedDelegation({ budgetCeiling: 10_000_000 });
    const eventsBefore = auditEventCount();
    reserve(db, request());
    release(db, reservationId(latestReservation()));
    expect(remainingBudget(request())).toBe(10_000_000);
    expect(auditEventCount()).toBeGreaterThan(eventsBefore);
  });

  it('reserve then release restores the budget', () => {
    seedAgent();
    seedDelegation({ budgetCeiling: 10_000_000 });
    reserve(db, request());
    const beforeRelease = remainingBudget(request());
    release(db, reservationId(latestReservation()));
    expect(beforeRelease).toBe(9_000_000);
    expect(remainingBudget(request())).toBe(10_000_000);
  });

  it('reserveAndCommit succeeds on the happy path', () => {
    seedAgent();
    seedDelegation({ budgetCeiling: 10_000_000 });
    const eventsBefore = auditEventCount();
    reserveAndCommit(db, request());
    expect(latestReservation().status).toBe('committed');
    expect(auditEventCount()).toBeGreaterThan(eventsBefore);
    expect(remainingBudget(request())).toBe(9_000_000);
  });

  it('never reserves more than the ceiling across 50 sequential authorizations', () => {
    seedAgent();
    seedDelegation({ budgetCeiling: 10_000_000 });
    let successes = 0;
    for (let index = 0; index < 50; index += 1) {
      const input = request();
      const result = authorize(db, input);
      if (result.allowed) {
        reserve(db, input);
        successes += 1;
      }
    }
    const sum = db.prepare("SELECT COALESCE(SUM(amount_micro), 0) AS total FROM budget_reservations WHERE status = 'reserved'")
      .get() as { total: number };
    expect(successes).toBe(10);
    expect(sum.total).toBeLessThanOrEqual(10_000_000);
  });

  it('hardens SQLite with WAL, foreign keys, trusted schema disabled, and enforced foreign keys', () => {
    hardenDatabase(db);
    const journal = db.prepare('PRAGMA journal_mode').get() as { journal_mode: string };
    const foreignKeys = db.prepare('PRAGMA foreign_keys').get() as { foreign_keys: number };
    const trustedSchema = db.prepare('PRAGMA trusted_schema').get() as { trusted_schema: number };
    expect(journal.journal_mode.toLowerCase()).toBe('wal');
    expect(foreignKeys.foreign_keys).toBe(1);
    expect(trustedSchema.trusted_schema).toBe(0);

    const error = (() => {
      try {
        seedDelegation({ id: 'orphan-delegation', agentId: 'agent-does-not-exist' });
      } catch (caught) {
        return caught;
      }
      return undefined;
    })();
    expect(error).toBeInstanceOf(Error);
    expect(error instanceof Error ? error.message : '').toMatch(/FOREIGN KEY constraint failed/i);
  });
});
