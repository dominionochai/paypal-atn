import type { VoucherPayload } from './signing.js';
import { canonicalize, verifyVoucher } from './signing.js';
export type ReasonCode = 'STALE' | 'REPLAYED' | 'TAMPERED' | 'OVER_BUDGET' | 'WRONG_PARTY' | 'NON_MONOTONIC' | 'CHANNEL_CLOSED' | 'UNKNOWN_CHANNEL';
export type VoucherResult = { ok: true } | { ok: false; code: ReasonCode; detail: string };
export interface ChannelRow { id: string; payer_agent_id: string; payee_agent_id: string; payer_public_key: string; ceiling: number; spent: number; last_nonce: number; status: string; created_at: number; expires_at: number; }
export interface VoucherInput { payload: VoucherPayload; signature: string; }
export interface DbLike { prepare(sql: string): { run(...a: unknown[]): unknown; get(...a: unknown[]): unknown; all(...a: unknown[]): unknown[] }; }
export function validateVoucher(db: DbLike, v: VoucherInput, channel: ChannelRow, delegationBudget: number, now: number = Date.now()): VoucherResult {
  if (channel.status !== 'OPEN') return { ok: false, code: 'CHANNEL_CLOSED', detail: `channel status is ${channel.status}` };
  if (now > channel.expires_at) return { ok: false, code: 'STALE', detail: 'channel expired' };
  if (v.payload.channelId !== channel.id) return { ok: false, code: 'WRONG_PARTY', detail: 'channel id mismatch' };
  if (v.payload.payeeAgentId !== channel.payee_agent_id) return { ok: false, code: 'WRONG_PARTY', detail: 'payee does not match channel payee' };
  if (!verifyVoucher(v.payload, v.signature, channel.payer_public_key)) return { ok: false, code: 'TAMPERED', detail: 'signature verification failed' };
  if (v.payload.nonce <= channel.last_nonce) return { ok: false, code: 'STALE', detail: 'nonce not newer than last accepted nonce' };
  if (v.payload.cumulativeAmount < channel.spent) return { ok: false, code: 'NON_MONOTONIC', detail: 'cumulative amount decreased' };
  if (v.payload.cumulativeAmount > channel.ceiling) return { ok: false, code: 'OVER_BUDGET', detail: 'exceeds channel ceiling' };
  if (v.payload.cumulativeAmount > delegationBudget) return { ok: false, code: 'OVER_BUDGET', detail: 'exceeds agent delegation budget' };
  try {
    db.prepare('INSERT INTO vouchers (channel_id, nonce, cumulative_amount, issued_at, canonical_payload, signature, accepted_at) VALUES (?,?,?,?,?,?,?)').run(channel.id, v.payload.nonce, v.payload.cumulativeAmount, v.payload.issuedAt, canonicalize(v.payload), v.signature, now);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (msg.includes('UNIQUE')) return { ok: false, code: 'REPLAYED', detail: 'nonce already accepted for this channel' };
    throw e;
  }
  return { ok: true };
}
