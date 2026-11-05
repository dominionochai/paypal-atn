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
    mockFetch.mockResolvedValueOnce({ ok: true, json: async () => ({ id: mockOrderId }), headers: new Map() });
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

  describe('authorize', () => {
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
      expect(mockFetch).toHaveBeenCalledTimes(3); // token + order + authorize
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
      let callCount = 0;
      mockFetch
        .mockResolvedValueOnce({ ok: false, status: 500, text: async () => 'server error', headers: new Map() })
        .mockResolvedValueOnce({ ok: false, status: 500, text: async () => 'server error', headers: new Map() })
        .mockResolvedValueOnce({ ok: true, json: async () => ({ purchase_units: [{ payments: { authorizations: [{ id: mockAuthId }] } }] }), headers: new Map() });

      const result = await adapter.authorize({ amount: 100000, currency: 'USD', idempotencyKey: 'retry-test', escrowId: 'e' });
      expect(result.ref).toBe(mockAuthId);
      // token + order + 3 authorize attempts = 5 calls
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
      // 50000 micro-dollars = $0.05
      expect(body.amount.value).toBe('0.05');
    });
  });

  describe('voidAuthorization', () => {
    it('voids an authorization', async () => {
      setupTokenSuccess();
      setupVoidSuccess();

      await adapter.voidAuthorization({ authRef: mockAuthId, idempotencyKey: 'test-void-1' });
      expect(mockFetch).toHaveBeenCalledTimes(2); // token + void
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
      // The payout method checks for PAYPAL_PAYEE_EMAIL before making the token request
      await expect(adapter.payout({ amount: 100000, currency: 'USD', payeeRef: 'p', idempotencyKey: 'k' }))
        .rejects.toBeInstanceOf(MissingCredentialsError);
    });
  });

  describe('refund', () => {
    it('refunds a capture', async () => {
      setupTokenSuccess();
      setupRefundSuccess();

      await adapter.refund({ captureRef: mockCaptureId, amount: 100000, idempotencyKey: 'test-refund-1' });
      expect(mockFetch).toHaveBeenCalledTimes(2); // token + refund
    });
  });

  describe('charge (legacy)', () => {
    it('creates CAPTURE order and captures it', async () => {
      setupTokenSuccess();
      setupOrderCreateSuccess();
      // charge captures the order, so we need a capture response with purchase_units structure
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
});