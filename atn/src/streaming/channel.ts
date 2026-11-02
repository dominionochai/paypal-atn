import type { Database } from 'better-sqlite3';
import { randomUUID } from 'node:crypto';
import { validateVoucher, type ChannelRow, type VoucherInput, type VoucherResult } from './voucher.js';
import type { PaymentAdapter } from '../payments/adapter.js';
export type Db = Database;
export class AlreadySettledError extends Error { constructor(public channelId: string) { super(`channel ${channelId} is already settled`); this.name = 'AlreadySettledError'; } }
export class UnknownChannelError extends Error { constructor(public channelId: string) { super(`unknown channel ${channelId}`); this.name = 'UnknownChannelError'; } }
export function openChannel(db: Db, p: { payerAgentId: string; payeeAgentId: string; payerPublicKey: string; ceiling: number; ttlSeconds: number; now?: number }): ChannelRow {
 const now = p.now ?? Date.now();
 if (!Number.isSafeInteger(p.ceiling) || p.ceiling <= 0) throw new Error('ceiling must be a positive integer in micro-dollars');
 const row: ChannelRow = { id: randomUUID(), payer_agent_id: p.payerAgentId, payee_agent_id: p.payeeAgentId, payer_public_key: p.payerPublicKey, ceiling: p.ceiling, spent: 0, last_nonce: 0, status: 'OPEN', created_at: now, expires_at: now + p.ttlSeconds * 1000 };
 db.prepare('INSERT INTO channels (id, payer_agent_id, payee_agent_id, payer_public_key, ceiling, spent, last_nonce, status, created_at, expires_at) VALUES (?,?,?,?,?,?,?,?,?,?)').run(row.id, row.payer_agent_id, row.payee_agent_id, row.payer_public_key, row.ceiling, 0, 0, 'OPEN', row.created_at, row.expires_at); return row;
}
export function getChannel(db: Db, id: string): ChannelRow | null { return (db.prepare('SELECT * FROM channels WHERE id = ?').get(id) as ChannelRow | undefined) ?? null; }
export function acceptVoucher(db: Db, channelId: string, v: VoucherInput, delegationBudget: number): VoucherResult {
 let result: VoucherResult = { ok: false, code: 'UNKNOWN_CHANNEL', detail: 'no such channel' };
 db.transaction(() => { const ch = getChannel(db, channelId); if (!ch) { result = { ok: false, code: 'UNKNOWN_CHANNEL', detail: 'no such channel' }; return; } result = validateVoucher(db, v, ch, delegationBudget); if (result.ok) { const nextSpent = Math.max(ch.spent, v.payload.cumulativeAmount); db.prepare('UPDATE channels SET spent = ?, last_nonce = ? WHERE id = ?').run(nextSpent, v.payload.nonce, channelId); } })();
 return result;
}
export function closeChannel(db: Db, channelId: string): { channelId: string; amount: number } { const ch = getChannel(db, channelId); if (!ch) throw new UnknownChannelError(channelId); if (ch.status === 'SETTLED') throw new AlreadySettledError(channelId); db.prepare("UPDATE channels SET status = 'CLOSING' WHERE id = ?").run(channelId); return { channelId, amount: ch.spent }; }
export interface SettlementRow { id: number; channel_id: string; amount: number; mode: string; idempotency_key: string; adapter_ref: string | null; created_at: number; }
export async function settleChannel(db: Db, channelId: string, idempotencyKey: string, adapter: PaymentAdapter): Promise<SettlementRow> {
 const existing = db.prepare('SELECT * FROM settlements WHERE idempotency_key = ?').get(idempotencyKey) as SettlementRow | undefined;
 if (existing) { if (existing.channel_id !== channelId) throw new Error('idempotency key reused for a different channel'); return existing; }
 const ch = getChannel(db, channelId); if (!ch) throw new UnknownChannelError(channelId);
 const settled = db.prepare('SELECT * FROM settlements WHERE channel_id = ?').get(channelId) as SettlementRow | undefined; if (settled) throw new AlreadySettledError(channelId);
 if (ch.status === 'OPEN') db.prepare("UPDATE channels SET status = 'CLOSING' WHERE id = ?").run(channelId);
 const charge = await adapter.charge({ amount: ch.spent, currency: 'USD', idempotencyKey, channelId }); const now = Date.now();
 db.prepare('INSERT INTO settlements (channel_id, amount, mode, idempotency_key, adapter_ref, created_at) VALUES (?,?,?,?,?,?)').run(channelId, ch.spent, charge.mode, idempotencyKey, charge.ref, now);
 db.prepare("UPDATE channels SET status = 'SETTLED' WHERE id = ?").run(channelId);
 db.prepare('INSERT INTO audit_events (entity_type, entity_id, event, payload, actor) VALUES (?,?,?,?,?)').run('channel', null, 'channel.settled', JSON.stringify({ channelId, amount: ch.spent, mode: charge.mode, idempotencyKey, adapterRef: charge.ref }), null);
 return db.prepare('SELECT * FROM settlements WHERE idempotency_key = ?').get(idempotencyKey) as SettlementRow;
}
