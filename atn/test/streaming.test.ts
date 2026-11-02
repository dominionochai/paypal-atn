import { afterEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openDatabase, runMigrations, type Database } from "../src/db/db.js";
import {
  acceptVoucher,
  AlreadySettledError,
  getChannel,
  openChannel,
  settleChannel,
} from "../src/streaming/channel.js";
import {
  generateKeypair,
  signVoucher,
  type VoucherPayload,
} from "../src/streaming/signing.js";

const testDatabases: Array<{ db: Database; directory: string }> = [];

function newTestDatabase(): Database {
  const directory = mkdtempSync(join(tmpdir(), "atn-streaming-test-"));
  const db = openDatabase(join(directory, "streaming.sqlite"));
  testDatabases.push({ db, directory });
  runMigrations(db);
  return db;
}

afterEach(() => {
  for (const { db, directory } of testDatabases.splice(0)) {
    try {
      db.close();
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  }
});

function newChannel(db: Database, ceiling = 1_000) {
  const payerKeys = generateKeypair();
  const channel = openChannel(db, {
    payerAgentId: "payer-agent",
    payeeAgentId: "payee-agent",
    payerPublicKey: payerKeys.publicKey,
    ceiling,
    ttlSeconds: 3_600,
  });
  return { channel, privateKey: payerKeys.privateKey };
}

function signedVoucher(
  channel: ReturnType<typeof openChannel>,
  privateKey: string,
  overrides: Partial<VoucherPayload> = {},
) {
  const payload: VoucherPayload = {
    channelId: channel.id,
    payeeAgentId: channel.payee_agent_id,
    cumulativeAmount: 100,
    nonce: 1,
    issuedAt: Date.now(),
    ...overrides,
  };
  return { payload, signature: signVoucher(payload, privateKey) };
}

function countingAdapter() {
  const charges: unknown[] = [];
  const adapter = {
    async charge(input: {
      amount: number;
      currency: string;
      idempotencyKey: string;
      channelId: string;
    }) {
      charges.push(input);
      return { mode: "fake", ref: `fake-charge-${charges.length}` };
    },
  } as unknown as Parameters<typeof settleChannel>[3];
  return { adapter, charges };
}

describe("streaming vouchers and settlement", () => {
  it("accepts five cumulative vouchers and settles their final spent amount", async () => {
    const db = newTestDatabase();
    const { channel, privateKey } = newChannel(db);

    for (let nonce = 1; nonce <= 5; nonce += 1) {
      const voucher = signedVoucher(channel, privateKey, {
        cumulativeAmount: nonce * 100,
        nonce,
      });
      expect(acceptVoucher(db, channel.id, voucher, channel.ceiling)).toEqual({ ok: true });
    }

    expect(getChannel(db, channel.id)?.spent).toBe(500);
    const { adapter } = countingAdapter();
    const settlement = await settleChannel(db, channel.id, "happy-path-key", adapter);

    expect(settlement.amount).toBe(500);
    expect(getChannel(db, channel.id)?.spent).toBe(500);
  });

  it("rejects a nonce that is not newer than the last accepted nonce as STALE", () => {
    const db = newTestDatabase();
    const { channel, privateKey } = newChannel(db);
    const first = signedVoucher(channel, privateKey, { cumulativeAmount: 200, nonce: 7 });
    expect(acceptVoucher(db, channel.id, first, channel.ceiling)).toEqual({ ok: true });

    const older = signedVoucher(channel, privateKey, { cumulativeAmount: 250, nonce: 6 });
    expect(acceptVoucher(db, channel.id, older, channel.ceiling)).toMatchObject({
      ok: false,
      code: "STALE",
    });
  });

  it("rejects a voucher accepted twice as REPLAYED", () => {
    const db = newTestDatabase();
    const { channel, privateKey } = newChannel(db);
    const voucher = signedVoucher(channel, privateKey);

    expect(acceptVoucher(db, channel.id, voucher, channel.ceiling)).toEqual({ ok: true });
    expect(acceptVoucher(db, channel.id, voucher, channel.ceiling)).toMatchObject({
      ok: false,
      code: "REPLAYED",
    });
  });

  it("rejects a cumulative amount changed after signing as TAMPERED", () => {
    const db = newTestDatabase();
    const { channel, privateKey } = newChannel(db);
    const voucher = signedVoucher(channel, privateKey);
    voucher.payload.cumulativeAmount += 1;

    expect(acceptVoucher(db, channel.id, voucher, channel.ceiling)).toMatchObject({
      ok: false,
      code: "TAMPERED",
    });
  });

  it("rejects a voucher above the channel ceiling as OVER_BUDGET", () => {
    const db = newTestDatabase();
    const { channel, privateKey } = newChannel(db, 500);
    const voucher = signedVoucher(channel, privateKey, { cumulativeAmount: 501 });

    expect(acceptVoucher(db, channel.id, voucher, channel.ceiling)).toMatchObject({
      ok: false,
      code: "OVER_BUDGET",
    });
  });

  it("rejects a voucher signed for a different payee as WRONG_PARTY", () => {
    const db = newTestDatabase();
    const { channel, privateKey } = newChannel(db);
    const voucher = signedVoucher(channel, privateKey, { payeeAgentId: "other-payee" });

    expect(acceptVoucher(db, channel.id, voucher, channel.ceiling)).toMatchObject({
      ok: false,
      code: "WRONG_PARTY",
    });
  });

  it("rejects a decreasing cumulative amount as NON_MONOTONIC", () => {
    const db = newTestDatabase();
    const { channel, privateKey } = newChannel(db);
    const first = signedVoucher(channel, privateKey, { cumulativeAmount: 200, nonce: 1 });
    const lower = signedVoucher(channel, privateKey, { cumulativeAmount: 199, nonce: 2 });

    expect(acceptVoucher(db, channel.id, first, channel.ceiling)).toEqual({ ok: true });
    expect(acceptVoucher(db, channel.id, lower, channel.ceiling)).toMatchObject({
      ok: false,
      code: "NON_MONOTONIC",
    });
  });

  it("settles twice with one idempotency key using one settlement row and one charge", async () => {
    const db = newTestDatabase();
    const { channel, privateKey } = newChannel(db);
    const voucher = signedVoucher(channel, privateKey, { cumulativeAmount: 400 });
    expect(acceptVoucher(db, channel.id, voucher, channel.ceiling)).toEqual({ ok: true });
    const { adapter, charges } = countingAdapter();

    const first = await settleChannel(db, channel.id, "same-key", adapter);
    const second = await settleChannel(db, channel.id, "same-key", adapter);
    const rows = db
      .prepare("SELECT COUNT(*) AS count FROM settlements WHERE channel_id = ?")
      .get(channel.id) as { count: number };

    expect(first.id).toBe(second.id);
    expect(rows.count).toBe(1);
    expect(charges).toHaveLength(1);
  });

  it("throws the exported AlreadySettledError for a settled channel and a different key", async () => {
    const db = newTestDatabase();
    const { channel, privateKey } = newChannel(db);
    const voucher = signedVoucher(channel, privateKey, { cumulativeAmount: 300 });
    expect(acceptVoucher(db, channel.id, voucher, channel.ceiling)).toEqual({ ok: true });
    const { adapter } = countingAdapter();
    await settleChannel(db, channel.id, "first-key", adapter);

    await expect(
      settleChannel(db, channel.id, "different-key", adapter),
    ).rejects.toBeInstanceOf(AlreadySettledError);
  });

  it("keeps spent within the ceiling over 50 sequential voucher acceptances", () => {
    const db = newTestDatabase();
    const ceiling = 500;
    const { channel, privateKey } = newChannel(db, ceiling);
    let highestAcceptedCumulativeAmount = 0;

    for (let nonce = 1; nonce <= 50; nonce += 1) {
      const cumulativeAmount = nonce * 10;
      const voucher = signedVoucher(channel, privateKey, { cumulativeAmount, nonce });
      expect(acceptVoucher(db, channel.id, voucher, channel.ceiling)).toEqual({ ok: true });
      highestAcceptedCumulativeAmount = Math.max(
        highestAcceptedCumulativeAmount,
        cumulativeAmount,
      );
      const spent = getChannel(db, channel.id)?.spent;
      expect(spent).toBeDefined();
      expect(spent!).toBeLessThanOrEqual(ceiling);
    }

    expect(getChannel(db, channel.id)?.spent).toBe(highestAcceptedCumulativeAmount);
  });
});
