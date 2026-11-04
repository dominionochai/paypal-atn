import type { VoucherPayload } from './signing.js';
import { canonicalize, verifyVoucher } from './signing.js';
import { getVault } from '../trust/authority.js';

export type ReasonCode =
  | 'STALE'
  | 'REPLAYED'
  | 'TAMPERED'
  | 'OVER_BUDGET'
  | 'WRONG_PARTY'
  | 'NON_MONOTONIC'
  | 'CHANNEL_CLOSED'
  | 'UNKNOWN_CHANNEL'
  | 'VAULT_CLOSED'
  | 'VAULT_REVOKED'
  | 'VAULT_EXPIRED'
  | 'DELEGATION_REVOKED'
  | 'AGENT_REVOKED'
  | 'ISSUED_AT_SKEW';

export type VoucherResult = { ok: true } | { ok: false; code: ReasonCode; detail: string };

export interface ChannelRow {
  id: string;
  payer_agent_id: string;
  payee_agent_id: string;
  payer_public_key: string;
  ceiling: number;
  spent: number;
  last_nonce: number;
  status: string;
  created_at: number;
  expires_at: number;
  vault_id: string;
  reservation_ref: string;
  delegation_id: number;
}

export interface VoucherInput { payload: VoucherPayload; signature: string }

export interface DbLike {
  prepare(sql: string): { run(...a: unknown[]): unknown; get(...a: unknown[]): unknown; all(...a: unknown[]): unknown[] };
}

export function validateVoucher(db: DbLike, v: VoucherInput, channel: ChannelRow, now: number = Date.now()): VoucherResult {
  if (channel.status !== 'OPEN') return { ok: false, code: 'CHANNEL_CLOSED', detail: `channel status is ${channel.status}` };
  if (v.payload.channelId !== channel.id) return { ok: false, code: 'WRONG_PARTY', detail: 'channel id mismatch' };
  if (v.payload.payeeAgentId !== channel.payee_agent_id) return { ok: false, code: 'WRONG_PARTY', detail: 'payee does not match channel payee' };
  if (!verifyVoucher(v.payload, v.signature, channel.payer_public_key)) return { ok: false, code: 'TAMPERED', detail: 'signature verification failed' };

  // Check issuedAt within +/-60s of server clock
  const issuedAt = v.payload.issuedAt;
  if (!Number.isSafeInteger(issuedAt) || Math.abs(now - issuedAt) > 60_000) {
    return { ok: false, code: 'ISSUED_AT_SKEW', detail: 'issuedAt outside +/-60s of server clock' };
  }

  // Vault checks
  const vault = getVault(db as any, channel.vault_id);
  if (!vault) return { ok: false, code: 'VAULT_CLOSED', detail: 'vault not found' };
  if (vault.state === 'REVOKED') return { ok: false, code: 'VAULT_REVOKED', detail: 'vault revoked' };
  if (vault.state !== 'OPEN') return { ok: false, code: 'VAULT_CLOSED', detail: `vault state is ${vault.state}` };
  const vaultExpMs = Date.parse(vault.expires_at);
  if (Number.isFinite(vaultExpMs) && vaultExpMs <= now) return { ok: false, code: 'VAULT_EXPIRED', detail: 'vault expired' };

  // Delegation not revoked
  const delegation = (db as any).prepare('SELECT status FROM delegations WHERE id = ?').get(channel.delegation_id) as { status: string } | undefined;
  if (!delegation || delegation.status === 'REVOKED') return { ok: false, code: 'DELEGATION_REVOKED', detail: 'delegation revoked' };

  // Payer agent not revoked
  const payerAgent = (db as any).prepare('SELECT revoked_at FROM agents WHERE external_id = ?').get(channel.payer_agent_id) as { revoked_at: number | null } | undefined;
  if (payerAgent && payerAgent.revoked_at !== null) return { ok: false, code: 'AGENT_REVOKED', detail: 'payer agent revoked' };

  if (now > channel.expires_at) return { ok: false, code: 'STALE', detail: 'channel expired' };

  if ((db as any).prepare('SELECT 1 FROM vouchers WHERE channel_id = ? AND nonce = ?').get(channel.id, v.payload.nonce)) return { ok: false, code: 'REPLAYED', detail: 'nonce already accepted for this channel' };
  if (v.payload.nonce <= channel.last_nonce) return { ok: false, code: 'STALE', detail: 'nonce not newer than last accepted nonce' };
  if (v.payload.cumulativeAmount < channel.spent) return { ok: false, code: 'NON_MONOTONIC', detail: 'cumulative amount decreased' };
  if (v.payload.cumulativeAmount > channel.ceiling) return { ok: false, code: 'OVER_BUDGET', detail: 'exceeds channel ceiling' };

  try {
    (db as any).prepare('INSERT INTO vouchers (channel_id, nonce, cumulative_amount, issued_at, canonical_payload, signature, accepted_at) VALUES (?,?,?,?,?,?,?)').run(channel.id, v.payload.nonce, v.payload.cumulativeAmount, v.payload.issuedAt, canonicalize(v.payload), v.signature, now);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (msg.includes('UNIQUE')) return { ok: false, code: 'REPLAYED', detail: 'nonce already accepted for this channel' };
    throw e;
  }
  return { ok: true };
}