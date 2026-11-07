import type { IncomingHttpHeaders } from 'node:http';
import { randomUUID, createHash } from 'node:crypto';
import type { Database } from '../db/db.js';
import { openChannel, getChannel, acceptVoucher, settleChannel, closeChannel, AlreadySettledError, UnknownChannelError } from '../streaming/channel.js';
import type { VoucherInput } from '../streaming/voucher.js';
import { createPaymentAdapter } from '../payments/adapter.js';
import { createEscrow, fundEscrow, inspectEscrow, refundEscrow } from '../escrow/escrow.js';
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
const bad = (detail: string, error: string = 'BAD_REQUEST'): RouteOutput => json(400, { error, detail });
const unauthorized = (detail: string, error: string = 'UNAUTHORIZED'): RouteOutput => json(401, { error, detail });
const forbidden = (detail: string, error: string = 'FORBIDDEN'): RouteOutput => json(403, { error, detail });
const conflict = (detail: string, error: string = 'REPLAYED'): RouteOutput => json(409, { error, detail });
const unprocessable = (detail: string, error: string = 'UNPROCESSABLE'): RouteOutput => json(422, { error, detail });
const serviceUnavailable = (detail: string, error: string = 'SERVICE_UNAVAILABLE'): RouteOutput => json(503, { error, detail });

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
  if (!adminToken) return false;
  const auth = headers['authorization'];
  const xToken = headers['x-atn-admin-token'] ?? headers['x-admin-token'];
  const token = typeof auth === 'string' && auth.startsWith('Bearer ') ? auth.slice(7) : (typeof xToken === 'string' ? xToken : undefined);
  return token === adminToken;
}

/** Returns a denial detail when the payee's trust score is below the delegation's minimum, else null. */
function counterpartyTrustDenial(db: Database, vaultId: string, payeeAgentId: string): string | null {
  const vault = getVault(db, vaultId);
  if (!vault) return null;
  const row = db.prepare('SELECT min_counterparty_trust AS minimum FROM delegations WHERE id = ?').get(vault.delegation_id) as { minimum: number | null } | undefined;
  if (row === undefined || row.minimum === null) return null;
  const trust = db.prepare('SELECT score FROM merchant_trust WHERE agent_id = ?').get(payeeAgentId) as { score: number } | undefined;
  const score = trust === undefined ? 500 : trust.score;
  return score < row.minimum ? 'counterparty trust ' + String(score) + ' is below the delegation minimum ' + String(row.minimum) : null;
}

export async function handleRequest(input: RouteInput): Promise<RouteOutput> {
  const { method, path, headers, body, db } = input;
  const segments = path.split('?')[0]?.split('/').filter((s) => s.length > 0) ?? [];
  const isMutating = ['POST', 'PUT', 'DELETE', 'PATCH'].includes(method);
  const isAdminRoute = segments.length === 2 && segments[0] === 'v1' && (segments[1] === 'principals' || segments[1] === 'agents');
  const isProtectedGet = method === 'GET' && segments.length === 3 && segments[0] === 'v1' && (segments[1] === 'escrows' || segments[1] === 'channels' || segments[1] === 'vaults');
  let verifiedActorId: string | null = null;

  if (method === 'GET' && segments.length === 1 && segments[0] === 'health') {
    return json(200, { ok: true, mode: process.env.SETTLEMENT_MODE || 'SIMULATED' });
  }

  try {
    // 3. Admin token fails CLOSED
    if (isAdminRoute && method === 'POST') {
      if (!process.env.ATN_ADMIN_TOKEN) {
        return serviceUnavailable('ATN_ADMIN_TOKEN is unset');
      }
      if (!verifyAdminToken(headers)) {
        return unauthorized('Invalid or missing ATN_ADMIN_TOKEN');
      }
    }

    // 1. Mandatory Signed Request Envelope on every mutating route (except admin registration routes)
    if ((isMutating || isProtectedGet) && !isAdminRoute) {
      const hAgent = headers['x-atn-agent-id'];
      const hNonce = headers['x-atn-nonce'];
      const hTimestamp = headers['x-atn-timestamp'];
      const hSignature = headers['x-atn-signature'];

      if (!nonEmptyString(hAgent) || !nonEmptyString(hNonce) || !nonEmptyString(hTimestamp) || !nonEmptyString(hSignature)) {
        return unauthorized('Missing request envelope headers', 'MISSING_ENVELOPE');
      }

      const agentId = hAgent;
      const nonce = hNonce;
      const timestamp = Number(hTimestamp);
      const signature = hSignature;

      if (!Number.isFinite(timestamp)) {
        return unauthorized('Invalid timestamp', 'SKEWED_TIMESTAMP');
      }

      const nowMs = Date.now();
      const tsMs = timestamp > 1e11 ? timestamp : timestamp * 1000;
      if (Math.abs(nowMs - tsMs) > 60000) {
        return unauthorized('Timestamp skewed beyond +/- 60s', 'SKEWED_TIMESTAMP');
      }

      // Check-and-insert nonce in one transaction, pruning nonces older than 5 minutes
      const nonceValid = db.transaction(() => {
        db.prepare('DELETE FROM nonces WHERE timestamp < ?').run(nowMs - 300000);
        const existing = db.prepare('SELECT 1 FROM nonces WHERE agent_id = ? AND nonce = ?').get(agentId, nonce);
        if (existing) return false;
        db.prepare('INSERT INTO nonces (agent_id, nonce, timestamp) VALUES (?, ?, ?)').run(agentId, nonce, nowMs);
        return true;
      })();

      if (!nonceValid) {
        return conflict('nonce replayed', 'REPLAYED');
      }

      const bodySha256 = createHash('sha256').update(body).digest('hex');

      const reqPayload: RequestEnvelopePayload = {
        agentId,
        method,
        path,
        bodySha256,
        nonce,
        timestamp,
      };

      // Determine if route requires principal signature or agent signature
      const isGetVault = method === 'GET' && segments.length === 3 && segments[0] === 'v1' && segments[1] === 'vaults';
      // A principal reads its vault with its own key; an agent signer keeps the agent key path (and is refused as a non-party).
      const getVaultSignedByPrincipal = isGetVault && db.prepare('SELECT 1 AS found FROM principals WHERE external_id = ?').get(agentId) !== undefined;
      const isPrincipalSignedRoute =
        (segments.length === 2 && segments[0] === 'v1' && segments[1] === 'vaults') ||
        (segments.length === 4 && segments[0] === 'v1' && segments[1] === 'delegations' && segments[3] === 'revoke') ||
        (segments.length === 4 && segments[0] === 'v1' && segments[1] === 'vaults' && segments[3] === 'revoke') ||
        getVaultSignedByPrincipal;

      let publicKey = '';
      let actorId = agentId; // For principal routes, this is the principal's external_id
      if (isPrincipalSignedRoute) {
        const principal = db.prepare(
          `SELECT id, ed25519_public_key, external_id FROM principals WHERE external_id = ?`
        ).get(agentId) as { id: number; ed25519_public_key: string; external_id: string } | undefined;

        if (!principal) return unauthorized('unknown principal', 'UNKNOWN_PRINCIPAL');

        publicKey = principal.ed25519_public_key;
        actorId = principal.external_id;
        verifiedActorId = actorId;

        // Authorization checks for principal-signed routes
        if (segments.length === 2 && segments[0] === 'v1' && segments[1] === 'vaults') {
          // POST /v1/vaults - delegation must belong to this principal
          const parsedBody = parseJsonBody(body);
          const delId = parsedBody?.delegationId;
          if (delId === undefined) return bad('delegationId required');
          const delegation = db.prepare(
            `SELECT principal_id FROM delegations WHERE id = ?`
          ).get(Number(delId) || -1) as { principal_id: number } | undefined;
          if (!delegation) return json(404, { error: 'NOT_FOUND', detail: 'delegation not found' });
          if (delegation.principal_id !== principal.id) return forbidden('principal does not own delegation', 'FORBIDDEN');
        } else if (segments.length === 4 && segments[0] === 'v1' && segments[1] === 'delegations' && segments[3] === 'revoke') {
          // POST /v1/delegations/:id/revoke - delegation's principal must equal signer
          const delId = segments[2];
          const delegation = db.prepare(
            `SELECT principal_id FROM delegations WHERE id = ? OR external_id = ?`
          ).get(Number(delId) || -1, delId) as { principal_id: number } | undefined;
          if (!delegation) return json(404, { error: 'NOT_FOUND', detail: 'delegation not found' });
          if (delegation.principal_id !== principal.id) return forbidden('principal does not own delegation', 'FORBIDDEN');
        } else if (segments.length === 4 && segments[0] === 'v1' && segments[1] === 'vaults' && segments[3] === 'revoke') {
          // POST /v1/vaults/:id/revoke - vault's delegation's principal must equal signer
          const vaultId = segments[2];
          const vault = db.prepare(
            `SELECT d.principal_id FROM vaults AS v JOIN delegations AS d ON d.id = v.delegation_id WHERE v.id = ?`
          ).get(vaultId) as { principal_id: number } | undefined;
          if (!vault) return json(404, { error: 'NOT_FOUND', detail: 'vault not found' });
          if (vault.principal_id !== principal.id) return forbidden('principal does not own vault', 'FORBIDDEN');
        }
      } else {
        const agent = db.prepare(
          `SELECT id, revoked_at, ed25519_public_key, external_id FROM agents WHERE external_id = ?`
        ).get(agentId) as { id: number; revoked_at: number | null; ed25519_public_key: string; external_id: string } | undefined;

        if (!agent) return unauthorized('unknown agent', 'UNKNOWN_AGENT');
        if (agent.revoked_at !== null) return forbidden('agent revoked', 'AGENT_REVOKED');
        publicKey = agent.ed25519_public_key;
        actorId = agent.external_id;
        verifiedActorId = actorId;

        // Route-specific actor checks
        const parsedBody = parseJsonBody(body);
        if (parsedBody) {
          // POST /v1/channels - signer must be payerAgentId
          if (segments.length === 2 && segments[0] === 'v1' && segments[1] === 'channels') {
            const bodyPayer = parsedBody.payerAgentId;
            if (typeof bodyPayer === 'string' && bodyPayer !== actorId) {
              return forbidden('channel creation requires payer agent', 'FORBIDDEN');
            }
          }
          // POST /v1/channels/:id/vouchers - signer must be channel's payer agent
          else if (segments.length === 4 && segments[0] === 'v1' && segments[1] === 'channels' && segments[3] === 'vouchers') {
            const channelId = segments[2];
            const channel = db.prepare('SELECT payer_agent_id FROM channels WHERE id = ?').get(channelId) as { payer_agent_id: string } | undefined;
            if (channel && channel.payer_agent_id !== actorId) {
              return forbidden('voucher requires channel payer agent', 'FORBIDDEN');
            }
          }
          // POST /v1/channels/:id/settle - signer must be channel's payee agent
          else if (segments.length === 4 && segments[0] === 'v1' && segments[1] === 'channels' && segments[3] === 'settle') {
            const channelId = segments[2];
            const channel = db.prepare('SELECT payee_agent_id FROM channels WHERE id = ?').get(channelId) as { payee_agent_id: string } | undefined;
            if (channel && channel.payee_agent_id !== actorId) {
              return forbidden('settle requires channel payee agent', 'FORBIDDEN');
            }
          }
          // POST /v1/escrows - signer must be payerAgentId
          else if (segments.length === 2 && segments[0] === 'v1' && segments[1] === 'escrows') {
            const bodyPayer = parsedBody.payerAgentId;
            if (typeof bodyPayer === 'string' && bodyPayer !== actorId) {
              return forbidden('escrow creation requires payer agent', 'FORBIDDEN');
            }
          }
          // POST /v1/escrows/:id/inspect, /release, /refund - signer must be payeeAgentId
          else if (segments.length === 4 && segments[0] === 'v1' && segments[1] === 'escrows' && segments[3] && ['inspect', 'release', 'refund'].includes(segments[3])) {
            const bodyPayee = parsedBody.payeeAgentId;
            if (typeof bodyPayee === 'string' && bodyPayee !== actorId) {
              return forbidden('escrow action requires payee agent', 'FORBIDDEN');
            }
}
        }
        // GET /v1/escrows/:id - signer must be payer or payee
        else if (method === 'GET' && segments.length === 3 && segments[0] === 'v1' && segments[1] === 'escrows') {
          const escrow = db.prepare('SELECT payer_agent_id, payee_agent_id FROM escrows WHERE id = ?').get(segments[2]) as { payer_agent_id: string; payee_agent_id: string } | undefined;
          if (!escrow) return json(404, { error: 'NOT_FOUND', detail: 'unknown escrow' });
          if (verifiedActorId !== escrow.payer_agent_id && verifiedActorId !== escrow.payee_agent_id) {
            return forbidden('escrow access requires payer or payee agent', 'FORBIDDEN');
          }
        }
        // GET /v1/channels/:id - signer must be payer or payee
        else if (method === 'GET' && segments.length === 3 && segments[0] === 'v1' && segments[1] === 'channels') {
          const channel = db.prepare('SELECT payer_agent_id, payee_agent_id FROM channels WHERE id = ?').get(segments[2]) as { payer_agent_id: string; payee_agent_id: string } | undefined;
          if (!channel) return json(404, { error: 'NOT_FOUND', detail: 'unknown channel' });
          if (verifiedActorId !== channel.payer_agent_id && verifiedActorId !== channel.payee_agent_id) {
            return forbidden('channel access requires payer or payee agent', 'FORBIDDEN');
          }
        }
        // GET /v1/vaults/:id - signer must be vault's delegation principal
        else if (method === 'GET' && segments.length === 3 && segments[0] === 'v1' && segments[1] === 'vaults') {
          const vault = db.prepare('SELECT d.principal_id FROM vaults AS v JOIN delegations AS d ON d.id = v.delegation_id WHERE v.id = ?').get(segments[2]) as { principal_id: number } | undefined;
          if (!vault) return json(404, { error: 'NOT_FOUND', detail: 'unknown vault' });
          const principal = db.prepare('SELECT external_id FROM principals WHERE id = ?').get(vault.principal_id) as { external_id: string } | undefined;
          if (!principal || verifiedActorId !== principal.external_id) {
            return forbidden('vault access requires delegation principal', 'FORBIDDEN');
          }
}
      }

      const valid = verifyRequest(reqPayload, signature, publicKey);
      if (!valid) {
        return unauthorized('request signature verification failed', 'FORGED_SIGNATURE');
      }
    }

    // Admin Registration: POST /v1/principals
    if (method === 'POST' && segments.length === 2 && segments[0] === 'v1' && segments[1] === 'principals') {
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
      const principalIdStr = p.principalId;
      const ceiling = p.ceiling;
      const scope = p.scope;
      const counterparties = p.counterparties ?? p.counterpartyAllowlist;
      const notBefore = p.notBefore;
      const expiresAt = p.expiresAt;
      const nonce = p.nonce;
      const version = p.version;
      const minTrustRaw = p.minCounterpartyTrust;
      if (minTrustRaw !== undefined && minTrustRaw !== null && (typeof minTrustRaw !== 'number' || !Number.isInteger(minTrustRaw) || minTrustRaw < 0 || minTrustRaw > 1000)) {
        return bad('minCounterpartyTrust must be an integer between 0 and 1000');
      }
      const minTrust: number | null = typeof minTrustRaw === 'number' ? minTrustRaw : null;

      if (version !== 1 || !nonEmptyString(agentId) || !nonEmptyString(principalIdStr) || typeof ceiling !== 'number' || !Array.isArray(scope) || !Array.isArray(counterparties) || !nonEmptyString(nonce)) {
        return bad('invalid delegation payload fields or version');
      }
      for (const s of scope) {
        if (!nonEmptyString(s)) return bad('scope items must be non-empty strings');
      }
      for (const c of counterparties) {
        if (!nonEmptyString(c)) return bad('counterparty items must be non-empty strings');
      }

      const principal = db.prepare('SELECT id, ed25519_public_key FROM principals WHERE external_id = ?').get(principalIdStr) as { id: number; ed25519_public_key: string } | undefined;
      if (!principal) return unprocessable('principal not found', 'UNKNOWN_PRINCIPAL');

      const agent = db.prepare('SELECT id, revoked_at FROM agents WHERE external_id = ? AND principal_id = ?').get(agentId, principal.id) as { id: number; revoked_at: number | null } | undefined;
      if (!agent) return unprocessable('agent not found for principal', 'UNKNOWN_AGENT');
      if (agent.revoked_at !== null) return unprocessable('agent revoked', 'AGENT_REVOKED');

      const delegationPayload: DelegationPayload = {
        version: 1,
        delegationId: String(p.delegationId ?? ''),
        principalId: principalIdStr,
        agentId,
        ceiling,
        scope: scope as string[],
        counterparties: counterparties as string[],
        notBefore: typeof notBefore === 'string' ? notBefore : null,
        expiresAt: typeof expiresAt === 'string' ? expiresAt : null,
        ...(minTrust !== null ? { minCounterpartyTrust: minTrust } : {}),
        nonce,
      };

      const valid = verifyDelegation(delegationPayload, signature, principal.ed25519_public_key);
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

      const existingNonce = db.prepare('SELECT 1 FROM delegations WHERE nonce = ?').get(nonce);
      if (existingNonce) {
        return conflict('nonce already used', 'REPLAYED');
      }

      const delegationExternalId = `del_${randomUUID()}`;
      const insert = db.prepare(
        `INSERT INTO delegations (
           external_id, principal_id, agent_id, budget_ceiling, currency, status,
           expires_at, scope_json, counterparty_allowlist_json, nonce, not_before, signature, min_counterparty_trust
         ) VALUES (?, ?, ?, ?, 'USD', 'ACTIVE', ?, ?, ?, ?, ?, ?, ?)`
      ).run(
        delegationExternalId,
        principal.id,
        agent.id,
        ceiling,
        delegationPayload.expiresAt ?? null,
        JSON.stringify(scope),
        JSON.stringify(counterparties),
        nonce,
        delegationPayload.notBefore ?? null,
        signature,
        minTrust,
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
      // fundingRef must be a 64-hex string (sha256 commitment)
      if (!/^[0-9a-f]{64}$/i.test(fundingRef)) {
        return json(400, { error: 'INVALID_FUNDING_COMMITMENT', detail: 'fundingRef must be a 64-hex string' });
      }
      try {
        const vaultOpts: { delegationId: number | string; funded: number; fundingRef: string; ttlSeconds?: number } = {
          delegationId: delegationId as number | string,
          funded,
          fundingRef,
        };
        if (typeof ttlSeconds === 'number') {
          vaultOpts.ttlSeconds = ttlSeconds;
        }
        const vault = createVault(db, vaultOpts);
        return json(201, vault);
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        if (msg.includes('DELEGATION_MISSING') || msg.includes('not found')) return json(404, { error: 'NOT_FOUND', detail: msg });
        return unprocessable(msg, 'UNPROCESSABLE');
      }
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

    // Existing channels and escrows routes...
    if (method === 'POST' && segments.length === 2 && segments[0] === 'v1' && segments[1] === 'channels') {
      const parsed = parseJsonBody(body);
      if (!parsed) return bad('body must be a JSON object');
      const { payerAgentId, payeeAgentId, vaultId, ttlSeconds, ceiling } = parsed;
      if (!nonEmptyString(payerAgentId)) return bad('payerAgentId must be a non-empty string');
      if (!nonEmptyString(payeeAgentId)) return bad('payeeAgentId must be a non-empty string');
      if (!nonEmptyString(vaultId)) return bad('vaultId must be a non-empty string');
      if (!positiveInt(ttlSeconds)) return bad('ttlSeconds must be a positive integer');
      
      const vault = getVault(db, vaultId);
      if (!vault) return json(404, { error: 'NOT_FOUND', detail: 'vault not found' });
      const untrustedChannel = counterpartyTrustDenial(db, vaultId, payeeAgentId);
      if (untrustedChannel !== null) return json(422, { error: 'COUNTERPARTY_UNTRUSTED', detail: untrustedChannel });
      if (vault.state !== 'OPEN') return json(422, { error: 'VAULT_CLOSED', detail: 'vault is not open' });
      const vaultExpMs = Date.parse(vault.expires_at);
      if (Number.isFinite(vaultExpMs) && vaultExpMs <= Date.now()) return json(422, { error: 'VAULT_EXPIRED', detail: 'vault has expired' });
      
      // Determine channel ceiling: use provided ceiling or default to vault available balance
      const vaultAvailable = vault.funded - vault.reserved - vault.committed;
      let channelCeiling: number;
      if (ceiling !== undefined) {
        if (typeof ceiling !== 'number' || !Number.isSafeInteger(ceiling) || ceiling <= 0) {
          return json(422, { error: 'INVALID_CEILING', detail: 'ceiling must be a positive safe integer' });
        }
        if (ceiling > vaultAvailable) {
          return json(422, { error: 'CEILING_EXCEEDS_VAULT', detail: `ceiling exceeds vault available balance of ${vaultAvailable}` });
        }
        channelCeiling = ceiling;
      } else {
        channelCeiling = vaultAvailable;
      }
      
      try {
        const channel = openChannel(db, { payerAgentId, payeeAgentId, vaultId, ceiling: channelCeiling, ttlSeconds });
        return json(201, { channelId: channel.id, ceiling: channel.ceiling, expiresAt: channel.expires_at, vaultId: channel.vault_id });
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        if (process.env.NODE_ENV === 'test') console.error('[DEBUG] openChannel error:', msg);
        if (msg.includes('Vault') || msg.includes('vault')) return json(404, { error: 'NOT_FOUND', detail: msg });
        if (msg.includes('Payee') || msg.includes('counterpart')) return json(422, { error: 'COUNTERPARTY_DENIED', detail: msg });
        if (msg.includes('revoked') || msg.includes('Revoked')) return json(422, { error: 'AGENT_REVOKED', detail: msg });
        if (msg.includes('expired') || msg.includes('Expired')) return json(422, { error: 'EXPIRED', detail: msg });
        if (process.env.NODE_ENV === 'test') console.error('[DEBUG] Returning UNPROCESSABLE for:', msg);
        return unprocessable(msg, 'UNPROCESSABLE');
      }
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
        const result = acceptVoucher(db, channelId, voucher, 0); // delegationBudget no longer used
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
          const settlement = await settleChannel(db, channelId, idempotencyKey, createPaymentAdapter());
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

      // POST /v1/channels/:id/close - signed by payer or payee
      if (method === 'POST' && segments.length === 4 && segments[3] === 'close') {
        try {
          const closed = closeChannel(db, channelId);
          return json(200, { channelId: closed.channelId, amount: closed.amount, status: 'CLOSED' });
        } catch (e) {
          const detail = e instanceof Error ? e.message : String(e);
          if (e instanceof UnknownChannelError) return json(404, { error: 'NOT_FOUND', detail });
          if (e instanceof AlreadySettledError) return json(409, { error: 'ALREADY_SETTLED', detail });
          return unprocessable(detail, 'UNPROCESSABLE');
        }
      }
    }

    if (method === 'POST' && segments.length === 2 && segments[0] === 'v1' && segments[1] === 'escrows') {
      const parsed = parseJsonBody(body);
      if (!parsed) return bad('body must be a JSON object');
      const { payerAgentId, payeeAgentId, amount, currency, vaultId, deadlineAt, spec, artifactRef, idempotencyKey } = parsed;
      if (!nonEmptyString(payerAgentId)) return bad('payerAgentId must be a non-empty string');
      if (!nonEmptyString(payeeAgentId)) return bad('payeeAgentId must be a non-empty string');
      if (!positiveInt(amount)) return bad('amount must be a positive integer in micro-dollars');
      if (!nonEmptyString(vaultId)) return bad('vaultId must be a non-empty string');
      if (typeof deadlineAt !== 'number') return bad('deadlineAt must be a timestamp number');
      const untrustedEscrow = counterpartyTrustDenial(db, vaultId, payeeAgentId);
      if (untrustedEscrow !== null) return json(422, { error: 'COUNTERPARTY_UNTRUSTED', detail: untrustedEscrow });
      try {
        const created = createEscrow(db, {
          payerAgentId,
          payeeAgentId,
          amount,
          currency: nonEmptyString(currency) ? currency : 'USD',
          vaultId,
          deadlineAt,
          spec: typeof spec === 'string' ? spec : null,
          artifactRef: nonEmptyString(artifactRef) ? artifactRef : `escrow_${randomUUID()}`,
          idempotencyKey: nonEmptyString(idempotencyKey) ? idempotencyKey : randomUUID(),
        });
        return json(201, { escrowId: created.id, amount: created.amount, status: created.status });
      } catch (e) {
        const detail = e instanceof Error ? e.message : String(e);
        return json(422, { error: 'ESCROW_CREATE_FAILED', detail });
      }
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

      if (method === 'POST' && segments.length === 4 && segments[3] === 'fund') {
        if (!verifiedActorId) return unauthorized('Missing actor identity');
        const escrow = db.prepare('SELECT payer_agent_id FROM escrows WHERE id = ?').get(escrowId) as { payer_agent_id: string } | undefined;
        if (!escrow) return json(404, { error: 'NOT_FOUND', detail: 'unknown escrow' });
        if (verifiedActorId !== escrow.payer_agent_id) {
          return forbidden('escrow funding requires payer agent', 'FORBIDDEN');
        }
        try {
          const funded = await fundEscrow(db, escrowId, createPaymentAdapter());
          return json(200, { id: funded.id, status: funded.status });
        } catch (e) {
          const detail = e instanceof Error ? e.message : String(e);
          if (/unknown|not found/i.test(detail)) return json(404, { error: 'NOT_FOUND', detail });
          return json(409, { error: 'FUNDING_FAILED', detail });
        }
      }

      if (method === 'POST' && segments.length === 4 && segments[3] === 'inspect') {
        if (!verifiedActorId) return unauthorized('Missing actor identity');
        const escrow = db.prepare('SELECT payee_agent_id FROM escrows WHERE id = ?').get(escrowId) as { payee_agent_id: string } | undefined;
        if (!escrow) return json(404, { error: 'NOT_FOUND', detail: 'unknown escrow' });
        if (verifiedActorId !== escrow.payee_agent_id) {
          return forbidden('escrow inspection requires payee agent', 'FORBIDDEN');
        }
        const parsed = parseJsonBody(body);
        if (!parsed) return bad('body must be a JSON object');
        const { artifactBase64, declaredMediaType } = parsed;
        if (!nonEmptyString(artifactBase64)) return bad('artifactBase64 must be valid base64');
        const bytes = Buffer.from(artifactBase64, 'base64');
        if (bytes.length === 0) return bad('artifactBase64 must be valid base64');
        const mediaType = nonEmptyString(declaredMediaType) ? declaredMediaType : 'application/octet-stream';
        try {
          const result = await inspectEscrow(db, escrowId, bytes, mediaType, createPaymentAdapter());
          const updated = db.prepare('SELECT status FROM escrows WHERE id = ?').get(escrowId) as { status: string };
          return json(200, { outcome: result.outcome, reasons: result.reasons, status: updated.status });
        } catch (e) {
          const detail = e instanceof Error ? e.message : String(e);
          if (/unknown|not found/i.test(detail)) return json(404, { error: 'NOT_FOUND', detail });
          return json(409, { error: 'NOT_INSPECTABLE', detail });
        }
      }

      // Remove the release endpoint

      if (method === 'POST' && segments.length === 4 && segments[3] === 'refund') {
        if (!verifiedActorId) return unauthorized('Missing actor identity');
        const escrow = db.prepare('SELECT payee_agent_id FROM escrows WHERE id = ?').get(escrowId) as { payee_agent_id: string } | undefined;
        if (!escrow) return json(404, { error: 'NOT_FOUND', detail: 'unknown escrow' });
        if (verifiedActorId !== escrow.payee_agent_id) {
          return forbidden('escrow refund requires payee agent', 'FORBIDDEN');
        }
        try {
          const refunded = await refundEscrow(db, escrowId, createPaymentAdapter());
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
