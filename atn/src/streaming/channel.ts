import type { Database } from 'better-sqlite3';
import { randomUUID } from 'node:crypto';
import { validateVoucher, type ChannelRow, type VoucherInput, type VoucherResult } from './voucher.js';
import type { PaymentAdapter } from '../payments/adapter.js';
import { reserveForChannel, getVault } from '../trust/authority.js';
export type Db = Database;
export class AlreadySettledError extends Error { constructor(public channelId: string) { super(`channel ${channelId} is already settled`); this.name = 'AlreadySettledError'; } }
export class UnknownChannelError extends Error { constructor(public channelId: string) { super(`unknown channel ${channelId}`); this.name = 'UnknownChannelError'; } }

export interface OpenChannelParams {
  payerAgentId: string;
  payeeAgentId: string;
  vaultId: string;
  ceiling: number;
  ttlSeconds: number;
  now?: number;
}

export function openChannel(db: Db, p: OpenChannelParams): ChannelRow {
  const now = p.now ?? Date.now();
  if (!Number.isSafeInteger(p.ceiling) || p.ceiling <= 0) throw new Error('ceiling must be a positive integer in micro-dollars');

  // Verify vault exists and is open
  const vault = getVault(db, p.vaultId);
  if (!vault) throw new Error('Vault not found');
  if (vault.state !== 'OPEN') throw new Error('Vault is not open');
  const vaultExpMs = Date.parse(vault.expires_at);
  if (Number.isFinite(vaultExpMs) && vaultExpMs <= now) throw new Error('Vault has expired');

  // Verify payer agent exists and get their public key from registry
  const payerAgent = db.prepare('SELECT id, ed25519_public_key, revoked_at FROM agents WHERE external_id = ?').get(p.payerAgentId) as { id: number; ed25519_public_key: string; revoked_at: number | null } | undefined;
  if (!payerAgent) throw new Error('Payer agent not found');
  if (payerAgent.revoked_at !== null) throw new Error('Payer agent is revoked');

  // Verify payee agent exists and is not revoked
  const payeeAgent = db.prepare('SELECT id, revoked_at FROM agents WHERE external_id = ?').get(p.payeeAgentId) as { id: number; revoked_at: number | null } | undefined;
  if (!payeeAgent) throw new Error('Payee agent not found');
  if (payeeAgent.revoked_at !== null) throw new Error('Payee agent is revoked');

  // Verify payee is in delegation counterparties for this vault
  const delegation = db.prepare('SELECT counterparty_allowlist_json FROM delegations WHERE id = ?').get(vault.delegation_id) as { counterparty_allowlist_json: string } | undefined;
  if (!delegation) throw new Error('Delegation not found');
  const counterparties = JSON.parse(delegation.counterparty_allowlist_json || '[]') as string[];
  if (!counterparties.includes(p.payeeAgentId)) throw new Error('Payee not in delegation counterparties');

  // Cap TTL at vault expiry
  const maxTtlMs = vaultExpMs - now;
  if (maxTtlMs <= 0) throw new Error('Vault has expired');
  const ttlMs = Math.min(p.ttlSeconds * 1000, maxTtlMs);
  if (ttlMs <= 0) throw new Error('TTL exceeds vault expiry');

  // Reserve the ceiling amount from the vault
  const reservation = reserveForChannel(db, p.vaultId, p.ceiling, Math.ceil(ttlMs / 1000), now);

  const row: ChannelRow = {
    id: randomUUID(),
    payer_agent_id: p.payerAgentId,
    payee_agent_id: p.payeeAgentId,
    payer_public_key: payerAgent.ed25519_public_key, // From agent registry, not request body
    ceiling: p.ceiling,
    spent: 0,
    last_nonce: 0,
    status: 'OPEN',
    created_at: now,
    expires_at: now + ttlMs,
    vault_id: p.vaultId,
    reservation_ref: reservation.reservationId,
    delegation_id: vault.delegation_id,
  };
  db.prepare('INSERT INTO channels (id, payer_agent_id, payee_agent_id, payer_public_key, ceiling, spent, last_nonce, status, created_at, expires_at, vault_id, reservation_ref, delegation_id) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)')
    .run(row.id, row.payer_agent_id, row.payee_agent_id, row.payer_public_key, row.ceiling, 0, 0, 'OPEN', row.created_at, row.expires_at, row.vault_id, row.reservation_ref, row.delegation_id);
  return row;
}

export function getChannel(db: Db, id: string): ChannelRow | null {
  return (db.prepare('SELECT * FROM channels WHERE id = ?').get(id) as ChannelRow | undefined) ?? null;
}

export function acceptVoucher(db: Db, channelId: string, v: VoucherInput, _delegationBudget: number, now?: number): VoucherResult {
  let result: VoucherResult = { ok: false, code: 'UNKNOWN_CHANNEL', detail: 'no such channel' };
  db.transaction(() => {
    const ch = getChannel(db, channelId);
    if (!ch) {
      result = { ok: false, code: 'UNKNOWN_CHANNEL', detail: 'no such channel' };
      return;
    }
    // Validate voucher with vault checks
    result = validateVoucher(db, v, ch, now ?? Date.now());
    if (result.ok) {
      const nextSpent = Math.max(ch.spent, v.payload.cumulativeAmount);
      db.prepare('UPDATE channels SET spent = ?, last_nonce = ? WHERE id = ?').run(nextSpent, v.payload.nonce, channelId);
    }
  })();
  return result;
}

export function closeChannel(db: Db, channelId: string): { channelId: string; amount: number } {
  const ch = getChannel(db, channelId);
  if (!ch) throw new UnknownChannelError(channelId);
  if (ch.status === 'SETTLED') throw new AlreadySettledError(channelId);
  if (ch.status === 'CLOSED') return { channelId, amount: ch.spent };
  db.prepare("UPDATE channels SET status = 'CLOSED' WHERE id = ?").run(channelId);
  return { channelId, amount: ch.spent };
}

export interface SettlementRow {
  id: number;
  channel_id: string;
  amount: number;
  mode: string;
  idempotency_key: string;
  adapter_ref: string | null;
  status: string;
  created_at: number;
  completed_at: number | null;
}

export async function settleChannel(db: Db, channelId: string, idempotencyKey: string, adapter: PaymentAdapter): Promise<SettlementRow> {
  const ch = getChannel(db, channelId);
  if (!ch) throw new UnknownChannelError(channelId);

  // Check for existing settlement with this idempotency key FIRST
  const existing = db.prepare('SELECT * FROM settlements WHERE idempotency_key = ?').get(idempotencyKey) as SettlementRow | undefined;
  if (existing) {
    if (existing.channel_id !== channelId) throw new Error('idempotency key reused for a different channel');
    if (existing.status === 'COMPLETED') return existing;
    db.prepare('UPDATE settlements SET status = \'PENDING\' WHERE idempotency_key = ?').run(idempotencyKey);
  } else {
    if (ch.status === 'SETTLED') throw new AlreadySettledError(channelId);

    // No existing idempotency key - check if channel already has a settlement (COMPLETED or PENDING)
    const channelSettlement = db.prepare('SELECT * FROM settlements WHERE channel_id = ? AND status IN (\'COMPLETED\', \'PENDING\')').get(channelId) as SettlementRow | undefined;
    if (channelSettlement) throw new AlreadySettledError(channelId);
    
    const anyChannelSettlement = db.prepare('SELECT * FROM settlements WHERE channel_id = ?').get(channelId) as SettlementRow | undefined;
    if (anyChannelSettlement) {
      if (anyChannelSettlement.status === 'COMPLETED') throw new AlreadySettledError(channelId);
      db.prepare('UPDATE settlements SET idempotency_key = ?, status = \'PENDING\', created_at = ? WHERE channel_id = ?')
        .run(idempotencyKey, Date.now(), channelId);
    } else {
      // Insert new PENDING settlement row BEFORE calling adapter
      const now = Date.now();
      db.prepare('INSERT INTO settlements (channel_id, idempotency_key, amount, mode, status, created_at) VALUES (?,?,?,?,\'PENDING\',?)')
        .run(channelId, idempotencyKey, ch.spent, 'UNKNOWN', now);
    }
  }

  if (ch.spent === 0) {
    const now = Date.now();
    db.transaction(() => {
      if (ch.reservation_ref && ch.vault_id) {
        db.prepare('UPDATE vaults SET reserved = reserved - ? WHERE id = ?').run(ch.ceiling, ch.vault_id);
        db.prepare("UPDATE budget_reservations SET amount = 0, status = 'RELEASED' WHERE reservation_ref = ?").run(ch.reservation_ref);
      }
      db.prepare("UPDATE channels SET status = 'SETTLED' WHERE id = ?").run(channelId);
      db.prepare('UPDATE settlements SET amount = ?, mode = ?, status = \'COMPLETED\', completed_at = ? WHERE channel_id = ? AND idempotency_key = ?')
        .run(0, 'SIMULATED', now, channelId, idempotencyKey);
    })();
    return db.prepare('SELECT * FROM settlements WHERE idempotency_key = ?').get(idempotencyKey) as SettlementRow;
  }

  // Call adapter OUTSIDE transaction
  let charge: { mode: string; ref: string } | null = null;
  let adapterError: Error | null = null;
  try {
    charge = await adapter.charge({ amount: ch.spent, currency: 'USD', idempotencyKey, channelId });
  } catch (e) {
    adapterError = e instanceof Error ? e : new Error(String(e));
  }

  if (adapterError) {
    // Mark settlement as FAILED, allow retry with same key
    db.prepare('UPDATE settlements SET status = \'FAILED\', completed_at = ? WHERE channel_id = ? AND idempotency_key = ?')
      .run(Date.now(), channelId, idempotencyKey);
    throw adapterError;
  }

  // Success: in ONE transaction, commit spent to vault, release unspent remainder, mark channel SETTLED, write audit
  const unspent = ch.ceiling - ch.spent;
  const now = Date.now();
  db.transaction(() => {
    // Update settlement row
    db.prepare('UPDATE settlements SET amount = ?, mode = ?, adapter_ref = ?, status = \'COMPLETED\', completed_at = ? WHERE channel_id = ? AND idempotency_key = ?')
      .run(ch.spent, charge!.mode, charge!.ref, now, channelId, idempotencyKey);

    // Update vault: move spent from reserved to committed, release unspent remainder
    if (ch.reservation_ref && ch.vault_id) {
      db.prepare('UPDATE vaults SET reserved = reserved - ?, committed = committed + ? WHERE id = ?')
        .run(ch.ceiling, ch.spent, ch.vault_id);
      db.prepare("UPDATE budget_reservations SET amount = ?, status = 'SETTLED' WHERE reservation_ref = ?")
        .run(ch.spent, ch.reservation_ref);
    }

    // Mark channel SETTLED
    db.prepare("UPDATE channels SET status = 'SETTLED' WHERE id = ?").run(channelId);

    // Write audit
    db.prepare('INSERT INTO audit_events (entity_type, entity_id, event, payload, actor) VALUES (?,?,?,?,?)')
      .run('channel', null, 'channel.settled', JSON.stringify({ channelId, amount: ch.spent, mode: charge!.mode, idempotencyKey, adapterRef: charge!.ref, unspentReleased: unspent }), null);
  })();

  return db.prepare('SELECT * FROM settlements WHERE idempotency_key = ?').get(idempotencyKey) as SettlementRow;
}

export async function sweepExpiredChannels(db: Db, adapter: PaymentAdapter, now?: number): Promise<void> {
  const nowMs = now ?? Date.now();

  // Find expired OPEN channels
  const expiredChannels = db.prepare("SELECT * FROM channels WHERE status = 'OPEN' AND expires_at <= ?").all(nowMs) as ChannelRow[];

  for (const ch of expiredChannels) {
    if (ch.spent === 0) {
      if (ch.reservation_ref && ch.vault_id) {
        db.transaction(() => {
          db.prepare('UPDATE vaults SET reserved = reserved - ? WHERE id = ?').run(ch.ceiling, ch.vault_id);
          db.prepare("UPDATE budget_reservations SET amount = 0, status = 'RELEASED' WHERE reservation_ref = ?").run(ch.reservation_ref);
          db.prepare("UPDATE channels SET status = 'EXPIRED' WHERE id = ?").run(ch.id);
          db.prepare('INSERT INTO audit_events (entity_type, entity_id, event, payload, actor) VALUES (?,?,?,?,?)')
            .run('channel', null, 'channel.expired', JSON.stringify({ channelId: ch.id, reason: 'zero_spent' }), null);
        })();
      }
    } else {
      try {
        await settleChannel(db, ch.id, `sweep-${ch.id}`, adapter);
      } catch (e) {
        // On adapter failure leave the channel OPEN/retryable and settlement row FAILED
      }
    }
  }
}