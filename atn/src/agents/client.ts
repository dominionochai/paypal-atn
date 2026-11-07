import { createHash, randomBytes } from 'node:crypto';
import { signDelegation, signRequest } from '../trust/crypto.js';
import type { DelegationPayload, RequestEnvelopePayload } from '../trust/crypto.js';
import { generateKeypair, signVoucher } from '../streaming/signing.js';

export interface Actor {
  id: string;
  publicKey: string;
  privateKey: string;
}

/** Private keys live only inside Actor objects held by this client. They are never placed in prompts or tool results. */
export function newActor(id: string): Actor {
  const pair = generateKeypair();
  return { id, publicKey: pair.publicKey, privateKey: pair.privateKey };
}

export interface ApiResult {
  status: number;
  body: Record<string, unknown>;
}

export interface VaultSnapshot {
  funded: number;
  reserved: number;
  committed: number;
  available: number;
  state: string;
}

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

export class AtnClient {
  constructor(
    private readonly base: string,
    private readonly adminToken: string,
  ) {}

  /** Sends a request; when an actor is given the signed request envelope headers are attached. */
  async send(method: string, path: string, body: unknown, actor?: Actor): Promise<ApiResult> {
    const raw = body === undefined ? '' : JSON.stringify(body);
    const headers: Record<string, string> = {};
    if (body !== undefined) headers['content-type'] = 'application/json';
    if (actor !== undefined) {
      const payload: RequestEnvelopePayload = {
        agentId: actor.id,
        method,
        path,
        bodySha256: createHash('sha256').update(raw).digest('hex'),
        nonce: randomBytes(8).toString('hex'),
        timestamp: Date.now(),
      };
      headers['x-atn-agent-id'] = payload.agentId;
      headers['x-atn-nonce'] = payload.nonce;
      headers['x-atn-timestamp'] = String(payload.timestamp);
      headers['x-atn-signature'] = signRequest(payload, actor.privateKey);
    }
    return this.fetchJson(method, path, raw, headers);
  }

  private async fetchJson(method: string, path: string, raw: string, headers: Record<string, string>): Promise<ApiResult> {
    const init: RequestInit = { method, headers };
    if (raw.length > 0) init.body = raw;
    const response = await fetch(this.base + path, init);
    const text = await response.text();
    let parsed: unknown = {};
    try {
      parsed = JSON.parse(text);
    } catch {
      parsed = { raw: text };
    }
    return { status: response.status, body: asRecord(parsed) };
  }

  private admin(path: string, body: unknown): Promise<ApiResult> {
    return this.fetchJson('POST', path, JSON.stringify(body), { 'content-type': 'application/json', authorization: 'Bearer ' + this.adminToken });
  }

  registerPrincipal(actor: Actor, name: string): Promise<ApiResult> {
    return this.admin('/v1/principals', { externalId: actor.id, name, publicKey: actor.publicKey });
  }

  registerAgent(actor: Actor, principalId: string, name: string, budgetMicro: number): Promise<ApiResult> {
    return this.admin('/v1/agents', { externalId: actor.id, principalExternalId: principalId, name, publicKey: actor.publicKey, budgetMicro });
  }

  /** Principal signs a delegation token; the server verifies it against the principal's registered key. */
  createDelegation(
    principal: Actor,
    submitter: Actor,
    agentId: string,
    ceilingMicro: number,
    counterparties: string[],
    options: { expiresInMs?: number; minCounterpartyTrust?: number } = {},
  ): Promise<ApiResult> {
    const payload: DelegationPayload = {
      version: 1,
      delegationId: 'del-' + randomBytes(4).toString('hex'),
      principalId: principal.id,
      agentId,
      ceiling: ceilingMicro,
      scope: ['invoice.pay'],
      counterparties,
      notBefore: null,
      expiresAt: new Date(Date.now() + (options.expiresInMs ?? 30 * 60_000)).toISOString(),
      ...(options.minCounterpartyTrust !== undefined ? { minCounterpartyTrust: options.minCounterpartyTrust } : {}),
      nonce: 'n-' + randomBytes(8).toString('hex'),
    };
    const signature = signDelegation(payload, principal.privateKey);
    // The delegated agent presents the principal-signed token; the server verifies it against the principal's registered key.
    return this.send('POST', '/v1/delegations', { payload, signature }, submitter);
  }

  openVault(principal: Actor, delegationId: number, fundedMicro: number): Promise<ApiResult> {
    const fundingRef = createHash('sha256').update('funding-secret-' + randomBytes(16).toString('hex')).digest('hex');
    return this.send('POST', '/v1/vaults', { delegationId, funded: fundedMicro, fundingRef }, principal);
  }

  async vaultSnapshot(principal: Actor, vaultId: string): Promise<VaultSnapshot> {
    const result = await this.send('GET', '/v1/vaults/' + encodeURIComponent(vaultId), undefined, principal);
    const funded = Number(result.body.funded);
    const reserved = Number(result.body.reserved);
    const committed = Number(result.body.committed);
    if (result.status !== 200 || !Number.isFinite(funded) || !Number.isFinite(reserved) || !Number.isFinite(committed)) {
      throw new Error('Could not read vault ' + vaultId + ': HTTP ' + String(result.status) + ' ' + JSON.stringify(result.body));
    }
    return { funded, reserved, committed, available: funded - reserved - committed, state: String(result.body.state) };
  }

  revokeDelegation(principal: Actor, delegationId: number): Promise<ApiResult> {
    return this.send('POST', '/v1/delegations/' + String(delegationId) + '/revoke', {}, principal);
  }

  openChannel(payer: Actor, payeeId: string, vaultId: string, ceilingMicro: number): Promise<ApiResult> {
    return this.send('POST', '/v1/channels', { payerAgentId: payer.id, payeeAgentId: payeeId, vaultId, ceiling: ceilingMicro, ttlSeconds: 600 }, payer);
  }

  sendVoucher(payer: Actor, channelId: string, payeeId: string, cumulativeAmount: number, nonce: number): Promise<ApiResult> {
    const payload = { channelId, payeeAgentId: payeeId, cumulativeAmount, nonce, issuedAt: Date.now() };
    return this.send('POST', '/v1/channels/' + encodeURIComponent(channelId) + '/vouchers', { payload, signature: signVoucher(payload, payer.privateKey) }, payer);
  }

  settleChannel(payee: Actor, channelId: string, idempotencyKey: string): Promise<ApiResult> {
    return this.send('POST', '/v1/channels/' + encodeURIComponent(channelId) + '/settle', { idempotencyKey }, payee);
  }

  createEscrow(payer: Actor, payeeId: string, vaultId: string, amountMicro: number, idempotencyKey: string): Promise<ApiResult> {
    return this.send(
      'POST',
      '/v1/escrows',
      { payerAgentId: payer.id, payeeAgentId: payeeId, amount: amountMicro, currency: 'USD', vaultId, deadlineAt: Date.now() + 10 * 60_000, idempotencyKey },
      payer,
    );
  }

  fundEscrow(payer: Actor, escrowId: string): Promise<ApiResult> {
    return this.send('POST', '/v1/escrows/' + encodeURIComponent(escrowId) + '/fund', {}, payer);
  }

  inspectEscrow(payee: Actor, escrowId: string, artifact: Buffer): Promise<ApiResult> {
    return this.send(
      'POST',
      '/v1/escrows/' + encodeURIComponent(escrowId) + '/inspect',
      { artifactBase64: artifact.toString('base64'), declaredMediaType: 'application/octet-stream' },
      payee,
    );
  }
}
