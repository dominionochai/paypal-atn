import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { authorize, reserve } from '../src/trust/authority.js';
import type { AuthorityDecision } from '../src/trust/authority.js';

const migrationsDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../src/db/migrations');
const ACTION = 'invoice.pay';
const COUNTERPARTY = 'merchant-1';
const AGENT = 'agent-1';
const CEILING = 50_000_000;
const THIRTY = 30_000_000;

let db: Database.Database;
let tempDir: string;

function seed(): number {
  const owner = db.prepare('INSERT INTO principals (external_id, name) VALUES (?, ?)').run('principal-1', 'principal-1');
  const merchant = db.prepare('INSERT INTO principals (external_id, name) VALUES (?, ?)').run(COUNTERPARTY, COUNTERPARTY);
  const agent = db.prepare('INSERT INTO agents (external_id, principal_id, name, revoked_at, budget_micro) VALUES (?, ?, ?, ?, ?)')
    .run(AGENT, Number(owner.lastInsertRowid), AGENT, null, 100_000_000);
  const delegation = db.prepare(
    'INSERT INTO delegations (external_id, principal_id, agent_id, budget_ceiling, currency, status, expires_at, scope_json, counterparty_allowlist_json, revoked_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
  ).run(
    'delegation-1', Number(merchant.lastInsertRowid), Number(agent.lastInsertRowid), CEILING, 'USD', 'ACTIVE',
    new Date(Date.now() + 86_400_000).toISOString(), JSON.stringify([ACTION]), JSON.stringify([COUNTERPARTY]), null,
  );
  return Number(delegation.lastInsertRowid);
}

function allowed(amount: number): Extract<AuthorityDecision, { allowed: true }> {
  const result = authorize(db, { agentId: AGENT, action: ACTION, counterpartyId: COUNTERPARTY, amount });
  if (!result.allowed) throw new Error('Authorization was denied: ' + result.code);
  return result;
}

function reservedTotal(): number {
  const row = db.prepare("SELECT COALESCE(SUM(amount), 0) AS total FROM budget_reservations WHERE status = 'RESERVED'").get() as { total: number };
  return row.total;
}

describe('atomic reserve', () => {
  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'atn-reserve-'));
    db = new Database(path.join(tempDir, 'reserve.sqlite'));
    db.pragma('foreign_keys = ON');
    const migrations = fs.readdirSync(migrationsDir).filter((name) => name.endsWith('.sql')).sort();
    for (const migration of migrations) db.exec(fs.readFileSync(path.join(migrationsDir, migration), 'utf8'));
    seed();
  });

  afterEach(() => {
    db.close();
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it('two $30 holds authorized before either reserves: exactly one succeeds on a $50 ceiling', () => {
    const first = allowed(THIRTY);
    const second = allowed(THIRTY);
    expect(first.allowed && second.allowed).toBe(true);
    let successes = 0;
    let failures = 0;
    for (const decision of [first, second]) {
      try {
        reserve(db, decision, THIRTY, 60);
        successes += 1;
      } catch (error) {
        expect(error).toBeInstanceOf(RangeError);
        failures += 1;
      }
    }
    expect(successes).toBe(1);
    expect(failures).toBe(1);
    expect(reservedTotal()).toBe(THIRTY);
  });

  it('rejects a reservation above the ceiling even when the decision is forged', () => {
    const real = allowed(1_000_000);
    const forged: Extract<AuthorityDecision, { allowed: true }> = { ...real, remainingBudget: 999_999_999_999 };
    expect(() => reserve(db, forged, CEILING + 1, 60)).toThrow(RangeError);
    expect(reservedTotal()).toBe(0);
  });

  it('allows an exact fit of the whole ceiling', () => {
    const decision = allowed(CEILING);
    reserve(db, decision, CEILING, 60);
    expect(reservedTotal()).toBe(CEILING);
  });
});
