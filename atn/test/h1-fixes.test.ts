import { afterEach, describe, expect, it } from 'vitest';
import { createDatabase } from '../src/db/db.js';
import {
  createRequestHash,
  IdempotencyConflictError,
  IdempotencyInFlightError,
  PaymentOutcomeUnknownError,
  SqliteIdempotencyStore,
} from '../src/payments/idempotency.js';
import { buildReconciliationReport, reconcilePayments } from '../src/payments/reconcile.js';
import { createPaymentAdapter, HybridSandboxAdapter, NotRepresentableError, SimulatedAdapter } from '../src/payments/adapter.js';
import { handleRequest } from '../src/http/routes.js';

describe('SQLite idempotency store', () => {
  it('replays the stored result once, conflicts on changed input, and blocks in-flight/unknown retries', async () => {
    const db = createDatabase(':memory:');
    try {
      const store = new SqliteIdempotencyStore(db);
      const request = { amountMicros: 1_999_999, currency: 'USD' };
      const hash = createRequestHash(request);
      let providerCalls = 0;
      const first = await store.execute('same-key', hash, async () => {
        providerCalls += 1;
        return { orderId: 'ORDER-STORED', status: 'CREATED' };
      });
      const replay = await store.execute('same-key', hash, async () => {
        providerCalls += 1;
        return { orderId: 'SHOULD-NOT-RUN', status: 'CREATED' };
      });
      expect(replay).toEqual(first);
      expect(providerCalls).toBe(1);
      expect(() => store.claim('same-key', createRequestHash({ ...request, amountMicros: 2 }))).toThrow(IdempotencyConflictError);

      const inFlightHash = createRequestHash({ operation: 'capture' });
      expect(store.claim('in-flight-key', inFlightHash)).toEqual({ kind: 'acquired' });
      await expect(store.execute('in-flight-key', inFlightHash, async () => 'should not run')).rejects.toBeInstanceOf(IdempotencyInFlightError);

      const unknownHash = createRequestHash({ operation: 'unknown-capture' });
      await expect(store.execute('unknown-key', unknownHash, async () => { throw new Error('connection lost'); }))
        .rejects.toBeInstanceOf(PaymentOutcomeUnknownError);
      expect(store.get('unknown-key')?.status).toBe('UNKNOWN');
      await expect(store.execute('unknown-key', unknownHash, async () => 'unsafe retry'))
        .rejects.toBeInstanceOf(PaymentOutcomeUnknownError);
    } finally {
      db.close();
    }
  });
});

describe('payment reconciliation', () => {
  const p = (reference: string, amountMicros = 1_000_000, status = 'COMPLETED'): {
    reference: string; amountMicros: number; currency: string; status: string;
  } => ({ reference, amountMicros, currency: 'USD', status });

  it('reports matched, local-only, remote-only, amount mismatch and status mismatch records', async () => {
    const local = [p('matched'), p('local-only'), p('amount'), p('status')];
    const remote = [p('matched'), p('remote-only'), p('amount', 1_000_001), p('status', 1_000_000, 'PENDING')];
    let fetchCalls = 0;
    const report = await reconcilePayments(local, async () => { fetchCalls += 1; return remote; });
    expect(fetchCalls).toBe(1);
    expect(report.matched.map((item) => item.reference)).toEqual(['matched']);
    expect(report.local_only.map((item) => item.reference)).toEqual(['local-only']);
    expect(report.remote_only.map((item) => item.reference)).toEqual(['remote-only']);
    expect(report.amount_mismatch.map((item) => item.reference)).toEqual(['amount']);
    expect(report.status_mismatch.map((item) => item.reference)).toEqual(['status']);
    expect(buildReconciliationReport(local, remote)).toEqual(report);
  });
});

interface RecordedCall { url: string; body: string | undefined }

function jsonResponse(payload: unknown, status: number): Response {
  return new Response(JSON.stringify(payload), { status, headers: { 'Content-Type': 'application/json' } });
}

function recordingFetch(calls: RecordedCall[]): typeof fetch {
  return (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    calls.push({ url, body: typeof init?.body === 'string' ? init.body : undefined });
    if (url.endsWith('/v1/oauth2/token')) return jsonResponse({ access_token: 'test-token', expires_in: 3600, token_type: 'Bearer' }, 200);
    if (url.endsWith('/v1/payments/payouts')) return jsonResponse({ batch_header: { payout_batch_id: 'BATCH-1', batch_status: 'PENDING' } }, 201);
    return jsonResponse({}, 404);
  }) as typeof fetch;
}

const saved: Record<string, string | undefined> = {};
const keys = ['SETTLEMENT_MODE', 'PAYPAL_CLIENT_ID', 'PAYPAL_CLIENT_SECRET', 'PAYPAL_PAYEE_EMAIL', 'PAYPAL_BASE_URL'];
function setEnv(values: Record<string, string>): void {
  for (const key of keys) saved[key] = process.env[key];
  for (const key of keys) delete process.env[key];
  for (const [key, value] of Object.entries(values)) process.env[key] = value;
}
afterEach(() => {
  for (const key of keys) {
    if (saved[key] === undefined) delete process.env[key];
    else process.env[key] = saved[key];
  }
});

const sandboxEnv = {
  SETTLEMENT_MODE: 'PAYPAL_SANDBOX',
  PAYPAL_CLIENT_ID: 'unit-test-client-id',
  PAYPAL_CLIENT_SECRET: 'unit-test-client-secret',
  PAYPAL_PAYEE_EMAIL: 'payee@example.com',
};

describe('settlement mode selection', () => {
  it('uses the simulated adapter by default and the hybrid adapter only for PAYPAL_SANDBOX', () => {
    setEnv({});
    expect(createPaymentAdapter()).toBeInstanceOf(SimulatedAdapter);
    setEnv({ SETTLEMENT_MODE: 'SIMULATED', PAYPAL_CLIENT_ID: 'x', PAYPAL_CLIENT_SECRET: 'y' });
    expect(createPaymentAdapter()).toBeInstanceOf(SimulatedAdapter);
    setEnv(sandboxEnv);
    expect(createPaymentAdapter()).toBeInstanceOf(HybridSandboxAdapter);
  });
});

describe('hybrid sandbox adapter (server path)', () => {
  it('keeps escrow holds ledger-only: authorize, capture, void and refund make no network calls', async () => {
    setEnv(sandboxEnv);
    const calls: RecordedCall[] = [];
    const adapter = new HybridSandboxAdapter(recordingFetch(calls));
    const auth = await adapter.authorize({ amount: 25_000_000, currency: 'USD', idempotencyKey: 'k1', escrowId: 'e1' });
    const capture = await adapter.capture({ authRef: auth.ref, amount: 25_000_000, idempotencyKey: 'k2' });
    await adapter.voidAuthorization({ authRef: auth.ref, idempotencyKey: 'k3' });
    await adapter.refund({ captureRef: capture.ref, amount: 25_000_000, idempotencyKey: 'k4' });
    expect(calls).toHaveLength(0);
    expect(auth.mode).toBe('SIMULATED');
  });

  it('settles a channel with a real Payouts call for the spent amount', async () => {
    setEnv(sandboxEnv);
    const calls: RecordedCall[] = [];
    const adapter = new HybridSandboxAdapter(recordingFetch(calls));
    const result = await adapter.charge({ amount: 100_000, currency: 'USD', idempotencyKey: 'settle-1', channelId: 'ch-1' });
    expect(result).toEqual({ ref: 'BATCH-1', mode: 'SANDBOX' });
    const payoutCall = calls.find((call) => call.url.endsWith('/v1/payments/payouts'));
    expect(payoutCall).toBeDefined();
    const body = JSON.parse(payoutCall?.body ?? '{}') as { items: Array<{ amount: { value: string; currency: string }; receiver: string }> };
    expect(body.items[0]?.amount).toEqual({ value: '0.10', currency: 'USD' });
    expect(body.items[0]?.receiver).toBe('payee@example.com');
  });

  it('releases an escrow with a real Payouts call for the full amount', async () => {
    setEnv(sandboxEnv);
    const calls: RecordedCall[] = [];
    const adapter = new HybridSandboxAdapter(recordingFetch(calls));
    const result = await adapter.payout({ amount: 25_000_000, currency: 'USD', payeeRef: 'agent:worker', idempotencyKey: 'rel-1' });
    expect(result.mode).toBe('SANDBOX');
    const payoutCall = calls.find((call) => call.url.endsWith('/v1/payments/payouts'));
    const body = JSON.parse(payoutCall?.body ?? '{}') as { items: Array<{ amount: { value: string } }> };
    expect(body.items[0]?.amount.value).toBe('25.00');
  });

  it('refuses amounts that are not whole cents before any payout call', async () => {
    setEnv(sandboxEnv);
    const calls: RecordedCall[] = [];
    const adapter = new HybridSandboxAdapter(recordingFetch(calls));
    await expect(adapter.charge({ amount: 200, currency: 'USD', idempotencyKey: 'tiny', channelId: 'ch-2' })).rejects.toBeInstanceOf(NotRepresentableError);
    expect(calls.filter((call) => call.url.endsWith('/v1/payments/payouts'))).toHaveLength(0);
  });
});

describe('health route', () => {
  it('answers GET /health publicly without a signed envelope', async () => {
    const db = createDatabase(':memory:');
    try {
      const out = await handleRequest({ method: 'GET', path: '/health', headers: {}, body: Buffer.alloc(0), db, delegationBudget: 0 });
      expect(out.status).toBe(200);
      expect((out.body as { ok: boolean }).ok).toBe(true);
    } finally {
      db.close();
    }
  });
});
