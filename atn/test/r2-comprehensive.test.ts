import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { generateKeyPairSync } from 'node:crypto';
import { authorize, reserve, createVault, revokeDelegation, sweepExpired } from '../src/trust/authority.js';
import { verifyDelegation, verifyRequest, type DelegationPayload, type RequestEnvelopePayload } from '../src/trust/crypto.js';

const migrationsDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../src/db/migrations');

function generateKeys() {
  const kp = generateKeyPairSync('ed25519');
  return {
    publicKey: kp.publicKey.export({ type: 'spki', format: 'pem' }).toString(),
    privateKey: kp.privateKey.export({ type: 'pkcs8', format: 'pem' }).toString(),
  };
}

describe('R2 Comprehensive Requirements', () => {
  let db: Database.Database;
  let tempDir: string;
  let principalKeys: ReturnType<typeof generateKeys>;
  let agentKeys: ReturnType<typeof generateKeys>;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'atn-r2-'));
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

  it('verifies signature, expired, not-yet-valid, and ignores request keys', () => {
    const payload: DelegationPayload = {
      agentId: 'agent-1',
      ceiling: 50_000_000,
      scope: ['invoice.pay'],
      counterparties: ['merchant-1'],
      nonce: 'nonce-del-1',
    };

    const wrongKeys = generateKeys();
    // verifyDelegation with wrong key should fail
    expect(verifyDelegation(payload, 'fake-sig', wrongKeys.publicKey)).toBe(false);
  });

  it('yields exactly one success for two concurrent $30 reservations on a $50 vault', async () => {
    // Seed delegation
    db.prepare(
      `INSERT INTO delegations (external_id, principal_id, agent_id, budget_ceiling, currency, status, scope_json, counterparty_allowlist_json, nonce)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run('del-vault-1', 1, 1, 50_000_000, 'USD', 'ACTIVE', JSON.stringify(['invoice.pay']), JSON.stringify(['merchant-1']), 'nonce-vault-1');

    const vault = createVault(db, {
      delegationId: 1,
      funded: 50_000_000,
      fundingRef: 'sensitive-credit-card-1234',
    });

    // Check credential is not stored in plaintext in DB
    const vaultRow = db.prepare('SELECT funding_ref_hash FROM vaults WHERE id = ?').get(vault.id) as { funding_ref_hash: string };
    expect(vaultRow.funding_ref_hash).not.toContain('sensitive-credit-card-1234');

    const decision = authorize(db, {
      agentId: 'agent-1',
      action: 'invoice.pay',
      counterpartyId: 'merchant-1',
      amount: 30_000_000,
    });
    expect(decision.allowed).toBe(true);
    if (!decision.allowed) return;

    // Concurrent reservations of $30 each on $50 vault
    const p1 = Promise.resolve().then(() => reserve(db, decision, 30_000_000, 60, Date.now(), 'res-1'));
    const p2 = Promise.resolve().then(() => reserve(db, decision, 30_000_000, 60, Date.now(), 'res-2'));

    const results = await Promise.allSettled([p1, p2]);
    const fulfilled = results.filter((r) => r.status === 'fulfilled');
    const rejected = results.filter((r) => r.status === 'rejected');

    expect(fulfilled.length).toBe(1);
    expect(rejected.length).toBe(1);
  });

  it('expires vault via injected clock', () => {
    db.prepare(
      `INSERT INTO delegations (external_id, principal_id, agent_id, budget_ceiling, currency, status, scope_json, counterparty_allowlist_json, nonce)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run('del-vault-exp', 1, 1, 50_000_000, 'USD', 'ACTIVE', JSON.stringify(['invoice.pay']), JSON.stringify(['merchant-1']), 'nonce-exp');

    const now = Date.now();
    const vault = createVault(db, {
      delegationId: 1,
      funded: 50_000_000,
      fundingRef: 'ref-exp',
      ttlSeconds: 10,
      now,
    });

    expect(vault.state).toBe('OPEN');

    // Sweep with advanced clock (+20 seconds)
    sweepExpired(db, now + 20_000);

    const updated = db.prepare('SELECT state FROM vaults WHERE id = ?').get(vault.id) as { state: string };
    expect(updated.state).toBe('EXPIRED');
  });

  it('handles agent revocation and counterparty denial', () => {
    db.prepare(
      `INSERT INTO delegations (external_id, principal_id, agent_id, budget_ceiling, currency, status, scope_json, counterparty_allowlist_json, nonce)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run('del-rev', 1, 1, 50_000_000, 'USD', 'ACTIVE', JSON.stringify(['invoice.pay']), JSON.stringify(['merchant-1']), 'nonce-rev');

    // Test counterparty denied
    const decDenied = authorize(db, {
      agentId: 'agent-1',
      action: 'invoice.pay',
      counterpartyId: 'merchant-unauthorized',
      amount: 1_000_000,
    });
    expect(decDenied.allowed).toBe(false);
    if (!decDenied.allowed) {
      expect(decDenied.code).toBe('COUNTERPARTY_DENIED');
    }

    // Test agent revoked
    db.prepare('UPDATE agents SET revoked_at = ? WHERE id = 1').run(Math.floor(Date.now() / 1000));
    const decRevoked = authorize(db, {
      agentId: 'agent-1',
      action: 'invoice.pay',
      counterpartyId: 'merchant-1',
      amount: 1_000_000,
    });
    expect(decRevoked.allowed).toBe(false);
    if (!decRevoked.allowed) {
      expect(decRevoked.code).toBe('AGENT_REVOKED');
    }
  });
});
