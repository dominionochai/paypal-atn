import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { hardenDatabase } from '../src/db/hardening.js';
import { authorize, commit, release, reserve, reserveAndCommit } from '../src/trust/authority.js';

type AgentSeed = {
  externalId?: string;
  principalExternalId?: string;
  revokedAt?: number | null;
  budgetMicro?: number | null;
};
type DelegationSeed = {
  externalId?: string;
  agentExternalId?: string;
  counterparty?: string;
  budgetCeiling?: number;
  status?: 'ACTIVE' | 'REVOKED' | 'EXPIRED';
  expiresAt?: string | null;
  scope?: string[];
  counterpartyAllowlist?: string[];
  revokedAt?: number | null;
};
type TrustRequest = {
  agentId: string;
  action: string;
  counterpartyId: string;
  amount: number;
  now?: number;
};
type ReservationRow = { id: number; status: string; amount: number; expires_at: number };

const migrationsDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../src/db/migrations');
const defaultAction = 'invoice.pay';
const defaultCounterparty = 'merchant-1';
const defaultAgentId = 'agent-1';
const defaultBudgetCeiling = 5_000_000;
const nowSeconds = (): number => Math.floor(Date.now() / 1000);

let db: Database.Database;
let tempDir: string;

function principalId(externalId: string): number {
  const existing = db.prepare('SELECT id FROM principals WHERE external_id = ?').get(externalId) as { id: number } | undefined;
  if (existing) return existing.id;
  const inserted = db.prepare('INSERT INTO principals (external_id, name) VALUES (?, ?)').run(externalId, externalId);
  return Number(inserted.lastInsertRowid);
}

function seedAgent(seed: AgentSeed = {}): { id: number; externalId: string } {
  const externalId = seed.externalId ?? defaultAgentId;
  const ownerId = principalId(seed.principalExternalId ?? 'principal-1');
  const inserted = db.prepare(`
    INSERT INTO agents (external_id, principal_id, name, revoked_at, budget_micro)
    VALUES (?, ?, ?, ?, ?)
  `).run(externalId, ownerId, externalId, seed.revokedAt ?? null, seed.budgetMicro ?? 10_000_000);
  return { id: Number(inserted.lastInsertRowid), externalId };
}

function seedDelegation(seed: DelegationSeed = {}): number {
  const agentExternalId = seed.agentExternalId ?? defaultAgentId;
  const agent = db.prepare('SELECT id FROM agents WHERE external_id = ?').get(agentExternalId) as { id: number } | undefined;
  if (!agent) throw new Error(`Cannot seed delegation: agent ${agentExternalId} does not exist`);
  const counterparty = seed.counterparty ?? defaultCounterparty;
  const principal = principalId(counterparty);
  const inserted = db.prepare(`
    INSERT INTO delegations (
      external_id, principal_id, agent_id, budget_ceiling, currency, status,
      expires_at, scope_json, counterparty_allowlist_json, revoked_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    seed.externalId ?? 'delegation-1',
    principal,
    agent.id,
    seed.budgetCeiling ?? defaultBudgetCeiling,
    'USD',
    seed.status ?? 'ACTIVE',
    seed.expiresAt === undefined ? new Date((nowSeconds() + 31_536_000) * 1000).toISOString() : seed.expiresAt,
    JSON.stringify(seed.scope ?? [defaultAction]),
    JSON.stringify(seed.counterpartyAllowlist ?? [counterparty]),
    seed.revokedAt ?? null,
  );
  return Number(inserted.lastInsertRowid);
}

function seedReservation(
  delegationId: number,
  amount: number,
  status: 'RESERVED' | 'RELEASED' | 'SETTLED' | 'EXPIRED',
): number {
  const inserted = db.prepare(`
    INSERT INTO budget_reservations (delegation_id, amount, status, expires_at)
    VALUES (?, ?, ?, ?)
  `).run(delegationId, amount, status, (nowSeconds() + 3_600) * 1000);
  return Number(inserted.lastInsertRowid);
}

function request(overrides: Partial<TrustRequest> = {}): TrustRequest {
  return {
    agentId: defaultAgentId,
    action: defaultAction,
    counterpartyId: defaultCounterparty,
    amount: 1_000_000,
    now: nowSeconds(),
    ...overrides,
  };
}

function latestReservation(): ReservationRow {
  const row = db.prepare('SELECT id, status, amount, expires_at FROM budget_reservations ORDER BY id DESC LIMIT 1').get() as ReservationRow | undefined;
  if (!row) throw new Error('Expected a budget_reservations row, but none was written');
  return row;
}

function reservationId(row: ReservationRow): string {
  const event = db.prepare(`
    SELECT payload FROM audit_events
    WHERE entity_type = 'budget_reservation' AND entity_id = ? AND event = 'reservation.reserved'
    ORDER BY id DESC LIMIT 1
  `).get(row.id) as { payload: string } | undefined;
  if (!event) throw new Error(`No reservation.reserved audit event exists for row ${row.id}`);
  const value = (JSON.parse(event.payload) as { reservationId?: unknown }).reservationId;
  if (typeof value !== 'string') throw new Error('Reservation audit payload has no string reservationId');
  return value;
}

function auditEventCount(): number {
  const row = db.prepare('SELECT COUNT(*) AS count FROM audit_events').get() as { count: number };
  return row.count;
}

function remainingBudget(input: TrustRequest): number {
  const result = authorize(db, input);
  if (!result.allowed) throw new Error(`Authorization was denied: ${result.code}`);
  return result.remainingBudget;
}

function authorizeAllowed(input: TrustRequest = request()): Extract<ReturnType<typeof authorize>, { allowed: true }> {
  const result = authorize(db, input);
  if (!result.allowed) throw new Error(`Authorization was denied: ${result.code}`);
  return result;
}

describe('trust authority', () => {
  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'atn-trust-'));
    const dbPath = path.join(tempDir, 'trust.sqlite');
    db = new Database(dbPath);
    db.pragma('foreign_keys = ON');
    const migrations = fs.readdirSync(migrationsDir).filter((name) => name.endsWith('.sql')).sort();
    for (const migration of migrations) db.exec(fs.readFileSync(path.join(migrationsDir, migration), 'utf8'));
  });

  afterEach(() => {
    db.close();
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it('allows a valid in-scope delegation and returns the remaining budget', () => {
    seedAgent();
    const delegation = seedDelegation();
    seedReservation(delegation, 1, 'RELEASED');
    const result = authorize(db, request());
    expect(result.allowed).toBe(true);
    expect(result.allowed ? result.remainingBudget : undefined).toBe(4_000_000);
  });

  it('denies an unknown agent with UNKNOWN_AGENT', () => {
    seedAgent();
    seedDelegation();
    const result = authorize(db, request({ agentId: 'missing-agent' }));
    expect(result.allowed).toBe(false);
    expect(result.allowed ? undefined : result.code).toBe('UNKNOWN_AGENT');
  });

  it('denies a revoked agent with AGENT_REVOKED', () => {
    seedAgent({ revokedAt: 1 });
    seedDelegation();
    const result = authorize(db, request());
    expect(result.allowed).toBe(false);
    expect(result.allowed ? undefined : result.code).toBe('AGENT_REVOKED');
  });

  it('denies a missing delegation with DELEGATION_MISSING', () => {
    seedAgent();
    const result = authorize(db, request());
    expect(result.allowed).toBe(false);
    expect(result.allowed ? undefined : result.code).toBe('DELEGATION_MISSING');
  });

  it('denies an expired delegation using the supplied now with DELEGATION_EXPIRED', () => {
    seedAgent();
    const now = nowSeconds();
    seedDelegation({ expiresAt: new Date((now - 1) * 1000).toISOString() });
    const result = authorize(db, request({ now }));
    expect(result.allowed).toBe(false);
    expect(result.allowed ? undefined : result.code).toBe('DELEGATION_EXPIRED');
  });

  it('denies a revoked delegation with DELEGATION_REVOKED', () => {
    seedAgent();
    seedDelegation({ revokedAt: 1 });
    const result = authorize(db, request());
    expect(result.allowed).toBe(false);
    expect(result.allowed ? undefined : result.code).toBe('DELEGATION_REVOKED');
  });

  it('denies a counterparty missing from the allowlist with COUNTERPARTY_DENIED', () => {
    seedAgent();
    seedDelegation({ counterpartyAllowlist: ['other-merchant'] });
    const result = authorize(db, request());
    expect(result.allowed).toBe(false);
    expect(result.allowed ? undefined : result.code).toBe('COUNTERPARTY_DENIED');
  });

  it('denies an action missing from scope with SCOPE_DENIED', () => {
    seedAgent();
    seedDelegation({ scope: ['invoice.read'] });
    const result = authorize(db, request());
    expect(result.allowed).toBe(false);
    expect(result.allowed ? undefined : result.code).toBe('SCOPE_DENIED');
  });

  it('denies an amount above the delegation ceiling with CEILING_EXCEEDED', () => {
    seedAgent();
    seedDelegation({ budgetCeiling: 500_000 });
    const result = authorize(db, request());
    expect(result.allowed).toBe(false);
    expect(result.allowed ? undefined : result.code).toBe('CEILING_EXCEEDED');
  });

  it('denies an amount above the agent budget with BUDGET_EXHAUSTED', () => {
    seedAgent({ budgetMicro: 500_000 });
    seedDelegation({ budgetCeiling: 5_000_000 });
    const result = authorize(db, request());
    expect(result.allowed).toBe(false);
    expect(result.allowed ? undefined : result.code).toBe('BUDGET_EXHAUSTED');
  });

  it('commits a reservation, writes an audit event, and reduces remaining budget', () => {
    seedAgent();
    seedDelegation({ budgetCeiling: 10_000_000 });
    const eventsBefore = auditEventCount();
    const decision = authorizeAllowed();
    reserve(db, decision, 1_000_000, 60);
    const row = latestReservation();
    commit(db, reservationId(row));
    expect(latestReservation().status).toBe('SETTLED');
    expect(auditEventCount()).toBeGreaterThan(eventsBefore);
    expect(remainingBudget(request())).toBe(8_000_000);
  });

  it('releases a reservation, restores budget, and writes an audit event', () => {
    seedAgent();
    seedDelegation({ budgetCeiling: 10_000_000 });
    const eventsBefore = auditEventCount();
    const decision = authorizeAllowed();
    reserve(db, decision, 1_000_000, 60);
    const row = latestReservation();
    release(db, reservationId(row));
    expect(remainingBudget(request())).toBe(9_000_000);
    expect(auditEventCount()).toBeGreaterThan(eventsBefore);
  });

  it('reserve then release restores the budget', () => {
    seedAgent();
    seedDelegation({ budgetCeiling: 10_000_000 });
    const decision = authorizeAllowed();
    reserve(db, decision, 1_000_000, 60);
    const row = latestReservation();
    const beforeRelease = remainingBudget(request());
    release(db, reservationId(row));
    expect(beforeRelease).toBe(8_000_000);
    expect(remainingBudget(request())).toBe(9_000_000);
  });

  it('reserveAndCommit succeeds on the happy path', () => {
    seedAgent();
    seedDelegation({ budgetCeiling: 10_000_000 });
    const eventsBefore = auditEventCount();
    reserveAndCommit(db, authorizeAllowed(), 1_000_000, 60);
    expect(latestReservation().status).toBe('SETTLED');
    expect(auditEventCount()).toBeGreaterThan(eventsBefore);
    expect(remainingBudget(request())).toBe(8_000_000);
  });

  it('never reserves more than the ceiling across 50 sequential authorizations', () => {
    seedAgent();
    seedDelegation({ budgetCeiling: 10_000_000 });
    let successes = 0;
    for (let index = 0; index < 50; index += 1) {
      const input = request();
      const result = authorize(db, input);
      if (result.allowed) {
        reserve(db, result, input.amount, 60);
        successes += 1;
      }
    }
    const sum = db.prepare("SELECT COALESCE(SUM(amount), 0) AS total FROM budget_reservations WHERE status = 'RESERVED'").get() as { total: number };
    expect(successes).toBe(10);
    expect(sum.total).toBeLessThanOrEqual(10_000_000);
  });

  it('hardens SQLite with WAL, foreign keys, trusted schema disabled, and enforced foreign keys', () => {
    hardenDatabase(db);
    const journal = db.pragma('journal_mode', { simple: true }) as string;
    const foreignKeys = db.pragma('foreign_keys', { simple: true }) as number;
    const trustedSchema = db.pragma('trusted_schema', { simple: true }) as number;
    expect(journal.toLowerCase()).toBe('wal');
    expect(foreignKeys).toBe(1);
    expect(trustedSchema).toBe(0);

    const temporaryAgentId = seedAgent({ externalId: 'temporary-agent' }).id;
    db.prepare('DELETE FROM agents WHERE id = ?').run(temporaryAgentId);
    const principal = principalId('orphan-principal');
    let error: unknown;
    try {
      db.prepare(`
        INSERT INTO delegations (
          external_id, principal_id, agent_id, budget_ceiling, currency, status,
          expires_at, scope_json, counterparty_allowlist_json, revoked_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        'orphan-delegation',
        principal,
        temporaryAgentId,
        1,
        'USD',
        'ACTIVE',
        null,
        JSON.stringify([defaultAction]),
        JSON.stringify([defaultCounterparty]),
        null,
      );
    } catch (caught) {
      error = caught;
    }
    expect(error).toBeInstanceOf(Error);
    expect(error instanceof Error ? error.message : '').toMatch(/FOREIGN KEY constraint failed/i);
  });
});