import { mkdtemp, rm } from "node:fs/promises";
import { once } from "node:events";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AddressInfo } from "node:net";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { openDatabase, runMigrations, type Database } from "../src/db/db";
import { startHttpServer } from "../src/http/server";
import { generateKeypair, signVoucher } from "../src/streaming/signing";

let db: Database;
let server: ReturnType<typeof startHttpServer>;
let tempDir: string;
let baseUrl: string;

beforeEach(async () => {
  tempDir = await mkdtemp(join(tmpdir(), "atn-http-test-"));
  db = openDatabase(join(tempDir, "test.sqlite"));
  runMigrations(db);

  server = startHttpServer(db, 0);
  await once(server, "listening");
  const address = server.address();
  if (address === null || typeof address === "string") {
    throw new Error("HTTP test server did not bind a TCP port");
  }
  baseUrl = `http://127.0.0.1:${(address as AddressInfo).port}`;
});

afterEach(async () => {
  if (server?.listening) {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
  }
  db?.close();
  await rm(tempDir, { recursive: true, force: true });
});

async function createChannel(payeeAgentId = "payee-1") {
  const keys = generateKeypair();
  const response = await fetch(`${baseUrl}/v1/channels`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      payerAgentId: "payer-1",
      payeeAgentId,
      payerPublicKey: keys.publicKey,
      ceiling: 10_000,
      ttlSeconds: 3_600,
    }),
  });
  expect(response.status).toBe(201);
  const body = (await response.json()) as { channelId?: unknown };
  expect(typeof body.channelId).toBe("string");
  if (typeof body.channelId !== "string") {
    throw new Error("Channel creation response did not include channelId");
  }
  return { channelId: body.channelId, payeeAgentId, keys };
}

function signedVoucher(
  channelId: string,
  payeeAgentId: string,
  privateKey: string,
  nonce = 1,
  cumulativeAmount = 1_250,
) {
  const payload = {
    channelId,
    payeeAgentId,
    cumulativeAmount,
    nonce,
    issuedAt: Date.now(),
  };
  return { payload, signature: signVoucher(payload, privateKey) };
}

async function postVoucher(
  channelId: string,
  voucher: ReturnType<typeof signedVoucher>,
) {
  return fetch(`${baseUrl}/v1/channels/${channelId}/vouchers`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(voucher),
  });
}

describe("HTTP API", () => {
  it("creates a channel and retrieves it by its returned id", async () => {
    const keys = generateKeypair();
    const created = await fetch(`${baseUrl}/v1/channels`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        payerAgentId: "payer-readback",
        payeeAgentId: "payee-readback",
        payerPublicKey: keys.publicKey,
        ceiling: 10_000,
        ttlSeconds: 3_600,
      }),
    });

    expect(created.status).toBe(201);
    const createdBody = (await created.json()) as { channelId: string };
    expect(createdBody.channelId).toEqual(expect.any(String));
    expect(createdBody.channelId.length).toBeGreaterThan(0);

    const retrieved = await fetch(
      `${baseUrl}/v1/channels/${createdBody.channelId}`,
    );
    expect(retrieved.status).toBe(200);
    const retrievedBody = (await retrieved.json()) as {
      id: string;
      status: string;
    };
    expect(retrievedBody.id).toBe(createdBody.channelId);
    expect(retrievedBody.status).toBe("OPEN");
  });

  it("accepts a valid signed voucher and rejects its replay with REPLAYED", async () => {
    const channel = await createChannel();
    const voucher = signedVoucher(
      channel.channelId,
      channel.payeeAgentId,
      channel.keys.privateKey,
    );

    const accepted = await postVoucher(channel.channelId, voucher);
    expect(accepted.status).toBe(200);
    const acceptedBody = (await accepted.json()) as { ok: boolean; spent: number };
    expect(acceptedBody.ok).toBe(true);
    expect(acceptedBody.spent).toBe(1_250);

    const replay = await postVoucher(channel.channelId, voucher);
    expect(replay.status).toBe(409);
    const replayBody = (await replay.json()) as { error: string };
    expect(replayBody.error).toBe("REPLAYED");
  });

  it("settles for the channel payee and rejects a second settlement key", async () => {
    const channel = await createChannel();
    const voucher = signedVoucher(
      channel.channelId,
      channel.payeeAgentId,
      channel.keys.privateKey,
    );
    const accepted = await postVoucher(channel.channelId, voucher);
    expect(accepted.status).toBe(200);

    const firstSettlement = await fetch(
      `${baseUrl}/v1/channels/${channel.channelId}/settle`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-atn-authority": channel.payeeAgentId,
        },
        body: JSON.stringify({ idempotencyKey: "settlement-key-one" }),
      },
    );
    expect(firstSettlement.status).toBe(200);
    const settlementBody = (await firstSettlement.json()) as {
      channelId: string;
      amount: number;
    };
    expect(settlementBody.channelId).toBe(channel.channelId);
    expect(settlementBody.amount).toBe(1_250);

    const secondSettlement = await fetch(
      `${baseUrl}/v1/channels/${channel.channelId}/settle`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-atn-authority": channel.payeeAgentId,
        },
        body: JSON.stringify({ idempotencyKey: "settlement-key-two" }),
      },
    );
    expect(secondSettlement.status).toBe(409);
    const secondBody = (await secondSettlement.json()) as { error: string };
    expect(secondBody.error).toBe("ALREADY_SETTLED");
  });

  it("forbids settlement when the authority header is not the channel payee", async () => {
    const channel = await createChannel();
    const response = await fetch(
      `${baseUrl}/v1/channels/${channel.channelId}/settle`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-atn-authority": "not-the-payee",
        },
        body: JSON.stringify({ idempotencyKey: "wrong-authority-key" }),
      },
    );

    expect(response.status).toBe(403);
    const body = (await response.json()) as { error: string };
    expect(body.error).toBe("FORBIDDEN");
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
});
