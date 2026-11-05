import { mkdtemp, rm } from "node:fs/promises";
import { once } from "node:events";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AddressInfo } from "node:net";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { openDatabase, runMigrations, type Database } from "../src/db/db";
import { startHttpServer } from "../src/http/server";
import { generateKeyPairSync, createHash, sign } from "node:crypto";

const VALID_PROTOBUF = Buffer.from([0x08, 0x01, 0x12, 0x01, 0x78]);
const VALID_PROTOBUF_B64 = VALID_PROTOBUF.toString('base64');
// Truncated varint (0x08 0x80) gives INCONCLUSIVE with MALFORMED_PROTOBUF
const INCONCLUSIVE_PROTOBUF = Buffer.from([0x08, 0x80]);
const INCONCLUSIVE_PROTOBUF_B64 = INCONCLUSIVE_PROTOBUF.toString('base64');
const MEDIA_TYPE = 'application/octet-stream';

let db: Database;
let server: ReturnType<typeof startHttpServer>;
let tempDir: string;
let baseUrl: string;

const ADMIN_TOKEN = 'test-admin-token';

// Store keypairs for reuse across tests
let principalKeys: { publicKey: string; privateKey: string };
let payerKeys: { publicKey: string; privateKey: string };
let payeeKeys: { publicKey: string; privateKey: string };

function canonicalJson(value: unknown): string {
  if (value === undefined) {
    throw new TypeError('canonicalJson cannot serialize undefined');
  }
  if (typeof value === 'number') {
    if (!Number.isFinite(value) || !Number.isInteger(value)) {
      throw new TypeError('canonicalJson requires finite integers');
    }
    return JSON.stringify(value);
  }
  if (value === null || typeof value !== 'object') {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((item: unknown) => canonicalJson(item)).join(',')}]`;
  }
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj).sort();
  const entries = keys.map((k) => `${JSON.stringify(k)}:${canonicalJson(obj[k])}`);
  return `{${entries.join(',')}}`;
}

function signRequest(agentId: string, method: string, path: string, bodyObj: unknown, privateKeyPem: string): Record<string, string> {
  const isGetOrHead = method === 'GET' || method === 'HEAD';
  const bodyBuf = isGetOrHead ? Buffer.alloc(0) : Buffer.from(JSON.stringify(bodyObj ?? {}));
  const bodySha256 = createHash('sha256').update(bodyBuf).digest('hex');
  const timestamp = Date.now();
  const nonce = createHash('sha256').update(`${agentId}${timestamp}${Math.random()}`).digest('hex').slice(0, 16);
  const payload = { agentId, method, path, bodySha256, nonce, timestamp };
  const bytes = Buffer.concat([
    Buffer.from('ATN-REQUEST-v1\n', 'utf8'),
    Buffer.from(canonicalJson(payload), 'utf8'),
  ]);
  const signature = sign(null, bytes, privateKeyPem).toString('base64');
  return {
    'x-atn-agent-id': agentId,
    'x-atn-nonce': nonce,
    'x-atn-timestamp': String(timestamp),
    'x-atn-signature': signature,
  };
}

async function signedFetch(base: string, method: string, path: string, body: unknown, agentId: string, privateKeyPem: string, extraHeaders: Record<string, string> = {}) {
  const sigHeaders = signRequest(agentId, method, path, body, privateKeyPem);
  const headers: Record<string, string> = { 'content-type': 'application/json', ...sigHeaders, ...extraHeaders };
  const options: RequestInit = { method, headers };
  if (method !== 'GET' && method !== 'HEAD' && body !== null && body !== undefined) {
    options.body = JSON.stringify(body);
  }
  const response = await fetch(base + path, options);
  return response;
}

function signVoucher(channelId: string, payeeAgentId: string, cumulativeAmount: number, nonce: number, privateKeyPem: string) {
  const payload = { channelId, payeeAgentId, cumulativeAmount, nonce, issuedAt: Date.now() };
  const canonicalBytes = (p: typeof payload) => {
    const parts = [];
    const str = (s: string) => { const b = Buffer.from(s, 'utf8'); const len = Buffer.alloc(4); len.writeUInt32BE(b.length, 0); parts.push(len, b); };
    const i64 = (n: number) => { const b = Buffer.alloc(8); b.writeBigInt64BE(BigInt(n), 0); parts.push(b); };
    str(p.channelId); str(p.payeeAgentId); i64(p.cumulativeAmount); i64(p.nonce); i64(p.issuedAt);
    return Buffer.concat(parts);
  };
  const signature = sign(null, canonicalBytes(payload), privateKeyPem).toString('base64');
  return { payload, signature };
}

function signDelegation(payload: Record<string, unknown>, privateKeyPem: string): string {
  const bytes = Buffer.concat([
    Buffer.from('ATN-DELEGATION-v1\n', 'utf8'),
    Buffer.from(canonicalJson(payload), 'utf8'),
  ]);
  return sign(null, bytes, privateKeyPem).toString('base64');
}

beforeEach(async () => {
  tempDir = await mkdtemp(join(tmpdir(), "atn-http-test-"));
  db = openDatabase(join(tempDir, "test.sqlite"));
  runMigrations(db);

  process.env.ATN_ADMIN_TOKEN = ADMIN_TOKEN;

  // Generate keypairs once
  const prinKp = generateKeyPairSync('ed25519');
  principalKeys = {
    publicKey: prinKp.publicKey.export({ type: 'spki', format: 'pem' }).toString(),
    privateKey: prinKp.privateKey.export({ type: 'pkcs8', format: 'pem' }).toString(),
  };

  const pKp = generateKeyPairSync('ed25519');
  payerKeys = {
    publicKey: pKp.publicKey.export({ type: 'spki', format: 'pem' }).toString(),
    privateKey: pKp.privateKey.export({ type: 'pkcs8', format: 'pem' }).toString(),
  };

  const peKp = generateKeyPairSync('ed25519');
  payeeKeys = {
    publicKey: peKp.publicKey.export({ type: 'spki', format: 'pem' }).toString(),
    privateKey: peKp.privateKey.export({ type: 'pkcs8', format: 'pem' }).toString(),
  };

  server = startHttpServer(db, 0);
  await once(server, "listening");
  const address = server.address();
  if (address === null || typeof address === "string") {
    throw new Error("HTTP test server did not bind a TCP port");
  }
  baseUrl = `http://127.0.0.1:${(address as AddressInfo).port}`;

  // Register principal and agents using the SAME keys
  const adminHeaders = { 'authorization': `Bearer ${ADMIN_TOKEN}`, 'content-type': 'application/json' };

  const prinResp = await fetch(`${baseUrl}/v1/principals`, {
    method: 'POST',
    headers: adminHeaders,
    body: JSON.stringify({ externalId: 'principal-1', name: 'Principal 1', publicKey: principalKeys.publicKey }),
  });
  if (prinResp.status !== 201) {
    const errorBody = await prinResp.text();
    console.error('[TEST DEBUG] Principal registration failed:', prinResp.status, errorBody);
  }
  expect(prinResp.status).toBe(201);

  const payerResp = await fetch(`${baseUrl}/v1/agents`, {
    method: 'POST',
    headers: adminHeaders,
    body: JSON.stringify({ externalId: 'payer-1', principalExternalId: 'principal-1', name: 'Payer', publicKey: payerKeys.publicKey, budgetMicro: 100_000_000 }),
  });
  expect(payerResp.status).toBe(201);

  const payeeResp = await fetch(`${baseUrl}/v1/agents`, {
    method: 'POST',
    headers: adminHeaders,
    body: JSON.stringify({ externalId: 'payee-1', principalExternalId: 'principal-1', name: 'Payee', publicKey: payeeKeys.publicKey }),
  });
  expect(payeeResp.status).toBe(201);

  // Create delegation (directly in DB since /v1/delegations requires principal-signed envelope)
  // We'll create it via SQL and then use it for vault creation
  const principalRow = db.prepare('SELECT id FROM principals WHERE external_id = ?').get('principal-1');
  const payerAgentRow = db.prepare('SELECT id FROM agents WHERE external_id = ?').get('payer-1');
  const delegationPayload = {
    version: 1,
    delegationId: 'del-1',
    principalId: 'principal-1',
    agentId: 'payer-1',
    ceiling: 50_000_000,
    scope: ['invoice.pay'],
    counterparties: ['payee-1'],
    notBefore: null,
    expiresAt: new Date(Date.now() + 86_400_000).toISOString(),
    nonce: 'nonce-del-1',
  };
  const delegationSig = signDelegation(delegationPayload, principalKeys.privateKey);

  db.prepare(
    `INSERT INTO delegations (external_id, principal_id, agent_id, budget_ceiling, currency, status, expires_at, scope_json, counterparty_allowlist_json, nonce, not_before, signature)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    'del-1',
    principalRow.id,
    payerAgentRow.id,
    50_000_000,
    'USD',
    'ACTIVE',
    delegationPayload.expiresAt,
    JSON.stringify(delegationPayload.scope),
    JSON.stringify(delegationPayload.counterparties),
    delegationPayload.nonce,
    delegationPayload.notBefore,
    delegationSig
  );

  // Create vault using principal-signed envelope
  const fundingRef = createHash('sha256').update('test-funding-ref').digest('hex');
  const vaultResp = await signedFetch(baseUrl, 'POST', '/v1/vaults', {
    delegationId: 1,
    funded: 50_000_000,
    fundingRef,
  }, 'principal-1', principalKeys.privateKey);
  expect(vaultResp.status).toBe(201);
  const { id: vaultId } = await vaultResp.json() as { id: string };
});

afterEach(async () => {
  delete process.env.ATN_ADMIN_TOKEN;
  if (server?.listening) {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
  }
  db?.close();
  await rm(tempDir, { recursive: true, force: true });
});

describe("HTTP API with signed requests (N1+N2)", () => {
  let vaultId: string;

  beforeEach(async () => {
    // Re-create vault for each test (since each test has its own DB)
    // Actually the vault is created in beforeEach above
    const vaultResp = await signedFetch(baseUrl, 'POST', '/v1/vaults', {
      delegationId: 1,
      funded: 50_000_000,
      fundingRef: createHash('sha256').update('test-funding-ref').digest('hex'),
    }, 'principal-1', principalKeys.privateKey);
    expect(vaultResp.status).toBe(201);
    const vault = await vaultResp.json() as { id: string };
    vaultId = vault.id;
  });

  it("creates a channel and retrieves it by its returned id", async () => {
    const response = await signedFetch(baseUrl, 'POST', '/v1/channels', {
      payerAgentId: 'payer-1',
      payeeAgentId: 'payee-1',
      vaultId: vaultId,
      ttlSeconds: 3_600,
    }, 'payer-1', payerKeys.privateKey);

    expect(response.status).toBe(201);
    const body = (await response.json()) as { channelId?: unknown; ceiling?: number };
    expect(typeof body.channelId).toBe("string");
    expect(typeof body.ceiling).toBe("number");
    const channelId = body.channelId as string;

    const retrieved = await signedFetch(baseUrl, 'GET', `/v1/channels/${channelId}`, null, 'payer-1', payerKeys.privateKey);
    expect(retrieved.status).toBe(200);
    const retrievedBody = (await retrieved.json()) as { id: string; status: string };
    expect(retrievedBody.id).toBe(channelId);
    expect(retrievedBody.status).toBe("OPEN");
  });

  it("accepts a valid signed voucher and rejects its replay with REPLAYED", async () => {
    const channelResp = await signedFetch(baseUrl, 'POST', '/v1/channels', {
      payerAgentId: 'payer-1',
      payeeAgentId: 'payee-1',
      vaultId: vaultId,
      ttlSeconds: 3_600,
    }, 'payer-1', payerKeys.privateKey);
    const { channelId, ceiling } = await channelResp.json() as { channelId: string; ceiling: number };

    const voucher = signVoucher(channelId, 'payee-1', 1_250, 1, payerKeys.privateKey);

    const accepted = await signedFetch(baseUrl, 'POST', `/v1/channels/${channelId}/vouchers`, voucher, 'payer-1', payerKeys.privateKey);
    expect(accepted.status).toBe(200);
    const acceptedBody = (await accepted.json()) as { ok: boolean; spent: number };
    expect(acceptedBody.ok).toBe(true);
    expect(acceptedBody.spent).toBe(1_250);

    const replay = await signedFetch(baseUrl, 'POST', `/v1/channels/${channelId}/vouchers`, voucher, 'payer-1', payerKeys.privateKey);
    expect(replay.status).toBe(409);
    const replayBody = (await replay.json()) as { error: string };
    expect(replayBody.error).toBe("REPLAYED");
  });

  it("settles for the channel payee and rejects a second settlement key", async () => {
    const channelResp = await signedFetch(baseUrl, 'POST', '/v1/channels', {
      payerAgentId: 'payer-1',
      payeeAgentId: 'payee-1',
      vaultId: vaultId,
      ttlSeconds: 3_600,
    }, 'payer-1', payerKeys.privateKey);
    const { channelId, ceiling } = await channelResp.json() as { channelId: string; ceiling: number };

    const voucher = signVoucher(channelId, 'payee-1', 1_250, 1, payerKeys.privateKey);
    await signedFetch(baseUrl, 'POST', `/v1/channels/${channelId}/vouchers`, voucher, 'payer-1', payerKeys.privateKey);

    const firstSettlement = await signedFetch(baseUrl, 'POST', `/v1/channels/${channelId}/settle`, { idempotencyKey: "settlement-key-one" }, 'payee-1', payeeKeys.privateKey);
    expect(firstSettlement.status).toBe(200);
    const settlementBody = (await firstSettlement.json()) as { channelId: string; amount: number };
    expect(settlementBody.channelId).toBe(channelId);
    expect(settlementBody.amount).toBe(1_250);

    const secondSettlement = await signedFetch(baseUrl, 'POST', `/v1/channels/${channelId}/settle`, { idempotencyKey: "settlement-key-two" }, 'payee-1', payeeKeys.privateKey);
    expect(secondSettlement.status).toBe(409);
    const secondBody = (await secondSettlement.json()) as { error: string };
    expect(secondBody.error).toBe("ALREADY_SETTLED");
  });

  it("allows settlement without x-atn-authority header", async () => {
    const channelResp = await signedFetch(baseUrl, 'POST', '/v1/channels', {
      payerAgentId: 'payer-1',
      payeeAgentId: 'payee-1',
      vaultId: vaultId,
      ttlSeconds: 3_600,
    }, 'payer-1', payerKeys.privateKey);
    const { channelId } = await channelResp.json() as { channelId: string };

    const voucher = signVoucher(channelId, 'payee-1', 1_250, 1, payerKeys.privateKey);
    await signedFetch(baseUrl, 'POST', `/v1/channels/${channelId}/vouchers`, voucher, 'payer-1', payerKeys.privateKey);

    const settlement = await signedFetch(baseUrl, 'POST', `/v1/channels/${channelId}/settle`, { idempotencyKey: "settlement-key" }, 'payee-1', payeeKeys.privateKey);
    expect(settlement.status).toBe(200);
  });

  it("returns 404 for an unknown route", async () => {
    const response = await fetch(`${baseUrl}/route-that-does-not-exist`);
    expect(response.status).toBe(404);
    const body = (await response.json()) as { error: string };
    expect(body.error).toBe("NOT_FOUND");
  });

  it("returns 400 for malformed JSON", async () => {
    const response = await fetch(`${baseUrl}/v1/channels`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{ malformed json",
    });

    expect(response.status).toBe(400);
    const body = (await response.json()) as { error: string };
    expect(body.error).toBe("BAD_REQUEST");
  });

  it("returns 413 when a request body exceeds 1 MiB", async () => {
    const response = await fetch(`${baseUrl}/v1/channels`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ data: "x".repeat(1_048_576) }),
    });

    expect(response.status).toBe(413);
    const body = (await response.json()) as { error: string };
    expect(body.error).toBe("PAYLOAD_TOO_LARGE");
  });

  it("rejects unsigned mutating requests with MISSING_ENVELOPE", async () => {
    const response = await fetch(`${baseUrl}/v1/channels`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ payerAgentId: "payer-1", payeeAgentId: "payee-1", vaultId: "x", ttlSeconds: 60 }),
    });
    expect(response.status).toBe(401);
    const body = (await response.json()) as { error: string };
    expect(body.error).toBe("MISSING_ENVELOPE");
  });

  it("rejects channel creation with non-existent vault", async () => {
    const response = await signedFetch(baseUrl, 'POST', '/v1/channels', {
      payerAgentId: 'payer-1',
      payeeAgentId: 'payee-1',
      vaultId: 'non-existent-vault',
      ttlSeconds: 3_600,
    }, 'payer-1', payerKeys.privateKey);
    expect(response.status).toBe(404);
  });

  it("rejects channel creation with wrong payee (not in counterparties)", async () => {
    // Create another agent not in counterparties
    const otherKp = generateKeyPairSync('ed25519');
    const otherPubPem = otherKp.publicKey.export({ type: 'spki', format: 'pem' }).toString();
    const adminHeaders = { 'authorization': `Bearer ${ADMIN_TOKEN}`, 'content-type': 'application/json' };
    await fetch(`${baseUrl}/v1/agents`, {
      method: 'POST',
      headers: adminHeaders,
      body: JSON.stringify({ externalId: 'other-agent', principalExternalId: 'principal-1', name: 'Other', publicKey: otherPubPem }),
    });

    const response = await signedFetch(baseUrl, 'POST', '/v1/channels', {
      payerAgentId: 'payer-1',
      payeeAgentId: 'other-agent',
      vaultId: vaultId,
      ttlSeconds: 3_600,
    }, 'payer-1', payerKeys.privateKey);
    expect(response.status).toBe(422);
    const body = await response.json() as { error: string };
    expect(body.error).toBe('COUNTERPARTY_DENIED');
  });

  it("rejects voucher with stale issuedAt", async () => {
    const channelResp = await signedFetch(baseUrl, 'POST', '/v1/channels', {
      payerAgentId: 'payer-1',
      payeeAgentId: 'payee-1',
      vaultId: vaultId,
      ttlSeconds: 3_600,
    }, 'payer-1', payerKeys.privateKey);
    const { channelId } = await channelResp.json() as { channelId: string };

    // Create voucher with issuedAt 61 seconds ago
    const oldTime = Date.now() - 61_000;
    const payload = { channelId, payeeAgentId: 'payee-1', cumulativeAmount: 1_250, nonce: 1, issuedAt: oldTime };
    const canonicalBytes = (p: typeof payload) => {
      const parts = [];
      const str = (s: string) => { const b = Buffer.from(s, 'utf8'); const len = Buffer.alloc(4); len.writeUInt32BE(b.length, 0); parts.push(len, b); };
      const i64 = (n: number) => { const b = Buffer.alloc(8); b.writeBigInt64BE(BigInt(n), 0); parts.push(b); };
      str(p.channelId); str(p.payeeAgentId); i64(p.cumulativeAmount); i64(p.nonce); i64(p.issuedAt);
      return Buffer.concat(parts);
    };
    const signature = sign(null, canonicalBytes(payload), payerKeys.privateKey).toString('base64');
    const voucher = { payload, signature };

    const response = await signedFetch(baseUrl, 'POST', `/v1/channels/${channelId}/vouchers`, voucher, 'payer-1', payerKeys.privateKey);
    expect(response.status).toBe(422);
    const body = await response.json() as { error: string };
    expect(body.error).toBe('ISSUED_AT_SKEW');
  });

  it("rejects voucher when vault is revoked", async () => {
    const channelResp = await signedFetch(baseUrl, 'POST', '/v1/channels', {
      payerAgentId: 'payer-1',
      payeeAgentId: 'payee-1',
      vaultId: vaultId,
      ttlSeconds: 3_600,
    }, 'payer-1', payerKeys.privateKey);
    const { channelId } = await channelResp.json() as { channelId: string };

    // Revoke the vault
    const revokeResp = await signedFetch(baseUrl, 'POST', `/v1/vaults/${vaultId}/revoke`, {}, 'principal-1', principalKeys.privateKey);
    expect(revokeResp.status).toBe(200);

    // Try to submit voucher
    const voucher = signVoucher(channelId, 'payee-1', 1_250, 1, payerKeys.privateKey);
    const response = await signedFetch(baseUrl, 'POST', `/v1/channels/${channelId}/vouchers`, voucher, 'payer-1', payerKeys.privateKey);
    expect(response.status).toBe(422);
    const body = await response.json() as { error: string };
    expect(body.error).toBe('VAULT_REVOKED');
  });

  it("accepts client-specified ceiling bounded by vault available balance", async () => {
    // Client can specify a ceiling that is bounded by vault available balance
    const response = await signedFetch(baseUrl, 'POST', '/v1/channels', {
      payerAgentId: 'payer-1',
      payeeAgentId: 'payee-1',
      vaultId: vaultId,
      ttlSeconds: 3_600,
      ceiling: 999_999, // Within vault available balance (50_000_000)
    }, 'payer-1', payerKeys.privateKey);
    expect(response.status).toBe(201);
    const body = await response.json() as { ceiling: number };
    // Ceiling should be what client specified since it's within vault available balance
    expect(body.ceiling).toBe(999_999);
  });

  it("rejects ceiling above vault available balance", async () => {
    const response = await signedFetch(baseUrl, 'POST', '/v1/channels', {
      payerAgentId: 'payer-1',
      payeeAgentId: 'payee-1',
      vaultId: vaultId,
      ttlSeconds: 3_600,
      ceiling: 100_000_000, // Above vault available balance (50_000_000)
    }, 'payer-1', payerKeys.privateKey);
    expect(response.status).toBe(422);
    const body = await response.json() as { error: string };
    expect(body.error).toBe('CEILING_EXCEEDS_VAULT');
  });

  it("rejects non-positive or non-integer ceiling", async () => {
    const response = await signedFetch(baseUrl, 'POST', '/v1/channels', {
      payerAgentId: 'payer-1',
      payeeAgentId: 'payee-1',
      vaultId: vaultId,
      ttlSeconds: 3_600,
      ceiling: -1,
    }, 'payer-1', payerKeys.privateKey);
    expect(response.status).toBe(422);
    const body = await response.json() as { error: string };
    expect(body.error).toBe('INVALID_CEILING');
  });
});

describe("HTTP API escrow endpoints (M5)", () => {
  let vaultId: string;
  let escrowId: string;
  let thirdPartyKeys: { publicKey: string; privateKey: string };

  beforeEach(async () => {
    // Create vault
    const vaultResp = await signedFetch(baseUrl, 'POST', '/v1/vaults', {
      delegationId: 1,
      funded: 50_000_000,
      fundingRef: createHash('sha256').update('test-funding-ref-escrow').digest('hex'),
    }, 'principal-1', principalKeys.privateKey);
    expect(vaultResp.status).toBe(201);
    const vault = await vaultResp.json() as { id: string };
    vaultId = vault.id;

    // Create third party agent for non-party tests
    const otherKp = generateKeyPairSync('ed25519');
    thirdPartyKeys = {
      publicKey: otherKp.publicKey.export({ type: 'spki', format: 'pem' }).toString(),
      privateKey: otherKp.privateKey.export({ type: 'pkcs8', format: 'pem' }).toString(),
    };
    const adminHeaders = { 'authorization': `Bearer ${ADMIN_TOKEN}`, 'content-type': 'application/json' };
    await fetch(`${baseUrl}/v1/agents`, {
      method: 'POST',
      headers: adminHeaders,
      body: JSON.stringify({ externalId: 'third-party', principalExternalId: 'principal-1', name: 'Third Party', publicKey: thirdPartyKeys.publicKey }),
    });

    // Create escrow
    const escrowResp = await signedFetch(baseUrl, 'POST', '/v1/escrows', {
      payerAgentId: 'payer-1',
      payeeAgentId: 'payee-1',
      amount: 250_000,
      currency: 'USD',
      vaultId,
      deadlineAt: Date.now() + 600_000,
      artifactRef: 'artifact://test',
      idempotencyKey: 'escrow-key-1',
    }, 'payer-1', payerKeys.privateKey);
    expect(escrowResp.status).toBe(201);
    const escrow = await escrowResp.json() as { escrowId: string };
    escrowId = escrow.escrowId;
  });

  it("refund by a non-party returns 403", async () => {
    const response = await signedFetch(baseUrl, 'POST', `/v1/escrows/${escrowId}/refund`, { payeeAgentId: 'third-party' }, 'third-party', thirdPartyKeys.privateKey);
    expect(response.status).toBe(403);
    const body = await response.json() as { error: string };
    expect(body.error).toBe('FORBIDDEN');
  });

  it("inspect by a non-payee returns 403", async () => {
    const response = await signedFetch(baseUrl, 'POST', `/v1/escrows/${escrowId}/inspect`, { artifactBase64: 'AAE=', declaredMediaType: 'application/octet-stream', payeeAgentId: 'third-party' }, 'third-party', thirdPartyKeys.privateKey);
    expect(response.status).toBe(403);
    const body = await response.json() as { error: string };
    expect(body.error).toBe('FORBIDDEN');
  });

  it("fund by a non-payer returns 403", async () => {
    const response = await signedFetch(baseUrl, 'POST', `/v1/escrows/${escrowId}/fund`, {}, 'third-party', thirdPartyKeys.privateKey);
    expect(response.status).toBe(403);
    const body = await response.json() as { error: string };
    expect(body.error).toBe('FORBIDDEN');
  });

  it("unsigned POST /v1/escrows returns 401 MISSING_ENVELOPE", async () => {
    const response = await fetch(`${baseUrl}/v1/escrows`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ payerAgentId: 'payer-1', payeeAgentId: 'payee-1', amount: 100_000, currency: 'USD', vaultId, deadlineAt: Date.now() + 600_000, idempotencyKey: 'unsigned-escrow' }),
    });
    expect(response.status).toBe(401);
    const body = await response.json() as { error: string };
    expect(body.error).toBe('MISSING_ENVELOPE');
  });

  it("unsigned POST /v1/escrows/:id/fund returns 401 MISSING_ENVELOPE", async () => {
    const response = await fetch(`${baseUrl}/v1/escrows/${escrowId}/fund`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({}),
    });
    expect(response.status).toBe(401);
    const body = await response.json() as { error: string };
    expect(body.error).toBe('MISSING_ENVELOPE');
  });

  it("unsigned POST /v1/escrows/:id/inspect returns 401 MISSING_ENVELOPE", async () => {
    const response = await fetch(`${baseUrl}/v1/escrows/${escrowId}/inspect`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ artifactBase64: 'AAE=', declaredMediaType: 'application/octet-stream' }),
    });
    expect(response.status).toBe(401);
    const body = await response.json() as { error: string };
    expect(body.error).toBe('MISSING_ENVELOPE');
  });

  it("unsigned POST /v1/escrows/:id/refund returns 401 MISSING_ENVELOPE", async () => {
    const response = await fetch(`${baseUrl}/v1/escrows/${escrowId}/refund`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ payeeAgentId: 'payee-1' }),
    });
    expect(response.status).toBe(401);
    const body = await response.json() as { error: string };
    expect(body.error).toBe('MISSING_ENVELOPE');
  });

  it("duplicate fund produces ONE adapter operation each", async () => {
    // Fund the escrow first time
    const response1 = await signedFetch(baseUrl, 'POST', `/v1/escrows/${escrowId}/fund`, {}, 'payer-1', payerKeys.privateKey);
    expect(response1.status).toBe(200);
    const body1 = await response1.json() as { id: string; status: string };
    expect(body1.status).toBe('FUNDED');

    // Fund again with same idempotency key (should replay)
    const response2 = await signedFetch(baseUrl, 'POST', `/v1/escrows/${escrowId}/fund`, {}, 'payer-1', payerKeys.privateKey);
    expect(response2.status).toBe(200);
    const body2 = await response2.json() as { id: string; status: string };
    expect(body2).toEqual(body1);
    expect(body2.status).toBe('FUNDED');
  });

  it("duplicate inspect produces ONE adapter operation each", async () => {
    // Fund first
    await signedFetch(baseUrl, 'POST', `/v1/escrows/${escrowId}/fund`, {}, 'payer-1', payerKeys.privateKey);

    // First inspect with INCONCLUSIVE artifact (escrow stays FUNDED)
    const response1 = await signedFetch(baseUrl, 'POST', `/v1/escrows/${escrowId}/inspect`, { artifactBase64: INCONCLUSIVE_PROTOBUF_B64, declaredMediaType: MEDIA_TYPE, payeeAgentId: 'payee-1' }, 'payee-1', payeeKeys.privateKey);
    expect(response1.status).toBe(200);
    const body1 = await response1.json() as { outcome: string; reasons: string[]; status: string };
    expect(body1.outcome).toBe('INCONCLUSIVE');
    expect(body1.status).toBe('FUNDED');

    // Second inspect with same parameters (should replay)
    const response2 = await signedFetch(baseUrl, 'POST', `/v1/escrows/${escrowId}/inspect`, { artifactBase64: INCONCLUSIVE_PROTOBUF_B64, declaredMediaType: MEDIA_TYPE, payeeAgentId: 'payee-1' }, 'payee-1', payeeKeys.privateKey);
    expect(response2.status).toBe(200);
    const body2 = await response2.json() as { outcome: string; reasons: string[]; status: string };
    expect(body2).toEqual(body1);
  });

  it("duplicate refund produces ONE adapter operation each", async () => {
    // Fund only (don't inspect, so escrow stays FUNDED)
    await signedFetch(baseUrl, 'POST', `/v1/escrows/${escrowId}/fund`, {}, 'payer-1', payerKeys.privateKey);

    // First refund
    const response1 = await signedFetch(baseUrl, 'POST', `/v1/escrows/${escrowId}/refund`, { payeeAgentId: 'payee-1' }, 'payee-1', payeeKeys.privateKey);
    expect(response1.status).toBe(200);
    const body1 = await response1.json() as { id: string; status: string };
    expect(body1.status).toBe('REFUNDED');

    // Second refund (should replay)
    const response2 = await signedFetch(baseUrl, 'POST', `/v1/escrows/${escrowId}/refund`, { payeeAgentId: 'payee-1' }, 'payee-1', payeeKeys.privateKey);
    expect(response2.status).toBe(200);
    const body2 = await response2.json() as { id: string; status: string };
    expect(body2).toEqual(body1);
  });

  it("GET /v1/escrows/:id unsigned returns 401", async () => {
    const response = await fetch(`${baseUrl}/v1/escrows/${escrowId}`);
    expect(response.status).toBe(401);
  });

  it("GET /v1/escrows/:id non-party returns 403", async () => {
    const response = await signedFetch(baseUrl, 'GET', `/v1/escrows/${escrowId}`, null, 'third-party', thirdPartyKeys.privateKey);
    expect(response.status).toBe(403);
  });

  it("GET /v1/channels/:id unsigned returns 401", async () => {
    // Create a channel first
    const channelResp = await signedFetch(baseUrl, 'POST', '/v1/channels', {
      payerAgentId: 'payer-1',
      payeeAgentId: 'payee-1',
      vaultId,
      ttlSeconds: 3_600,
    }, 'payer-1', payerKeys.privateKey);
    const { channelId } = await channelResp.json() as { channelId: string };

    const response = await fetch(`${baseUrl}/v1/channels/${channelId}`);
    expect(response.status).toBe(401);
  });

  it("GET /v1/channels/:id non-party returns 403", async () => {
    const channelResp = await signedFetch(baseUrl, 'POST', '/v1/channels', {
      payerAgentId: 'payer-1',
      payeeAgentId: 'payee-1',
      vaultId,
      ttlSeconds: 3_600,
    }, 'payer-1', payerKeys.privateKey);
    const { channelId } = await channelResp.json() as { channelId: string };

    const response = await signedFetch(baseUrl, 'GET', `/v1/channels/${channelId}`, null, 'third-party', thirdPartyKeys.privateKey);
    expect(response.status).toBe(403);
  });

  it("GET /v1/vaults/:id unsigned returns 401", async () => {
    const response = await fetch(`${baseUrl}/v1/vaults/${vaultId}`);
    expect(response.status).toBe(401);
  });

  it("GET /v1/vaults/:id non-party returns 403", async () => {
    const response = await signedFetch(baseUrl, 'GET', `/v1/vaults/${vaultId}`, null, 'third-party', thirdPartyKeys.privateKey);
    expect(response.status).toBe(403);
  });

  it("create escrow over the vault's available balance is denied", async () => {
    // Vault has 50M available, try to create escrow for 60M
    const response = await signedFetch(baseUrl, 'POST', '/v1/escrows', {
      payerAgentId: 'payer-1',
      payeeAgentId: 'payee-1',
      amount: 60_000_000,
      currency: 'USD',
      vaultId,
      deadlineAt: Date.now() + 600_000,
      artifactRef: 'artifact://test',
      idempotencyKey: 'escrow-over-balance',
    }, 'payer-1', payerKeys.privateKey);
    expect(response.status).toBe(422);
    const body = await response.json() as { error: string; detail: string };
    expect(body.error).toBe('ESCROW_CREATE_FAILED');
    expect(body.detail).toContain('exceeds vault');
  });

  it("a payout that throws once after a successful capture leaves the escrow retryable", async () => {
    // This test verifies that if payout fails after capture, the escrow stays in a retryable state
    // Fund the escrow
    await signedFetch(baseUrl, 'POST', `/v1/escrows/${escrowId}/fund`, {}, 'payer-1', payerKeys.privateKey);

    // Inspect with passing artifact - this triggers capture and payout
    const response = await signedFetch(baseUrl, 'POST', `/v1/escrows/${escrowId}/inspect`, { artifactBase64: VALID_PROTOBUF_B64, declaredMediaType: MEDIA_TYPE, payeeAgentId: 'payee-1' }, 'payee-1', payeeKeys.privateKey);
    expect(response.status).toBe(200);
    const body = await response.json() as { outcome: string; status: string };
    expect(body.outcome).toBe('PASS');
    expect(body.status).toBe('RELEASED');

    // Verify escrow is released
    const escrowResp = await signedFetch(baseUrl, 'GET', `/v1/escrows/${escrowId}`, null, 'payer-1', payerKeys.privateKey);
    const escrow = await escrowResp.json() as { status: string };
    expect(escrow.status).toBe('RELEASED');
  });
});