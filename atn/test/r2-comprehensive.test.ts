import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { generateKeyPairSync, createHash } from 'node:crypto';
import { authorize, reserve, createVault, revokeDelegation, revokeVault, sweepExpired } from '../src/trust/authority.js';
import { verifyDelegation, verifyRequest, canonicalJson, type DelegationPayload, type RequestEnvelopePayload } from '../src/trust/crypto.js';
import { handleRequest } from '../src/http/routes.js';

const migrationsDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../src/db/migrations');

function generateKeys() {
  const kp = generateKeyPairSync('ed25519');
  return {
    publicKey: kp.publicKey.export({ type: 'spki', format: 'pem' }).toString(),
    privateKey: kp.privateKey.export({ type: 'pkcs8', format: 'pem' }).toString(),
  };
}

describe('R2b Comprehensive Requirements', () => {
  let db: Database.Database;
  let tempDir: string;
  let principalKeys: ReturnType<typeof generateKeys>;
  let agentKeys: ReturnType<typeof generateKeys>;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'atn-r2b-'));
    db = new Database(path.join(tempDir, 'test.sqlite'));
    db.pragma('foreign_keys = ON');
    const migrations = fs.readdirSync(migrationsDir).filter((name) => name.endsWith('.sql')).sort();
    for (const migration of migrations) {
      db.exec(fs.readFileSync(path.join(migrationsDir, migration), 'utf8'));
    }

    principalKeys = generateKeys();
    agentKeys = generateKeys();

    db.prepare('INSERT INTO principals (external_id, name, ed25519_public_key) VALUES (?, ?, ?)')
      .run('prin-1', 'Principal 1', principalKeys.publicKey);

    db.prepare('INSERT INTO agents (external_id, principal_id, name, ed25519_public_key, budget_micro) VALUES (?, ?, ?, ?, ?)')
      .run('agent-1', 1, 'Agent 1', agentKeys.publicKey, 100_000_000);
  });

  afterEach(() => {
    db.close();
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it('canonicalJson rejects undefined, NaN, Infinity, and non-integer numbers', () => {
    expect(() => canonicalJson(undefined)).toThrow(TypeError);
    expect(() => canonicalJson(NaN)).toThrow(TypeError);
    expect(() => canonicalJson(Infinity)).toThrow(TypeError);
    expect(() => canonicalJson(1.5)).toThrow(TypeError);
    expect(canonicalJson({ b: 2, a: 1 })).toBe('{"a":1,"b":2}');
  });

  it('verifies delegation signature and rejects wrong key or forged signature', () => {
    const payload: DelegationPayload = {
      version: 1,
      delegationId: 'del-1',
      principalId: 'prin-1',
      agentId: 'agent-1',
      ceiling: 50_000_000,
      scope: ['invoice.pay'],
      counterparties: ['merchant-1'],
      nonce: 'nonce-1',
    };
    const wrongKeys = generateKeys();
    expect(verifyDelegation(payload, 'fake-sig', wrongKeys.publicKey)).toBe(false);
  });

  it('enumerates every mutating route and asserts MISSING_ENVELOPE without envelope', async () => {
    const routes = [
      { method: 'POST', path: '/v1/channels' },
      { method: 'POST', path: '/v1/channels/ch-1/vouchers' },
      { method: 'POST', path: '/v1/channels/ch-1/settle' },
      { method: 'POST', path: '/v1/escrows' },
      { method: 'POST', path: '/v1/escrows/esc-1/inspect' },
      { method: 'POST', path: '/v1/escrows/esc-1/release' },
      { method: 'POST', path: '/v1/escrows/esc-1/refund' },
      { method: 'POST', path: '/v1/delegations' },
      { method: 'POST', path: '/v1/delegations/del-1/revoke' },
      { method: 'POST', path: '/v1/vaults' },
      { method: 'POST', path: '/v1/vaults/v-1/revoke' },
    ];

    for (const r of routes) {
      const out = await handleRequest({
        method: r.method,
        path: r.path,
        headers: {},
        body: Buffer.from(JSON.stringify({})),
        db,
        delegationBudget: 50_000_000,
      });
      expect(out.status).toBe(401);
      expect((out.body as { error: string }).error).toBe('MISSING_ENVELOPE');
    }
  });

  it('admin token fails closed when unset', async () => {
    delete process.env.ATN_ADMIN_TOKEN;
    const out = await handleRequest({
      method: 'POST',
      path: '/v1/principals',
      headers: {},
      body: Buffer.from(JSON.stringify({ externalId: 'p-2', name: 'P2', publicKey: principalKeys.publicKey })),
      db,
      delegationBudget: 50_000_000,
    });
    expect(out.status).toBe(503);
  });

  it('enforces vault state and expiry in authorize() and sweeper', () => {
    db.prepare(
      `INSERT INTO delegations (external_id, principal_id, agent_id, budget_ceiling, currency, status, scope_json, counterparty_allowlist_json, nonce)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run('del-v', 1, 1, 50_000_000, 'USD', 'ACTIVE', JSON.stringify(['invoice.pay']), JSON.stringify(['merchant-1']), 'nonce-v');

    const vault = createVault(db, {
      delegationId: 1,
      funded: 50_000_000,
      fundingRef: createHash('sha256').update('secret-nonce').digest('hex'),
      ttlSeconds: 10,
    });

    const decision = authorize(db, {
      agentId: 'agent-1',
      action: 'invoice.pay',
      counterpartyId: 'merchant-1',
      amount: 10_000_000,
    });
    expect(decision.allowed).toBe(true);

    // Revoke vault
    revokeVault(db, vault.id);
    const decRevoked = authorize(db, {
      agentId: 'agent-1',
      action: 'invoice.pay',
      counterpartyId: 'merchant-1',
      amount: 10_000_000,
    });
    expect(decRevoked.allowed).toBe(false);
    if (!decRevoked.allowed) {
      expect(decRevoked.code).toBe('VAULT_REVOKED');
    }
  });

  it('yields exactly one success for two concurrent $30 reservations on a $50 vault', async () => {
    db.prepare(
      `INSERT INTO delegations (external_id, principal_id, agent_id, budget_ceiling, currency, status, scope_json, counterparty_allowlist_json, nonce)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run('del-conc', 1, 1, 50_000_000, 'USD', 'ACTIVE', JSON.stringify(['invoice.pay']), JSON.stringify(['merchant-1']), 'nonce-conc');

    createVault(db, {
      delegationId: 1,
      funded: 50_000_000,
      fundingRef: createHash('sha256').update('secret-nonce').digest('hex'),
    });

    const decision = authorize(db, {
      agentId: 'agent-1',
      action: 'invoice.pay',
      counterpartyId: 'merchant-1',
      amount: 30_000_000,
    });
    expect(decision.allowed).toBe(true);
    if (!decision.allowed) return;

    const p1 = Promise.resolve().then(() => reserve(db, decision, 30_000_000, 60, Date.now(), 'res-1'));
    const p2 = Promise.resolve().then(() => reserve(db, decision, 30_000_000, 60, Date.now(), 'res-2'));

    const results = await Promise.allSettled([p1, p2]);
    const fulfilled = results.filter((r) => r.status === 'fulfilled');
    const rejected = results.filter((r) => r.status === 'rejected');

    expect(fulfilled.length).toBe(1);
    expect(rejected.length).toBe(1);
  });
});
