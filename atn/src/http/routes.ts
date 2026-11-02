import type { IncomingHttpHeaders } from 'node:http';
import type { Database } from 'better-sqlite3';
import { openChannel, getChannel, acceptVoucher, settleChannel, AlreadySettledError, UnknownChannelError } from '../streaming/channel.js';
import type { VoucherInput } from '../streaming/voucher.js';
import { SandboxAdapter } from '../payments/adapter.js';

export interface RouteInput {
  method: string;
  path: string;
  headers: IncomingHttpHeaders;
  body: Buffer;
  db: Database;
  delegationBudget: number;
}

export interface RouteOutput {
  status: number;
  body: unknown;
}

const json = (status: number, body: unknown): RouteOutput => ({ status, body });
const bad = (detail: string): RouteOutput => json(400, { error: 'BAD_REQUEST', detail });

function parseJsonBody(body: Buffer): Record<string, unknown> | null {
  if (body.length === 0) return null;
  try {
    const parsed: unknown = JSON.parse(body.toString('utf8'));
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return null;
    return parsed as Record<string, unknown>;
  } catch {
    return null;
  }
}

function nonEmptyString(v: unknown): v is string {
  return typeof v === 'string' && v.length > 0;
}

function positiveInt(v: unknown): v is number {
  return typeof v === 'number' && Number.isSafeInteger(v) && v > 0;
}

export async function handleRequest(input: RouteInput): Promise<RouteOutput> {
  const { method, path, headers, body, db } = input;
  const segments = path.split('?')[0]?.split('/').filter((s) => s.length > 0) ?? [];
  try {
    if (method === 'POST' && segments.length === 2 && segments[0] === 'v1' && segments[1] === 'channels') {
      const parsed = parseJsonBody(body);
      if (!parsed) return bad('body must be a JSON object');
      const { payerAgentId, payeeAgentId, payerPublicKey, ceiling, ttlSeconds } = parsed;
      if (!nonEmptyString(payerAgentId)) return bad('payerAgentId must be a non-empty string');
      if (!nonEmptyString(payeeAgentId)) return bad('payeeAgentId must be a non-empty string');
      if (!nonEmptyString(payerPublicKey)) return bad('payerPublicKey must be a non-empty string');
      if (!positiveInt(ceiling)) return bad('ceiling must be a positive integer in micro-dollars');
      if (!positiveInt(ttlSeconds)) return bad('ttlSeconds must be a positive integer');
      const channel = openChannel(db, { payerAgentId, payeeAgentId, payerPublicKey, ceiling, ttlSeconds });
      return json(201, { channelId: channel.id, ceiling: channel.ceiling, expiresAt: channel.expires_at });
    }

    if (segments.length >= 3 && segments[0] === 'v1' && segments[1] === 'channels') {
      const channelId = segments[2] as string;
      const channel = getChannel(db, channelId);
      if (!channel) return json(404, { error: 'NOT_FOUND', detail: 'unknown channel' });

      if (method === 'GET' && segments.length === 3) {
        return json(200, {
          id: channel.id,
          spent: channel.spent,
          ceiling: channel.ceiling,
          status: channel.status,
          lastNonce: channel.last_nonce,
          expiresAt: channel.expires_at,
        });
      }

      if (method === 'POST' && segments.length === 4 && segments[3] === 'vouchers') {
        const parsed = parseJsonBody(body);
        if (!parsed) return bad('body must be a JSON object');
        const payload = parsed.payload;
        const signature = parsed.signature;
        if (typeof payload !== 'object' || payload === null || Array.isArray(payload)) return bad('payload must be an object');
        if (!nonEmptyString(signature)) return bad('signature must be a non-empty string');
        const voucher: VoucherInput = { payload: payload as VoucherInput['payload'], signature };
        const result = acceptVoucher(db, channelId, voucher, input.delegationBudget);
        if (!result.ok) {
          const status = result.code === 'REPLAYED' ? 409 : 422;
          return json(status, { error: result.code, detail: result.detail });
        }
        const updated = getChannel(db, channelId);
        if (!updated) return json(500, { error: 'INTERNAL' });
        return json(200, { ok: true, spent: updated.spent, ceiling: updated.ceiling });
      }

      if (method === 'POST' && segments.length === 4 && segments[3] === 'settle') {
        const rawAuthority = headers['x-atn-authority'];
        const authority = Array.isArray(rawAuthority) ? rawAuthority[0] : rawAuthority;
        if (!nonEmptyString(authority) || authority !== channel.payee_agent_id) {
          return json(403, { error: 'FORBIDDEN', detail: 'authority does not match channel payee' });
        }
        const parsed = parseJsonBody(body);
        if (!parsed) return bad('body must be a JSON object');
        const idempotencyKey = parsed.idempotencyKey;
        if (!nonEmptyString(idempotencyKey)) return bad('idempotencyKey must be a non-empty string');
        try {
          const settlement = await settleChannel(db, channelId, idempotencyKey, new SandboxAdapter());
          return json(200, {
            channelId: settlement.channel_id,
            amount: settlement.amount,
            mode: settlement.mode,
            adapterRef: settlement.adapter_ref,
            idempotencyKey: settlement.idempotency_key,
          });
        } catch (e) {
          const detail = e instanceof Error ? e.message : String(e);
          if (e instanceof AlreadySettledError) return json(409, { error: 'ALREADY_SETTLED', detail });
          if (e instanceof UnknownChannelError) return json(404, { error: 'NOT_FOUND', detail });
          throw e;
        }
      }
    }

    return json(404, { error: 'NOT_FOUND' });
  } catch (e) {
    const detail = e instanceof Error ? e.message : 'unexpected error';
    if (process.env.NODE_ENV !== 'production') process.stderr.write(`atn http error: ${detail}\\n`);
    return json(500, { error: 'INTERNAL' });
  }
}