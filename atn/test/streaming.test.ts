import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import Database from 'better-sqlite3';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { WebSocket, WebSocketServer, type RawData } from 'ws';
import { generateKeypair, signVoucher, type VoucherPayload } from '../src/streaming/signing.js';
import { acceptVoucher, AlreadySettledError, getChannel, openChannel, settleChannel, type Db } from '../src/streaming/channel.js';
import { SimulatedAdapter, type ChargeRequest, type ChargeResult, type PaymentAdapter } from '../src/payments/adapter.js';
import { startStreamingServer } from '../src/streaming/ws.js';
import type { VoucherInput, VoucherResult } from '../src/streaming/voucher.js';

let database: InstanceType<typeof Database> | undefined;
let tempDirectory: string | undefined;
const sockets = new Set<WebSocket>();
const servers = new Set<WebSocketServer>();

function sqlite(): InstanceType<typeof Database> {
  if (!database) throw new Error('test database is not initialized');
  return database;
}

function streamingDb(): Db {
  return sqlite() as unknown as Db;
}

beforeEach(async () => {
  tempDirectory = await mkdtemp(join(tmpdir(), 'atn-streaming-'));
  database = new Database(join(tempDirectory, 'streaming.sqlite'));
  const migrationUrls = [
    new URL('../src/db/migrations/001_initial.sql', import.meta.url),
    new URL('../src/db/migrations/002_streaming.sql', import.meta.url),
  ];
  for (const migrationUrl of migrationUrls) {
    sqlite().exec(await readFile(migrationUrl, 'utf8'));
  }
});

afterEach(async () => {
  for (const socket of sockets) socket.terminate();
  sockets.clear();
  for (const server of servers) {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
  servers.clear();
  if (database) {
    database.close();
    database = undefined;
  }
  if (tempDirectory) {
    await rm(tempDirectory, { recursive: true, force: true });
    tempDirectory = undefined;
  }
});

function makeChannel(options: { ceiling?: number; now?: number; ttlSeconds?: number } = {}) {
  const keys = generateKeypair();
  const channel = openChannel(streamingDb(), {
    payerAgentId: 'payer-agent',
    payeeAgentId: 'payee-agent',
    payerPublicKey: keys.publicKey,
    ceiling: options.ceiling ?? 1_000,
    ttlSeconds: options.ttlSeconds ?? 3_600,
    ...(options.now === undefined ? {} : { now: options.now }),
  });
  return { channel, keys };
}

function makeVoucher(channelId: string, payeeAgentId: string, privateKey: string, nonce: number, cumulativeAmount: number): VoucherInput {
  const payload: VoucherPayload = { channelId, payeeAgentId, cumulativeAmount, nonce, issuedAt: Date.now() };
  return { payload, signature: signVoucher(payload, privateKey) };
}

function expectCode(result: VoucherResult, code: string): void {
  expect(result.ok).toBe(false);
  if (!result.ok) expect(result.code).toBe(code);
}

type WireMessage = Record<string, unknown>;

function isRecord(value: unknown): value is WireMessage {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function rawText(raw: RawData): string {
  if (Buffer.isBuffer(raw)) return raw.toString('utf8');
  if (Array.isArray(raw)) return Buffer.concat(raw).toString('utf8');
  return Buffer.from(raw).toString('utf8');
}

function waitForMessage(socket: WebSocket, predicate: (message: WireMessage) => boolean): Promise<WireMessage> {
  return new Promise((resolve, reject) => {
    let timer: ReturnType<typeof setTimeout>;
    const onMessage = (raw: RawData): void => {
      let parsed: unknown;
      try {
        parsed = JSON.parse(rawText(raw)) as unknown;
      } catch {
        return;
      }
      if (isRecord(parsed) && predicate(parsed)) {
        clearTimeout(timer);
        socket.off('message', onMessage);
        resolve(parsed);
      }
    };
    timer = setTimeout(() => {
      socket.off('message', onMessage);
      reject(new Error('timed out waiting for WebSocket response'));
    }, 5_000);
    socket.on('message', onMessage);
  });
}

describe('streaming payment channels', () => {
  it('accepts five cumulative vouchers and settles the final cumulative amount', async () => {
    const { channel, keys } = makeChannel({ ceiling: 1_000 });
    for (let nonce = 1; nonce <= 5; nonce += 1) {
      const result = acceptVoucher(streamingDb(), channel.id, makeVoucher(channel.id, channel.payee_agent_id, keys.privateKey, nonce, nonce * 100), 1_000);
      expect(result).toEqual({ ok: true });
    }
    const settlement = await settleChannel(streamingDb(), channel.id, 'happy-settlement-key', new SimulatedAdapter());
    expect(settlement.channel_id).toBe(channel.id);
    expect(settlement.amount).toBe(500);
    expect(getChannel(streamingDb(), channel.id)?.status).toBe('SETTLED');
  });

  it('rejects an expired channel with STALE', () => {
    const { channel, keys } = makeChannel({ now: Date.now() - 10_000, ttlSeconds: 1 });
    const voucher = makeVoucher(channel.id, channel.payee_agent_id, keys.privateKey, 1, 10);
    expectCode(acceptVoucher(streamingDb(), channel.id, voucher, 1_000), 'STALE');
  });

  it('classifies a previously accepted voucher as REPLAYED', () => {
    const { channel, keys } = makeChannel();
    const voucher = makeVoucher(channel.id, channel.payee_agent_id, keys.privateKey, 1, 10);
    expect(acceptVoucher(streamingDb(), channel.id, voucher, 1_000)).toEqual({ ok: true });
    expectCode(acceptVoucher(streamingDb(), channel.id, voucher, 1_000), 'REPLAYED');
  });

  it('rejects a voucher whose amount was modified after signing as TAMPERED', () => {
    const { channel, keys } = makeChannel();
    const voucher = makeVoucher(channel.id, channel.payee_agent_id, keys.privateKey, 1, 10);
    voucher.payload.cumulativeAmount = 11;
    expectCode(acceptVoucher(streamingDb(), channel.id, voucher, 1_000), 'TAMPERED');
  });

  it('rejects an amount above the channel ceiling with OVER_BUDGET', () => {
    const { channel, keys } = makeChannel({ ceiling: 100 });
    const voucher = makeVoucher(channel.id, channel.payee_agent_id, keys.privateKey, 1, 101);
    expectCode(acceptVoucher(streamingDb(), channel.id, voucher, 1_000), 'OVER_BUDGET');
  });

  it('rejects a voucher addressed to the wrong payee with WRONG_PARTY', () => {
    const { channel, keys } = makeChannel();
    const voucher = makeVoucher(channel.id, 'another-payee', keys.privateKey, 1, 10);
    expectCode(acceptVoucher(streamingDb(), channel.id, voucher, 1_000), 'WRONG_PARTY');
  });

  it('rejects a decreasing cumulative amount with NON_MONOTONIC', () => {
    const { channel, keys } = makeChannel();
    expect(acceptVoucher(streamingDb(), channel.id, makeVoucher(channel.id, channel.payee_agent_id, keys.privateKey, 1, 80), 1_000)).toEqual({ ok: true });
    const lower = makeVoucher(channel.id, channel.payee_agent_id, keys.privateKey, 2, 70);
    expectCode(acceptVoucher(streamingDb(), channel.id, lower, 1_000), 'NON_MONOTONIC');
  });

  it('returns the same settlement for a repeated idempotency key without charging twice', async () => {
    const { channel, keys } = makeChannel();
    expect(acceptVoucher(streamingDb(), channel.id, makeVoucher(channel.id, channel.payee_agent_id, keys.privateKey, 1, 75), 1_000)).toEqual({ ok: true });
    let chargeCalls = 0;
    const adapter: PaymentAdapter = {
      async charge(_request: ChargeRequest): Promise<ChargeResult> {
        chargeCalls += 1;
        return { ref: 'counted-capture', mode: 'SIMULATED' };
      },
    };
    const first = await settleChannel(streamingDb(), channel.id, 'same-key', adapter);
    const second = await settleChannel(streamingDb(), channel.id, 'same-key', adapter);
    expect(second).toEqual(first);
    expect(chargeCalls).toBe(1);
    const count = sqlite().prepare('SELECT COUNT(*) AS count FROM settlements').get() as { count: number };
    expect(count.count).toBe(1);
  });

  it('throws AlreadySettledError for a different key after settlement', async () => {
    const { channel } = makeChannel();
    await settleChannel(streamingDb(), channel.id, 'first-key', new SimulatedAdapter());
    await expect(settleChannel(streamingDb(), channel.id, 'different-key', new SimulatedAdapter())).rejects.toBeInstanceOf(AlreadySettledError);
  });

  it('keeps spent within the ceiling during a storm of fifty voucher submissions', async () => {
    const ceiling = 500;
    const { channel, keys } = makeChannel({ ceiling });
    const results = await Promise.all(Array.from({ length: 50 }, (_, index) => Promise.resolve().then(() => {
      const nonce = index + 1;
      const voucher = makeVoucher(channel.id, channel.payee_agent_id, keys.privateKey, nonce, nonce * 10);
      return acceptVoucher(streamingDb(), channel.id, voucher, ceiling);
    })));
    expect(results.every((result) => result.ok)).toBe(true);
    const updated = getChannel(streamingDb(), channel.id);
    expect(updated).not.toBeNull();
    expect(updated?.spent).toBeLessThanOrEqual(ceiling);
    expect(updated?.spent).toBe(ceiling);
  });

  it('handles valid vouchers, replays, malformed JSON, and later messages over WebSocket', async () => {
    const { channel, keys } = makeChannel();
    const server = startStreamingServer({ db: streamingDb(), port: 0, delegationBudget: 1_000 });
    servers.add(server);
    await new Promise<void>((resolve, reject) => {
      server.once('listening', resolve);
      server.once('error', reject);
    });
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('WebSocket server has no TCP address');
    const socket = new WebSocket(`ws://127.0.0.1:${address.port}`);
    sockets.add(socket);
    await new Promise<void>((resolve, reject) => {
      socket.once('open', resolve);
      socket.once('error', reject);
    });

    const firstVoucher = makeVoucher(channel.id, channel.payee_agent_id, keys.privateKey, 1, 100);
    const firstAck = waitForMessage(socket, (message) => message.type === 'ack');
    socket.send(JSON.stringify({ type: 'voucher', channelId: channel.id, voucher: firstVoucher }));
    expect((await firstAck).type).toBe('ack');

    const replayReject = waitForMessage(socket, (message) => message.type === 'reject' && message.code === 'REPLAYED');
    socket.send(JSON.stringify({ type: 'voucher', channelId: channel.id, voucher: firstVoucher }));
    const replayResponse = await replayReject;
    expect(replayResponse.type).toBe('reject');
    expect(replayResponse.code).toBe('REPLAYED');

    const malformedError = waitForMessage(socket, (message) => message.type === 'error');
    socket.send('{malformed json');
    expect((await malformedError).type).toBe('error');

    const nextVoucher = makeVoucher(channel.id, channel.payee_agent_id, keys.privateKey, 2, 200);
    const nextAck = waitForMessage(socket, (message) => message.type === 'ack');
    socket.send(JSON.stringify({ type: 'voucher', channelId: channel.id, voucher: nextVoucher }));
    expect((await nextAck).type).toBe('ack');
  }, 15_000);
});
