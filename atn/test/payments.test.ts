import { afterEach, describe, expect, it, vi } from 'vitest';
import { createDatabase } from '../src/db/db.js';
import {
  createRequestHash,
  IdempotencyConflictError,
  IdempotencyInFlightError,
  PaymentOutcomeUnknownError,
  SqliteIdempotencyStore,
} from '../src/payments/idempotency.js';
import { buildReconciliationReport, reconcilePayments } from '../src/payments/reconcile.js';
import {
  decimalToMicros,
  microsToDecimal,
  PAYPAL_PAYMENT_MAX_ATTEMPTS,
  PayPalProviderError,
  PayPalSandboxProvider,
} from '../src/payments/providers/paypal.js';
import { SimulatedPaymentProvider } from '../src/payments/providers/simulated.js';

function jsonResponse(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), { status, headers: { 'Content-Type': 'application/json' } });
}
const credentials = { clientId: 'offline-client', clientSecret: 'offline-secret' };
afterEach(() => vi.restoreAllMocks());

describe('PayPal sandbox provider', () => {
  it('returns a typed OAuth fetch failure before sending a payment request', async () => {
    let calls = 0;
    const provider = new PayPalSandboxProvider(credentials, { fetcher: async () => { calls += 1; throw new Error('offline fake fetch failure'); } });
    await expect(provider.createOrder({ amountMicros: 1, idempotencyKey: 'auth-failure' })).rejects.toMatchObject({
      name: 'PayPalProviderError', retryable: true, definitive: true, outcomeUnknown: false,
    });
    expect(calls).toBe(1);
  });

  it('does not retry definitive create-order 4xx responses', async () => {
    let paymentCalls = 0;
    const provider = new PayPalSandboxProvider(credentials, { fetcher: async (input) => {
      if (String(input).endsWith('/v1/oauth2/token')) return jsonResponse({ access_token: 'token' });
      paymentCalls += 1;
      return jsonResponse({ name: 'INVALID_REQUEST', message: 'bad order' }, 422);
    } });
    await expect(provider.createOrder({ amountMicros: 1_999_999, idempotencyKey: 'definitive-4xx' })).rejects.toMatchObject({
      name: 'PayPalProviderError', status: 422, retryable: false, definitive: true, outcomeUnknown: false,
    });
    expect(paymentCalls).toBe(1);
  });

  it('retries HTTP 5xx exactly twice and then returns a typed unknown-outcome failure', async () => {
    let paymentCalls = 0;
    const requestIds: string[] = [];
    const provider = new PayPalSandboxProvider(credentials, { fetcher: async (input, init) => {
      if (String(input).endsWith('/v1/oauth2/token')) return jsonResponse({ access_token: 'token' });
      paymentCalls += 1;
      requestIds.push(new Headers(init?.headers).get('PayPal-Request-Id') ?? '');
      return jsonResponse({ message: 'temporary sandbox failure' }, 503);
    } });
    await expect(provider.createOrder({ amountMicros: 1, idempotencyKey: 'retry-5xx' })).rejects.toBeInstanceOf(PayPalProviderError);
    expect(PAYPAL_PAYMENT_MAX_ATTEMPTS).toBe(3);
    expect(paymentCalls).toBe(3);
    expect(new Set(requestIds)).toEqual(new Set(['retry-5xx']));
  });

  it('parses successful capture id, status, amount and currency', async () => {
    const provider = new PayPalSandboxProvider(credentials, { fetcher: async (input) => {
      if (String(input).endsWith('/v1/oauth2/token')) return jsonResponse({ access_token: 'token' });
      return jsonResponse({ purchase_units: [{ payments: { captures: [{
        id: 'CAPTURE-1', status: 'COMPLETED', amount: { value: '50.000001', currency_code: 'USD' },
      }] } }] });
    } });
    const capture = await provider.captureOrder({ orderId: 'ORDER-1', idempotencyKey: 'capture-key' });
    expect(capture).toEqual({ orderId: 'ORDER-1', captureId: 'CAPTURE-1', status: 'COMPLETED', amountMicros: 50_000_001, currency: 'USD' });
    expect(decimalToMicros('50.000001')).toBe(50_000_001);
  });

  it('converts exact micro-dollar amounts, including float-sensitive values', async () => {
    expect([1, 999_999, 50_000_000, 3_333_333].map(microsToDecimal)).toEqual([
      '0.000001', '0.999999', '50.00', '3.333333',
    ]);
    const sentValues: string[] = [];
    const provider = new PayPalSandboxProvider(credentials, { fetcher: async (input, init) => {
      if (String(input).endsWith('/v1/oauth2/token')) return jsonResponse({ access_token: 'token' });
      const body = JSON.parse(String(init?.body)) as { purchase_units: { amount: { value: string } }[] };
      sentValues.push(body.purchase_units[0].amount.value);
      return jsonResponse({ id: `ORDER-${sentValues.length}`, status: 'CREATED' });
    } });
    for (const amountMicros of [1, 999_999, 50_000_000, 3_333_333]) {
      await provider.createOrder({ amountMicros, idempotencyKey: `money-${amountMicros}` });
    }
    expect(sentValues).toEqual(['0.000001', '0.999999', '50.00', '3.333333']);
  });
});

describe('simulated provider', () => {
  it('labels itself SIMULATED and returns deterministic provider references', async () => {
    const provider = new SimulatedPaymentProvider();
    const input = { amountMicros: 1_999_999, currency: 'USD', idempotencyKey: 'sim-key' };
    const one = await provider.createOrder(input);
    const two = await provider.createOrder(input);
    expect(provider.label).toBe('SIMULATED');
    expect(one.orderId).toMatch(/^SIMULATED-ORDER-/);
    expect(two.orderId).toBe(one.orderId);
    const capture1 = await provider.captureOrder({ orderId: one.orderId, idempotencyKey: 'capture-key' });
    const capture2 = await provider.captureOrder({ orderId: one.orderId, idempotencyKey: 'capture-key' });
    expect(capture1.captureId).toMatch(/^SIMULATED-CAPTURE-/);
    expect(capture2).toEqual(capture1);
    expect(capture1.amountMicros).toBe(1_999_999);
  });
});

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
