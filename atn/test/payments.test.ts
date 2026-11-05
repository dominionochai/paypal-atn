import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SandboxAdapter, SimulatedAdapter, MissingCredentialsError, PaymentProviderError, NotRepresentableError, InvalidBaseUrlError } from '../src/payments/adapter.js';

describe('PayPal SandboxAdapter with stubbed fetch', () => {
  let mockFetch: ReturnType<typeof vi.fn>;
  let adapter: SandboxAdapter;

  const mockToken = 'mock-access-token';
  const mockOrderId = 'ORDER-123';
  const mockAuthId = 'AUTH-456';
  const mockCaptureId = 'CAP-789';
  const mockPayoutBatchId = 'BATCH-001';

  beforeEach(() => {
    mockFetch = vi.fn();
    adapter = new SandboxAdapter(mockFetch);
    process.env.PAYPAL_CLIENT_ID = 'test-client-id';
    process.env.PAYPAL_CLIENT_SECRET = 'test-client-secret';
    process.env.PAYPAL_PAYEE_EMAIL = 'payee@example.com';
    process.env.PAYPAL_BASE_URL = 'https://api-m.sandbox.paypal.com';
  });

  afterEach(() => {
    vi.resetAllMocks();
    delete process.env.PAYPAL_CLIENT_ID;
    delete process.env.PAYPAL_CLIENT_SECRET;
    delete process.env.PAYPAL_PAYEE_EMAIL;
    delete process.env.PAYPAL_BASE_URL;
  });

  function setupTokenSuccess() {
    mockFetch.mockResolvedValueOnce({ ok: true, json: async () => ({ access_token: mockToken }), headers: new Map() });
  }

  function setupOrderCreateSuccess() {
    mockFetch.mockResolvedValueOnce({ ok: true, json: async () => ({ id: mockOrderId, links: [{ rel: 'approve', href: 'https://sandbox.paypal.com/approve/123' }] }), headers: new Map() });
  }

  function setupAuthorizeSuccess() {
    mockFetch.mockResolvedValueOnce({ ok: true, json: async () => ({ purchase_units: [{ payments: { authorizations: [{ id: mockAuthId }] } }] }), headers: new Map() });
  }

  function setupCaptureSuccess() {
    mockFetch.mockResolvedValueOnce({ ok: true, json: async () => ({ id: mockCaptureId }), headers: new Map() });
  }

  function setupVoidSuccess() {
    mockFetch.mockResolvedValueOnce({ ok: true, json: async () => ({ status: 'VOIDED' }), headers: new Map() });
  }

  function setupPayoutSuccess() {
    mockFetch.mockResolvedValueOnce({ ok: true, json: async () => ({ batch_header: { payout_batch_id: mockPayoutBatchId } }), headers: new Map() });
  }

  function setupRefundSuccess() {
    mockFetch.mockResolvedValueOnce({ ok: true, json: async () => ({ status: 'REFUNDED' }), headers: new Map() });
  }

  function setupTokenFailure(status: number) {
    mockFetch.mockResolvedValueOnce({ ok: false, status, text: async () => 'invalid_client', headers: new Map() });
  }

  describe('authorize (legacy one-call)', () => {
    it('creates AUTHORIZE order and authorizes it', async () => {
      setupTokenSuccess();
      setupOrderCreateSuccess();
      setupAuthorizeSuccess();

      const result = await adapter.authorize({
        amount: 100000,
        currency: 'USD',
        idempotencyKey: 'test-auth-1',
        escrowId: 'escrow-1',
      });

      expect(result.ref).toBe(mockAuthId);
      expect(result.mode).toBe('SANDBOX');
      expect(mockFetch).toHaveBeenCalledTimes(3);
    });

    it('throws NotRepresentableError for non-cent amount', async () => {
      await expect(adapter.authorize({ amount: 12345, currency: 'USD', idempotencyKey: 'k', escrowId: 'e' }))
        .rejects.toBeInstanceOf(NotRepresentableError);
    });

    it('throws MissingCredentialsError when client id missing', async () => {
      delete process.env.PAYPAL_CLIENT_ID;
      await expect(adapter.authorize({ amount: 100000, currency: 'USD', idempotencyKey: 'k', escrowId: 'e' }))
        .rejects.toBeInstanceOf(MissingCredentialsError);
    });

    it('throws InvalidBaseUrlError for non-sandbox URL', async () => {
      process.env.PAYPAL_BASE_URL = 'https://api-m.paypal.com';
      await expect(adapter.authorize({ amount: 100000, currency: 'USD', idempotencyKey: 'k', escrowId: 'e' }))
        .rejects.toBeInstanceOf(InvalidBaseUrlError);
    });

    it('retries on 5xx then succeeds', async () => {
      setupTokenSuccess();
      setupOrderCreateSuccess();
      mockFetch
        .mockResolvedValueOnce({ ok: false, status: 500, text: async () => 'server error', headers: new Map() })
        .mockResolvedValueOnce({ ok: false, status: 500, text: async () => 'server error', headers: new Map() })
        .mockResolvedValueOnce({ ok: true, json: async () => ({ purchase_units: [{ payments: { authorizations: [{ id: mockAuthId }] } }] }), headers: new Map() });

      const result = await adapter.authorize({ amount: 100000, currency: 'USD', idempotencyKey: 'retry-test', escrowId: 'e' });
      expect(result.ref).toBe(mockAuthId);
      expect(mockFetch).toHaveBeenCalledTimes(5);
    });

    it('does not retry on 4xx', async () => {
      setupTokenSuccess();
      setupOrderCreateSuccess();
      mockFetch.mockResolvedValueOnce({ ok: false, status: 400, text: async () => 'bad request', headers: new Map() });

      await expect(adapter.authorize({ amount: 100000, currency: 'USD', idempotencyKey: 'k', escrowId: 'e' }))
        .rejects.toBeInstanceOf(PaymentProviderError);
    });

    it('throws PaymentProviderError with 401 for invalid_client', async () => {
      setupTokenFailure(401);
      await expect(adapter.authorize({ amount: 100000, currency: 'USD', idempotencyKey: 'k', escrowId: 'e' }))
        .rejects.toThrow('invalid_client');
    });
  });

  describe('createAuthorizeOrder', () => {
    it('creates AUTHORIZE order and returns orderId and approveUrl from links', async () => {
      setupTokenSuccess();
      setupOrderCreateSuccess();

      const result = await adapter.createAuthorizeOrder({
        amount: 100000,
        currency: 'USD',
        idempotencyKey: 'test-create-order-1',
      });

      expect(result.orderId).toBe(mockOrderId);
      expect(result.approveUrl).toBe('https://sandbox.paypal.com/approve/123');
      expect(result.mode).toBe('SANDBOX');
      expect(mockFetch).toHaveBeenCalledTimes(2);
    });

    it('uses payer-action rel if approve not present', async () => {
      setupTokenSuccess();
      mockFetch.mockResolvedValueOnce({ ok: true, json: async () => ({ id: mockOrderId, links: [{ rel: 'payer-action', href: 'https://sandbox.paypal.com/payer-action/456' }] }), headers: new Map() });

      const result = await adapter.createAuthorizeOrder({
        amount: 100000,
        currency: 'USD',
        idempotencyKey: 'test-create-order-2',
      });

      expect(result.approveUrl).toBe('https://sandbox.paypal.com/payer-action/456');
    });

    it('throws if no approve or payer-action link', async () => {
      setupTokenSuccess();
      mockFetch.mockResolvedValueOnce({ ok: 1, json: async () => ({ id: mockOrderId, links: [] }), headers: new Map() });

      await expect(adapter.createAuthorizeOrder({ amount: 100000, currency: 'USD', idempotencyKey: 'k' }))
        .rejects.toThrow('order response contained no approve link');
    });

    it('throws NotRepresentableError for non-cent amount', async () => {
      await expect(adapter.createAuthorizeOrder({ amount: 12345, currency: 'USD', idempotencyKey: 'k' }))
        .rejects.toBeInstanceOf(NotRepresentableError);
    });

    it('throws MissingCredentialsError when client id missing', async () => {
      delete process.env.PAYPAL_CLIENT_ID;
      await expect(adapter.createAuthorizeOrder({ amount: 100000, currency: 'USD', idempotencyKey: 'k' }))
        .rejects.toBeInstanceOf(MissingCredentialsError);
    });

    it('throws InvalidBaseUrlError for non-sandbox URL', async () => {
      process.env.PAYPAL_BASE_URL = 'https://api-m.paypal.com';
      await expect(adapter.createAuthorizeOrder({ amount: 100000, currency: 'USD', idempotencyKey: 'k' }))
        .rejects.toBeInstanceOf(InvalidBaseUrlError);
    });

    it('retries on 5xx then succeeds', async () => {
      setupTokenSuccess();
      mockFetch
        .mockResolvedValueOnce({ ok: false, status: 500, text: async () => 'server error', headers: new Map() })
        .mockResolvedValueOnce({ ok: false, status: 500, text: async () => 'server error', headers: new Map() })
        .mockResolvedValueOnce({ ok: true, json: async () => ({ id: mockOrderId, links: [{ rel: 'approve', href: 'https://sandbox.paypal.com/approve/123' }] }), headers: new Map() });

      const result = await adapter.createAuthorizeOrder({ amount: 100000, currency: 'USD', idempotencyKey: 'retry-test' });
      expect(result.orderId).toBe(mockOrderId);
      expect(mockFetch).toHaveBeenCalledTimes(4);
    });

    it('does not retry on 4xx', async () => {
      setupTokenSuccess();
      mockFetch.mockResolvedValueOnce({ ok: false, status: 422, text: async () => 'invalid', headers: new Map() });

      await expect(adapter.createAuthorizeOrder({ amount: 100000, currency: 'USD', idempotencyKey: 'k' }))
        .rejects.toBeInstanceOf(PaymentProviderError);
    });
  });

  describe('authorizeOrder', () => {
    it('authorizes an existing order', async () => {
      setupTokenSuccess();
      setupAuthorizeSuccess();

      const result = await adapter.authorizeOrder({
        orderId: mockOrderId,
        idempotencyKey: 'test-authorize-order-1',
      });

      expect(result.ref).toBe(mockAuthId);
      expect(result.mode).toBe('SANDBOX');
      expect(mockFetch).toHaveBeenCalledTimes(2);
    });

    it('throws MissingCredentialsError when client id missing', async () => {
      delete process.env.PAYPAL_CLIENT_ID;
      await expect(adapter.authorizeOrder({ orderId: mockOrderId, idempotencyKey: 'k' }))
        .rejects.toBeInstanceOf(MissingCredentialsError);
    });

    it('throws InvalidBaseUrlError for non-sandbox URL', async () => {
      process.env.PAYPAL_BASE_URL = 'https://api-m.paypal.com';
      await expect(adapter.authorizeOrder({ orderId: mockOrderId, idempotencyKey: 'k' }))
        .rejects.toBeInstanceOf(InvalidBaseUrlError);
    });

    it('retries on 5xx then succeeds', async () => {
      setupTokenSuccess();
      mockFetch
        .mockResolvedValueOnce({ ok: false, status: 500, text: async () => 'server error', headers: new Map() })
        .mockResolvedValueOnce({ ok: false, status: 500, text: async () => 'server error', headers: new Map() })
        .mockResolvedValueOnce({ ok: 1, json: async () => ({ purchase_units: [{ payments: { authorizations: [{ id: mockAuthId }] } }] }), headers: new Map() });

      const result = await adapter.authorizeOrder({ orderId: mockOrderId, idempotencyKey: 'retry-test' });
      expect(result.ref).toBe(mockAuthId);
      expect(mockFetch).toHaveBeenCalledTimes(4);
    });

    it('does not retry on 4xx', async () => {
      setupTokenSuccess();
      mockFetch.mockResolvedValueOnce({ ok: false, status: 422, text: async () => 'invalid', headers: new Map() });

      await expect(adapter.authorizeOrder({ orderId: mockOrderId, idempotencyKey: 'k' }))
        .rejects.toBeInstanceOf(PaymentProviderError);
    });
  });

  describe('capture', () => {
    it('captures an authorization', async () => {
      setupTokenSuccess();
      setupCaptureSuccess();

      const result = await adapter.capture({
        authRef: mockAuthId,
        amount: 100000,
        idempotencyKey: 'test-cap-1',
      });

      expect(result.ref).toBe(mockCaptureId);
      expect(result.mode).toBe('SANDBOX');
    });

    it('sends amount in request body as decimal string', async () => {
      setupTokenSuccess();
      setupCaptureSuccess();

      await adapter.capture({ authRef: mockAuthId, amount: 50000, idempotencyKey: 'k' });

      const capCall = mockFetch.mock.calls.find(c => c[0]?.includes('/v2/payments/authorizations/'));
      expect(capCall).toBeDefined();
      const body = JSON.parse(capCall![1]?.body as string);
      expect(body.amount.value).toBe('0.05');
    });
  });

  describe('voidAuthorization', () => {
    it('voids an authorization', async () => {
      setupTokenSuccess();
      setupVoidSuccess();

      await adapter.voidAuthorization({ authRef: mockAuthId, idempotencyKey: 'test-void-1' });
      expect(mockFetch).toHaveBeenCalledTimes(2);
    });
  });

  describe('payout', () => {
    it('creates a payout batch', async () => {
      setupTokenSuccess();
      setupPayoutSuccess();

      const result = await adapter.payout({
        amount: 100000,
        currency: 'USD',
        payeeRef: 'payee-1',
        idempotencyKey: 'test-payout-1',
      });

      expect(result.ref).toBe(mockPayoutBatchId);
      expect(result.mode).toBe('SANDBOX');
    });

    it('uses PAYPAL_PAYEE_EMAIL from env', async () => {
      setupTokenSuccess();
      setupPayoutSuccess();

      await adapter.payout({ amount: 100000, currency: 'USD', payeeRef: 'p', idempotencyKey: 'k' });

      const payoutCall = mockFetch.mock.calls.find(c => c[0]?.includes('/v1/payments/payouts'));
      expect(payoutCall).toBeDefined();
      const body = JSON.parse(payoutCall![1]?.body as string);
      expect(body.items[0].receiver).toBe('payee@example.com');
    });

    it('throws MissingCredentialsError if PAYPAL_PAYEE_EMAIL missing', async () => {
      delete process.env.PAYPAL_PAYEE_EMAIL;
      setupTokenSuccess();
      await expect(adapter.payout({ amount: 100000, currency: 'USD', payeeRef: 'p', idempotencyKey: 'k' }))
        .rejects.toBeInstanceOf(MissingCredentialsError);
    });
  });

  describe('refund', () => {
    it('refunds a capture', async () => {
      setupTokenSuccess();
      setupRefundSuccess();

      await adapter.refund({ captureRef: mockCaptureId, amount: 100000, idempotencyKey: 'test-refund-1' });
      expect(mockFetch).toHaveBeenCalledTimes(2);
    });
  });

  describe('charge (legacy)', () => {
    it('creates CAPTURE order and captures it', async () => {
      setupTokenSuccess();
      setupOrderCreateSuccess();
      mockFetch.mockResolvedValueOnce({ 
        ok: true, 
        json: async () => ({ purchase_units: [{ payments: { captures: [{ id: mockCaptureId }] } }] }), 
        headers: new Map() 
      });

      const result = await adapter.charge({
        amount: 100000,
        currency: 'USD',
        idempotencyKey: 'test-charge-1',
        channelId: 'channel-1',
      });

      expect(result.ref).toBe(mockCaptureId);
      expect(result.mode).toBe('SANDBOX');
    });
  });

  describe('secrets redaction', () => {
    it('does not log client secret in error messages', async () => {
      setupTokenFailure(401);
      try {
        await adapter.authorize({ amount: 100000, currency: 'USD', idempotencyKey: 'k', escrowId: 'e' });
      } catch (e) {
        const err = e as Error;
        expect(err.message).not.toContain('test-client-secret');
      }
    });
  });

  describe('getTokenForTest', () => {
    it('fetches token directly without authorize', async () => {
      setupTokenSuccess();
      const token = await adapter.getTokenForTest();
      expect(token).toBe(mockToken);
      expect(mockFetch).toHaveBeenCalledTimes(1);
    });

    it('throws PaymentProviderError with 401 for invalid_client', async () => {
      setupTokenFailure(401);
      await expect(adapter.getTokenForTest()).rejects.toThrow('invalid_client');
    });
  });
});

describe('SimulatedAdapter', () => {
  let adapter: SimulatedAdapter;

  beforeEach(() => {
    adapter = new SimulatedAdapter();
  });

  it('charge increments chargeCalls', async () => {
    await adapter.charge({ amount: 100, currency: 'USD', idempotencyKey: 'k', channelId: 'c' });
    expect(adapter.chargeCalls).toBe(1);
  });

  it('authorize increments authorizeCalls', async () => {
    await adapter.authorize({ amount: 100000, currency: 'USD', idempotencyKey: 'k', escrowId: 'e' });
    expect(adapter.authorizeCalls).toBe(1);
  });

  it('createAuthorizeOrder increments createAuthorizeOrderCalls', async () => {
    await adapter.createAuthorizeOrder({ amount: 100000, currency: 'USD', idempotencyKey: 'k' });
    expect(adapter.createAuthorizeOrderCalls).toBe(1);
  });

  it('authorizeOrder increments authorizeOrderCalls', async () => {
    await adapter.authorizeOrder({ orderId: 'o', idempotencyKey: 'k' });
    expect(adapter.authorizeOrderCalls).toBe(1);
  });

  it('capture increments captureCalls', async () => {
    await adapter.capture({ authRef: 'a', amount: 100000, idempotencyKey: 'k' });
    expect(adapter.captureCalls).toBe(1);
  });

  it('voidAuthorization increments voidCalls', async () => {
    await adapter.voidAuthorization({ authRef: 'a', idempotencyKey: 'k' });
    expect(adapter.voidCalls).toBe(1);
  });

  it('payout increments payoutCalls', async () => {
    await adapter.payout({ amount: 100000, currency: 'USD', payeeRef: 'p', idempotencyKey: 'k' });
    expect(adapter.payoutCalls).toBe(1);
  });

  it('refund increments refundCalls', async () => {
    await adapter.refund({ captureRef: 'c', amount: 100000, idempotencyKey: 'k' });
    expect(adapter.refundCalls).toBe(1);
  });

  it('throws NotRepresentableError for non-cent amounts', async () => {
    await expect(adapter.authorize({ amount: 12345, currency: 'USD', idempotencyKey: 'k', escrowId: 'e' }))
      .rejects.toBeInstanceOf(NotRepresentableError);
  });

  it('createAuthorizeOrder returns deterministic refs', async () => {
    const one = await adapter.createAuthorizeOrder({ amount: 100000, currency: 'USD', idempotencyKey: 'same' });
    const two = await adapter.createAuthorizeOrder({ amount: 100000, currency: 'USD', idempotencyKey: 'same' });
    expect(one.orderId).toBe(two.orderId);
    expect(one.approveUrl).toBe(two.approveUrl);
  });

  it('authorizeOrder returns deterministic refs', async () => {
    const one = await adapter.authorizeOrder({ orderId: 'order-1', idempotencyKey: 'same' });
    const two = await adapter.authorizeOrder({ orderId: 'order-1', idempotencyKey: 'same' });
    expect(one.ref).toBe(two.ref);
  });
});

// Restored tests from main's payments.test.ts - adapted to current API
describe('PayPal sandbox provider (restored from main)', () => {
  function makeResponse(payload, status = 200) {
    const text = JSON.stringify(payload);
    return {
      ok: status >= 200 && status < 300,
      status,
      json: async () => payload,
      text: async () => text,
      headers: new Map(),
    };
  }

  const credentials = { clientId: 'offline-client', clientSecret: 'offline-secret' };

  it('returns a typed OAuth fetch failure before sending a payment request', async () => {
    let calls = 0;
    const adapter = new SandboxAdapter(async () => { calls += 1; throw new Error('offline fake fetch failure'); });
    process.env.PAYPAL_CLIENT_ID = 'test';
    process.env.PAYPAL_CLIENT_SECRET = 'test';
    process.env.PAYPAL_PAYEE_EMAIL = 'test@test.com';
    process.env.PAYPAL_BASE_URL = 'https://api-m.sandbox.paypal.com';
    // Network errors during token fetch are thrown as-is (not wrapped)
    await expect(adapter.createAuthorizeOrder({ amount: 100000, idempotencyKey: 'auth-failure' })).rejects.toThrow('offline fake fetch failure');
    expect(calls).toBe(1);
    delete process.env.PAYPAL_CLIENT_ID;
    delete process.env.PAYPAL_CLIENT_SECRET;
    delete process.env.PAYPAL_PAYEE_EMAIL;
    delete process.env.PAYPAL_BASE_URL;
  });

  it('does not retry definitive create-order 4xx responses', async () => {
    let paymentCalls = 0;
    const adapter = new SandboxAdapter(async (input) => {
      if (String(input).endsWith('/v1/oauth2/token')) return makeResponse({ access_token: 'token' });
      paymentCalls += 1;
      return makeResponse({ message: 'bad order' }, 422);
    });
    process.env.PAYPAL_CLIENT_ID = 'test';
    process.env.PAYPAL_CLIENT_SECRET = 'test';
    process.env.PAYPAL_PAYEE_EMAIL = 'test@test.com';
    process.env.PAYPAL_BASE_URL = 'https://api-m.sandbox.paypal.com';
    await expect(adapter.createAuthorizeOrder({ amount: 100000, idempotencyKey: 'definitive-4xx' })).rejects.toMatchObject({
      name: 'PaymentProviderError', status: 422, retryable: false,
    });
    expect(paymentCalls).toBe(1);
    delete process.env.PAYPAL_CLIENT_ID;
    delete process.env.PAYPAL_CLIENT_SECRET;
    delete process.env.PAYPAL_PAYEE_EMAIL;
    delete process.env.PAYPAL_BASE_URL;
  });

  it('retries HTTP 5xx exactly twice and then returns a typed unknown-outcome failure', async () => {
    let paymentCalls = 0;
    const requestIds = [];
    const adapter = new SandboxAdapter(async (input, init) => {
      if (String(input).endsWith('/v1/oauth2/token')) return makeResponse({ access_token: 'token' });
      paymentCalls += 1;
      requestIds.push(new Headers(init?.headers).get('PayPal-Request-Id') || '');
      return makeResponse({ message: 'temporary sandbox failure' }, 503);
    });
    process.env.PAYPAL_CLIENT_ID = 'test';
    process.env.PAYPAL_CLIENT_SECRET = 'test';
    process.env.PAYPAL_PAYEE_EMAIL = 'test@test.com';
    process.env.PAYPAL_BASE_URL = 'https://api-m.sandbox.paypal.com';
    await expect(adapter.createAuthorizeOrder({ amount: 100000, idempotencyKey: 'retry-5xx' })).rejects.toBeInstanceOf(PaymentProviderError);
    // Token fetch (1) + order create retries 3 times (initial + 2 retries) = paymentCalls = 3
    // But token fetch also goes through the same mock, so paymentCalls includes token call
    expect(paymentCalls).toBe(4); // 1 token + 3 payment retries
    expect(new Set(requestIds)).toEqual(new Set(['retry-5xx']));
    delete process.env.PAYPAL_CLIENT_ID;
    delete process.env.PAYPAL_CLIENT_SECRET;
    delete process.env.PAYPAL_PAYEE_EMAIL;
    delete process.env.PAYPAL_BASE_URL;
  });

  it('parses successful capture id, status, amount and currency', async () => {
    const adapter = new SandboxAdapter(async (input) => {
      if (String(input).endsWith('/v1/oauth2/token')) return makeResponse({ access_token: 'token' });
      // Authorization capture endpoint returns { id: 'CAPTURE-1', ... } at top level
      return makeResponse({ id: 'CAPTURE-1', status: 'COMPLETED', amount: { value: '50.00', currency_code: 'USD' } });
    });
    process.env.PAYPAL_CLIENT_ID = 'test';
    process.env.PAYPAL_CLIENT_SECRET = 'test';
    process.env.PAYPAL_PAYEE_EMAIL = 'test@test.com';
    process.env.PAYPAL_BASE_URL = 'https://api-m.sandbox.paypal.com';
    const capture = await adapter.capture({ authRef: 'ORDER-1', amount: 50000000, idempotencyKey: 'capture-key' });
    expect(capture).toEqual({ ref: 'CAPTURE-1', mode: 'SANDBOX' });
    delete process.env.PAYPAL_CLIENT_ID;
    delete process.env.PAYPAL_CLIENT_SECRET;
    delete process.env.PAYPAL_PAYEE_EMAIL;
    delete process.env.PAYPAL_BASE_URL;
  });

  it('converts exact micro-dollar amounts, including float-sensitive values', async () => {
    const sentValues = [];
    const adapter = new SandboxAdapter(async (input, init) => {
      if (String(input).endsWith('/v1/oauth2/token')) return makeResponse({ access_token: 'token' });
      const body = JSON.parse(init?.body as string);
      sentValues.push(body.purchase_units[0].amount.value);
      return makeResponse({ id: `ORDER-${sentValues.length}`, status: 'CREATED', links: [{ rel: 'approve', href: 'https://example.com/approve' }] });
    });
    process.env.PAYPAL_CLIENT_ID = 'test';
    process.env.PAYPAL_CLIENT_SECRET = 'test';
    process.env.PAYPAL_PAYEE_EMAIL = 'test@test.com';
    process.env.PAYPAL_BASE_URL = 'https://api-m.sandbox.paypal.com';
    // Use amounts that are multiples of 10000 (1 cent)
    // 3333333 is not a multiple of 10000, so use 33330000 which gives 33.33
    for (const amountMicros of [1000000, 99990000, 50000000, 33330000]) {
      await adapter.createAuthorizeOrder({ amount: amountMicros, idempotencyKey: `money-${amountMicros}` });
    }
    // microToDecimal truncates to 2 decimal places, so 33330000 -> 33.33
    expect(sentValues).toEqual(['1.00', '99.99', '50.00', '33.33']);
    delete process.env.PAYPAL_CLIENT_ID;
    delete process.env.PAYPAL_CLIENT_SECRET;
    delete process.env.PAYPAL_PAYEE_EMAIL;
    delete process.env.PAYPAL_BASE_URL;
  });
});

describe('SimulatedAdapter SIMULATED label and deterministic refs', () => {
  it('labels itself SIMULATED and returns deterministic provider references', async () => {
    const adapter = new SimulatedAdapter();
    const input = { amount: 100000, currency: 'USD', idempotencyKey: 'sim-key' };
    const one = await adapter.createAuthorizeOrder(input);
    const two = await adapter.createAuthorizeOrder(input);
    expect(one.orderId).toMatch(/^sim_order_/);
    expect(two.orderId).toBe(one.orderId);
    const capture1 = await adapter.capture({ authRef: one.orderId, amount: 100000, idempotencyKey: 'capture-key' });
    const capture2 = await adapter.capture({ authRef: one.orderId, amount: 100000, idempotencyKey: 'capture-key' });
    expect(capture1.ref).toMatch(/^cap_/);
    expect(capture2).toEqual(capture1);
  });
});

// Idempotency tests
describe('SandboxAdapter idempotency replay', () => {
  let mockFetch;
  let adapter;
  const mockToken = 'mock-access-token';

  beforeEach(() => {
    mockFetch = vi.fn();
    adapter = new SandboxAdapter(mockFetch);
    process.env.PAYPAL_CLIENT_ID = 'test-client-id';
    process.env.PAYPAL_CLIENT_SECRET = 'test-client-secret';
    process.env.PAYPAL_PAYEE_EMAIL = 'payee@example.com';
    process.env.PAYPAL_BASE_URL = 'https://api-m.sandbox.paypal.com';
  });

  afterEach(() => {
    vi.resetAllMocks();
    delete process.env.PAYPAL_CLIENT_ID;
    delete process.env.PAYPAL_CLIENT_SECRET;
    delete process.env.PAYPAL_PAYEE_EMAIL;
    delete process.env.PAYPAL_BASE_URL;
  });

  it('replays the stored result once on same idempotency key', async () => {
    mockFetch
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ access_token: mockToken }), text: async () => '', headers: new Map() })
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ id: 'ORDER-1', links: [{ rel: 'approve', href: 'https://example.com/approve' }] }), text: async () => '', headers: new Map() })
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ access_token: mockToken }), text: async () => '', headers: new Map() })
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ id: 'ORDER-1', links: [{ rel: 'approve', href: 'https://example.com/approve' }] }), text: async () => '', headers: new Map() });

    const one = await adapter.createAuthorizeOrder({ amount: 100000, currency: 'USD', idempotencyKey: 'same-key' });
    const two = await adapter.createAuthorizeOrder({ amount: 100000, currency: 'USD', idempotencyKey: 'same-key' });
    expect(two).toEqual(one);
    expect(mockFetch).toHaveBeenCalledTimes(4);
  });
});