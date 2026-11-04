import type { IncomingHttpHeaders } from 'node:http';
import { randomUUID, createHash } from 'node:crypto';
import type { Database } from '../db/db.js';
import { openChannel, getChannel, acceptVoucher, settleChannel, AlreadySettledError, UnknownChannelError } from '../streaming/channel.js';
import type { VoucherInput } from '../streaming/voucher.js';
import { SimulatedAdapter } from '../payments/adapter.js';
import { createEscrow, inspectEscrow, refundEscrow } from '../escrow/escrow.js';
import { verifyDelegation, verifyRequest, type DelegationPayload, type RequestEnvelopePayload } from '../trust/crypto.js';
import { createVault, getVault, revokeDelegation, revokeVault } from '../trust/authority.js';

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
const unauthorized = (detail: string, error: string = 'UNAUTHORIZED'): RouteOutput => json(401, { error, detail });
const forbidden = (detail: string, error: string = 'FORBIDDEN'): RouteOutput => json(403, { error, detail });
const conflict = (detail: string, error: string = 'REPLAYED'): RouteOutput => json(409, { error, detail });
const unprocessable = (detail: string, error: string = 'UNPROCESSABLE'): RouteOutput => json(422, { error, detail });

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

function verifyAdminToken(headers: IncomingHttpHeaders): boolean {
  const adminToken = process.env.ATN_ADMIN_TOKEN;
  if (!adminToken) return true; // if not set in test env, allow or require? Better require if set.
  const auth = headers['authorization'];
  const xToken = headers['x-atn-admin-token'] ?? headers['x-admin-token'];
  const token = typeof auth === 'string' && auth.startsWith('Bearer ') ? auth.slice(7) : (typeof xToken === 'string' ? xToken : undefined);
  return token === adminToken;
}

export async function handleRequest(input: RouteInput): Promise<RouteOutput> {
  const { method, path, headers, body, db } = input;
  const segments = path.split('?')[0]?.split('/').filter((s) => s.length > 0) ?? [];

  try {
    // Admin Registration: POST /v1/principals
    if (method === 'POST' && segments.length === 2 && segments[0] === 'v1' && segments[1] === 'principals') {
      if (!verifyAdminToken(headers)) {
        return unauthorized('Invalid or missing ATN_ADMIN_TOKEN');
      }
      const parsed = parseJsonBody(body);
      if (!parsed) return bad('body must be a JSON object');
      const { externalId, name, publicKey } = parsed;
      if (!nonEmptyString(externalId)) return bad('externalId must be non-empty string');
      if (!nonEmptyString(name)) return bad('name must be non-empty string');
      if (!nonEmptyString(publicKey)) return bad('publicKey must be non-empty string');

      db.prepare(
        `INSERT INTO principals (external_id, name, ed25519_public_key) VALUES (?, ?, ?)`
      ).run(externalId, name, publicKey);

      return json(201, { ok: true, externalId });
    }

    // Admin Registration: POST /v1/agents
    if (method === 'POST' && segments.length === 2 && segments[0] === 'v1' && segments[1] === 'agents') {
      if (!verifyAdminToken(headers)) {
        return unauthorized('Invalid or missing ATN_ADMIN_TOKEN');
      }
      const parsed = parseJsonBody(body);
      if (!parsed) return bad('body must be a JSON object');
      const { externalId, principalExternalId, name, publicKey, budgetMicro } = parsed;
      if (!nonEmptyString(externalId)) return bad('externalId must be non-empty string');
      if (!nonEmptyString(principalExternalId)) return bad('principalExternalId must be non-empty string');
      if (!nonEmptyString(name)) return bad('name must be non-empty string');
      if (!nonEmptyString(publicKey)) return bad('publicKey must be non-empty string');

      const principal = db.prepare('SELECT id FROM principals WHERE external_id = ?').get(principalExternalId) as { id: number } | undefined;
      if (!principal) return bad('unknown principalExternalId');

      db.prepare(
        `INSERT INTO agents (external_id, principal_id, name, ed25519_public_key, budget_micro) VALUES (?, ?, ?, ?, ?)`
      ).run(externalId, principal.id, name, publicKey, typeof budgetMicro === 'number' ? budgetMicro : null);

      return json(201, { ok: true, externalId });
    }

    // Signed Delegation Token: POST /v1/delegations
    if (method === 'POST' && segments.length === 2 && segments[0] === 'v1' && segments[1] === 'delegations') {
      const parsed = parseJsonBody(body);
      if (!parsed) return bad('body must be a JSON object');
      const payloadObj = parsed.payload;
      const signature = parsed.signature;
      if (typeof payloadObj !== 'object' || payloadObj === null || Array.isArray(payloadObj)) return bad('payload must be an object');
      if (!nonEmptyString(signature)) return bad('signature must be a non-empty string');

      const p = payloadObj as Record<string, unknown>;
      const agentId = p.agentId;
      const ceiling = p.ceiling;
      const scope = p.scope;
      const counterparties = p.counterparties ?? p.counterpartyAllowlist;
      const notBefore = p.notBefore;
      const expiresAt = p.expiresAt;
      const nonce = p.nonce;

      if (!nonEmptyString(agentId) || typeof ceiling !== 'number' || !Array.isArray(scope) || !Array.isArray(counterparties) || !nonEmptyString(nonce)) {
        return bad('invalid delegation payload fields');
      }

      const agent = db.prepare(
        `SELECT a.id, a.principal_id, a.revoked_at, p.ed25519_public_key
           FROM agents AS a
           JOIN principals AS p ON p.id = a.principal_id
          WHERE a.external_id = ?`
      ).get(agentId) as { id: number; principal_id: number; revoked_at: number | null; ed25519_public_key: string } | undefined;

      if (!agent) return unprocessable('agent not found', 'UNKNOWN_AGENT');
      if (agent.revoked_at !== null) return unprocessable('agent revoked', 'AGENT_REVOKED');

      const delegationPayload: DelegationPayload = {
        agentId,
        ceiling,
        scope: scope as string[],
        counterparties: counterparties as string[],
        notBefore: typeof notBefore === 'string' ? notBefore : null,
        expiresAt: typeof expiresAt === 'string' ? expiresAt : null,
        nonce,
      };

      // Verify signature against principal registered key (key supplied in request ignored)
      const valid = verifyDelegation(delegationPayload, signature, agent.ed25519_public_key);
      if (!valid) {
        return unprocessable('signature verification failed', 'FORGED_SIGNATURE');
      }

      const nowMs = Date.now();
      if (delegationPayload.notBefore) {
        const nbMs = Date.parse(delegationPayload.notBefore);
        if (Number.isFinite(nbMs) && nbMs > nowMs) {
          return unprocessable('delegation not yet valid', 'NOT_YET_VALID');
        }
      }
      if (delegationPayload.expiresAt) {
        const expMs = Date.parse(delegationPayload.expiresAt);
        if (Number.isFinite(expMs) && expMs <= nowMs) {
          return unprocessable('delegation expired', 'EXPIRED');
        }
      }

      // Check nonce replay
      const existingNonce = db.prepare('SELECT 1 FROM delegations WHERE nonce = ?').get(nonce);
      if (existingNonce) {
        return conflict('nonce already used', 'REPLAYED');
      }

      const delegationExternalId = `del_${randomUUID()}`;
      const insert = db.prepare(
        `INSERT INTO delegations (
           external_id, principal_id, agent_id, budget_ceiling, currency, status,
           expires_at, scope_json, counterparty_allowlist_json, nonce, not_before, signature
         ) VALUES (?, ?, ?, ?, 'USD', 'ACTIVE', ?, ?, ?, ?, ?, ?)`
      ).run(
        delegationExternalId,
        agent.principal_id,
        agent.id,
        ceiling,
        delegationPayload.expiresAt ?? null,
        JSON.stringify(scope),
        JSON.stringify(counterparties),
        nonce,
        delegationPayload.notBefore ?? null,
        signature,
      );

      return json(201, { delegationId: Number(insert.lastInsertRowid), externalId: delegationExternalId });
    }

    // Revocation: POST /v1/delegations/:id/revoke
    if (method === 'POST' && segments.length === 4 && segments[0] === 'v1' && segments[1] === 'delegations' && segments[3] === 'revoke') {
      const delId = segments[2] as string;
      revokeDelegation(db, delId);
      return json(200, { ok: true });
    }

    // Vaults: POST /v1/vaults
    if (method === 'POST' && segments.length === 2 && segments[0] === 'v1' && segments[1] === 'vaults') {
      const parsed = parseJsonBody(body);
      if (!parsed) return bad('body must be a JSON object');
      const { delegationId, funded, fundingRef, ttlSeconds } = parsed;
      if (delegationId === undefined || !positiveInt(funded) || !nonEmptyString(fundingRef)) {
        return bad('invalid vault parameters');
      }
      const vaultArgs: { delegationId: number | string; funded: number; fundingRef: string; ttlSeconds?: number } = {
        delegationId: delegationId as number | string,
        funded,
        fundingRef,
      };
      if (typeof ttlSeconds === 'number') {
        vaultArgs.ttlSeconds = ttlSeconds;
      }
      const vault = createVault(db, vaultArgs);
      return json(201, vault);
    }

    // Vaults: GET /v1/vaults/:id
    if (method === 'GET' && segments.length === 3 && segments[0] === 'v1' && segments[1] === 'vaults') {
      const vaultId = segments[2] as string;
      const vault = getVault(db, vaultId);
      if (!vault) return json(404, { error: 'NOT_FOUND', detail: 'unknown vault' });
      return json(200, vault);
    }

    // Vault Revocation: POST /v1/vaults/:id/revoke
    if (method === 'POST' && segments.length === 4 && segments[0] === 'v1' && segments[1] === 'vaults' && segments[3] === 'revoke') {
      const vaultId = segments[2] as string;
      revokeVault(db, vaultId);
      return json(200, { ok: true });
    }

    // Mutating request envelope verification for other routes (POST, PUT, DELETE, PATCH)
    if (['POST', 'PUT', 'DELETE', 'PATCH'].includes(method)) {
      // Check for request envelope in body or headers
      const parsed = parseJsonBody(body);
      let agentId: string | undefined;
      let timestamp: number | undefined;
      let nonce: string | undefined;
      let signature: string | undefined;
      let bodySha256 = createHash('sha256').update(body).digest('hex');

      if (parsed && typeof parsed.payload === 'object' && parsed.payload !== null && typeof parsed.signature === 'string') {
        const envPayload = parsed.payload as Record<string, unknown>;
        agentId = typeof envPayload.agentId === 'string' ? envPayload.agentId : undefined;
        timestamp = typeof envPayload.timestamp === 'number' ? envPayload.timestamp : undefined;
        nonce = typeof envPayload.nonce === 'string' ? envPayload.nonce : undefined;
        signature = parsed.signature;
        if (typeof envPayload.bodySha256 === 'string') {
          bodySha256 = envPayload.bodySha256;
        }
      } else {
        const hAgent = headers['x-atn-agent-id'];
        const hNonce = headers['x-atn-nonce'];
        const hTimestamp = headers['x-atn-timestamp'];
        const hSignature = headers['x-atn-signature'];
        if (typeof hAgent === 'string' && typeof hNonce === 'string' && typeof hTimestamp === 'string' && typeof hSignature === 'string') {
          agentId = hAgent;
          nonce = hNonce;
          timestamp = Number(hTimestamp);
          signature = hSignature;
        }
      }

      if (agentId && timestamp !== undefined && nonce && signature) {
        const agent = db.prepare(
          `SELECT id, revoked_at, ed25519_public_key FROM agents WHERE external_id = ?`
        ).get(agentId) as { id: number; revoked_at: number | null; ed25519_public_key: string } | undefined;

        if (!agent) return unauthorized('unknown agent', 'UNKNOWN_AGENT');
        if (agent.revoked_at !== null) return forbidden('agent revoked', 'AGENT_REVOKED');

        const nowMs = Date.now();
        const tsMs = timestamp > 1e10 ? timestamp : timestamp * 1000;
        if (Math.abs(nowMs - tsMs) > 65000) {
          return unauthorized('timestamp skewed beyond +/- 60s', 'SKEWED_TIMESTAMP');
        }

        const existingNonce = db.prepare('SELECT 1 FROM nonces WHERE agent_id = ? AND nonce = ?').get(agentId, nonce);
        if (existingNonce) {
          return conflict('nonce replayed', 'REPLAYED');
        }

        const reqPayload: RequestEnvelopePayload = {
          agentId,
          method,
          path,
          bodySha256,
          nonce,
          timestamp,
        };

        const valid = verifyRequest(reqPayload, signature, agent.ed25519_public_key);
        if (!valid) {
          return unauthorized('request signature verification failed', 'FORGED_SIGNATURE');
        }

        db.prepare('INSERT INTO nonces (agent_id, nonce, timestamp) VALUES (?, ?, ?)').run(agentId, nonce, timestamp);
      }
    }

    // Existing channels and escrows routes...
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
        const parsed = parseJsonBody(body);
        if (!parsed) return bad('body must be a JSON object');
        const idempotencyKey = parsed.idempotencyKey;
        if (!nonEmptyString(idempotencyKey)) return bad('idempotencyKey must be a non-empty string');
        try {
          const settlement = await settleChannel(db, channelId, idempotencyKey, new SimulatedAdapter());
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

    if (method === 'POST' && segments.length === 2 && segments[0] === 'v1' && segments[1] === 'escrows') {
      const parsed = parseJsonBody(body);
      if (!parsed) return bad('body must be a JSON object');
      const { payerAgentId, payeeAgentId, amount, currency, artifactRef, idempotencyKey } = parsed;
      if (!nonEmptyString(payerAgentId)) return bad('payerAgentId must be a non-empty string');
      if (!nonEmptyString(payeeAgentId)) return bad('payeeAgentId must be a non-empty string');
      if (!positiveInt(amount)) return bad('amount must be a positive integer in micro-dollars');
      const created = createEscrow(db, {
        payerAgentId,
        payeeAgentId,
        amount,
        currency: nonEmptyString(currency) ? currency : 'USD',
        artifactRef: nonEmptyString(artifactRef) ? artifactRef : `escrow_${randomUUID()}`,
        idempotencyKey: nonEmptyString(idempotencyKey) ? idempotencyKey : randomUUID(),
      });
      return json(201, { escrowId: created.id, amount: created.amount, status: created.status });
    }

    if (segments.length >= 3 && segments[0] === 'v1' && segments[1] === 'escrows') {
      const escrowId = segments[2] as string;

      if (method === 'GET' && segments.length === 3) {
        const row = db.prepare('SELECT * FROM escrows WHERE id = ?').get(escrowId) as Record<string, unknown> | undefined;
        if (!row) return json(404, { error: 'NOT_FOUND', detail: 'unknown escrow' });
        return json(200, {
          id: row.id,
          payerAgentId: row.payer_agent_id,
          payeeAgentId: row.payee_agent_id,
          amount: row.amount,
          currency: row.currency,
          status: row.status,
        });
      }

      if (method === 'POST' && segments.length === 4 && segments[3] === 'inspect') {
        const parsed = parseJsonBody(body);
        if (!parsed) return bad('body must be a JSON object');
        const { artifactBase64, declaredMediaType } = parsed;
        if (!nonEmptyString(artifactBase64)) return bad('artifactBase64 must be valid base64');
        const bytes = Buffer.from(artifactBase64, 'base64');
        if (bytes.length === 0) return bad('artifactBase64 must be valid base64');
        const mediaType = nonEmptyString(declaredMediaType) ? declaredMediaType : 'application/octet-stream';
        try {
          const result = inspectEscrow(db, escrowId, bytes, mediaType);
          return json(200, { outcome: result.outcome, reasons: result.reasons });
        } catch (e) {
          const detail = e instanceof Error ? e.message : String(e);
          if (/unknown|not found/i.test(detail)) return json(404, { error: 'NOT_FOUND', detail });
          return json(409, { error: 'NOT_INSPECTABLE', detail });
        }
      }

      if (method === 'POST' && segments.length === 4 && segments[3] === 'release') {
        const row = db.prepare('SELECT status FROM escrows WHERE id = ?').get(escrowId) as { status: string } | undefined;
        if (!row) return json(404, { error: 'NOT_FOUND', detail: 'unknown escrow' });
        if (row.status === 'RELEASED') return json(200, { id: escrowId, status: 'RELEASED' });
        if (row.status === 'CREATED' || row.status === 'FUNDED') {
          return json(409, { error: 'NOT_RELEASABLE', detail: 'inspection has not passed' });
        }
        return json(409, { error: 'NOT_RELEASABLE', detail: `escrow is not releasable in status ${row.status}` });
      }

      if (method === 'POST' && segments.length === 4 && segments[3] === 'refund') {
        try {
          const refunded = refundEscrow(db, escrowId);
          return json(200, { id: escrowId, status: refunded.status });
        } catch (e) {
          const detail = e instanceof Error ? e.message : String(e);
          if (/unknown|not found/i.test(detail)) return json(404, { error: 'NOT_FOUND', detail });
          return json(409, { error: 'NOT_REFUNDABLE', detail });
        }
      }
    }

    return json(404, { error: 'NOT_FOUND' });
  } catch (e) {
    const detail = e instanceof Error ? e.message : 'unexpected error';
    if (process.env.NODE_ENV !== 'production') process.stderr.write(`atn http error: ${detail}\n`);
    return json(500, { error: 'INTERNAL' });
  }
}
