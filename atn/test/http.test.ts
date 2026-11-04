import { mkdtemp, rm } from "node:fs/promises";
import { once } from "node:events";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AddressInfo } from "node:net";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { openDatabase, runMigrations, type Database } from "../src/db/db";
import { startHttpServer } from "../src/http/server";
import { generateKeyPairSync, createHash, sign } from "node:crypto";

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
  const bodyBuf = Buffer.from(JSON.stringify(bodyObj ?? {}));
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
  const response = await fetch(base + path, {
    method,
    headers,
    body: JSON.stringify(body),
  });
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

describe("HTTP API with signed requests", () => {
  it("creates a channel and retrieves it by its returned id", async () => {
    const response = await signedFetch(baseUrl, 'POST', '/v1/channels', {
      payerAgentId: 'payer-1',
      payeeAgentId: 'payee-1',
      payerPublicKey: payerKeys.publicKey,
      ceiling: 10_000,
      ttlSeconds: 3_600,
    }, 'payer-1', payerKeys.privateKey);

    expect(response.status).toBe(201);
    const body = (await response.json()) as { channelId?: unknown };
    expect(typeof body.channelId).toBe("string");
    const channelId = body.channelId as string;

    const retrieved = await fetch(`${baseUrl}/v1/channels/${channelId}`);
    expect(retrieved.status).toBe(200);
    const retrievedBody = (await retrieved.json()) as { id: string; status: string };
    expect(retrievedBody.id).toBe(channelId);
    expect(retrievedBody.status).toBe("OPEN");
  });

  it("accepts a valid signed voucher and rejects its replay with REPLAYED", async () => {
    const channelResp = await signedFetch(baseUrl, 'POST', '/v1/channels', {
      payerAgentId: 'payer-1',
      payeeAgentId: 'payee-1',
      payerPublicKey: payerKeys.publicKey,
      ceiling: 10_000,
      ttlSeconds: 3_600,
    }, 'payer-1', payerKeys.privateKey);
    const { channelId } = await channelResp.json() as { channelId: string };

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
      payerPublicKey: payerKeys.publicKey,
      ceiling: 10_000,
      ttlSeconds: 3_600,
    }, 'payer-1', payerKeys.privateKey);
    const { channelId } = await channelResp.json() as { channelId: string };

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
      payerPublicKey: payerKeys.publicKey,
      ceiling: 10_000,
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
      body: JSON.stringify({ payerAgentId: "payer-1", payeeAgentId: "payee-1", payerPublicKey: "x", ceiling: 1000, ttlSeconds: 60 }),
    });
    expect(response.status).toBe(401);
    const body = (await response.json()) as { error: string };
    expect(body.error).toBe("MISSING_ENVELOPE");
  });
});