export type PaymentMode = 'SIMULATED' | 'SANDBOX' | 'LIVE';
export interface ChargeRequest { amount: number; currency: string; idempotencyKey: string; channelId: string; }
export interface ChargeResult { ref: string; mode: PaymentMode; }
export interface AuthorizeRequest { amount: number; currency: string; idempotencyKey: string; escrowId: string; }
export interface AuthorizeResult { ref: string; mode: PaymentMode; }
export interface CaptureRequest { authRef: string; amount: number; idempotencyKey: string; }
export interface CaptureResult { ref: string; mode: PaymentMode; }
export interface VoidRequest { authRef: string; idempotencyKey: string; }
export interface PayoutRequest { amount: number; currency: string; payeeRef: string; idempotencyKey: string; }
export interface PayoutResult { ref: string; mode: PaymentMode; }
export interface RefundRequest { captureRef: string; amount: number; idempotencyKey: string; }

export interface CreateAuthorizeOrderRequest { amount: number; currency: string; idempotencyKey: string; }
export interface CreateAuthorizeOrderResult { orderId: string; approveUrl: string; mode: PaymentMode; }
export interface AuthorizeOrderRequest { orderId: string; idempotencyKey: string; }
export interface AuthorizeOrderResult { ref: string; mode: PaymentMode; }

export interface PaymentAdapter {
  charge(req: ChargeRequest): Promise<ChargeResult>;
  authorize(req: AuthorizeRequest): Promise<AuthorizeResult>;
  createAuthorizeOrder(req: CreateAuthorizeOrderRequest): Promise<CreateAuthorizeOrderResult>;
  authorizeOrder(req: AuthorizeOrderRequest): Promise<AuthorizeOrderResult>;
  capture(req: CaptureRequest): Promise<CaptureResult>;
  voidAuthorization(req: VoidRequest): Promise<void>;
  payout(req: PayoutRequest): Promise<PayoutResult>;
  refund(req: RefundRequest): Promise<void>;
}

export class MissingCredentialsError extends Error {
  constructor(missing: string[]) {
    super(`missing PayPal credentials: ${missing.join(', ')}`);
    this.name = 'MissingCredentialsError';
  }
}

export class PaymentProviderError extends Error {
  public readonly status: number | undefined;
  public readonly retryable: boolean;
  constructor(message: string, status?: number, retryable = false) {
    super(message);
    this.name = 'PaymentProviderError';
    this.status = status;
    this.retryable = retryable;
  }
}

export class NotRepresentableError extends Error {
  constructor(amount: number) {
    super(`amount ${amount} micro-dollars is not a multiple of 10000 (1 cent)`);
    this.name = 'NotRepresentableError';
  }
}

export class InvalidBaseUrlError extends Error {
  constructor(url: string) {
    super(`PAYPAL_BASE_URL must be https://api-m.sandbox.paypal.com, got ${url}`);
    this.name = 'InvalidBaseUrlError';
  }
}

function assertRepresentable(amount: number): void {
  if (amount % 10000 !== 0) {
    throw new NotRepresentableError(amount);
  }
}

function assertSandboxBaseUrl(url: string): void {
  if (url !== 'https://api-m.sandbox.paypal.com') {
    throw new InvalidBaseUrlError(url);
  }
}

export class SimulatedAdapter implements PaymentAdapter {
  public chargeCalls = 0;
  public authorizeCalls = 0;
  public createAuthorizeOrderCalls = 0;
  public authorizeOrderCalls = 0;
  public captureCalls = 0;
  public voidCalls = 0;
  public payoutCalls = 0;
  public refundCalls = 0;

  async charge(req: ChargeRequest): Promise<ChargeResult> {
    this.chargeCalls++;
    return { ref: `sim_${req.channelId}_${req.idempotencyKey}`, mode: 'SIMULATED' };
  }

  async authorize(req: AuthorizeRequest): Promise<AuthorizeResult> {
    this.authorizeCalls++;
    assertRepresentable(req.amount);
    return { ref: `auth_${req.escrowId}_${req.idempotencyKey}`, mode: 'SIMULATED' };
  }

  async createAuthorizeOrder(req: CreateAuthorizeOrderRequest): Promise<CreateAuthorizeOrderResult> {
    this.createAuthorizeOrderCalls++;
    assertRepresentable(req.amount);
    return { orderId: `sim_order_${req.idempotencyKey}`, approveUrl: `https://sim.example.com/approve/${req.idempotencyKey}`, mode: 'SIMULATED' };
  }

  async authorizeOrder(req: AuthorizeOrderRequest): Promise<AuthorizeOrderResult> {
    this.authorizeOrderCalls++;
    return { ref: `auth_${req.orderId}_${req.idempotencyKey}`, mode: 'SIMULATED' };
  }

  async capture(req: CaptureRequest): Promise<CaptureResult> {
    this.captureCalls++;
    assertRepresentable(req.amount);
    return { ref: `cap_${req.authRef}_${req.idempotencyKey}`, mode: 'SIMULATED' };
  }

  async voidAuthorization(_req: VoidRequest): Promise<void> {
    this.voidCalls++;
  }

  async payout(req: PayoutRequest): Promise<PayoutResult> {
    this.payoutCalls++;
    assertRepresentable(req.amount);
    return { ref: `payout_${req.payeeRef}_${req.idempotencyKey}`, mode: 'SIMULATED' };
  }

  async refund(req: RefundRequest): Promise<void> {
    this.refundCalls++;
    assertRepresentable(req.amount);
  }
}

export function microToDecimal(amount: number): string {
  if (!Number.isSafeInteger(amount) || amount < 0) throw new Error('amount must be a non-negative integer in micro-dollars');
  const whole = Math.floor(amount / 1000000);
  const frac = amount % 1000000;
  return `${whole}.${frac.toString().padStart(6, '0').slice(0, 2)}`;
}

interface FetchOptions extends RequestInit {
  headers?: Record<string, string>;
}

async function fetchWithRetry(
  fetchImpl: typeof fetch,
  url: string,
  options: FetchOptions,
  idempotencyKey: string,
  maxRetries = 3
): Promise<unknown> {
  let lastError: Error | null = null;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    const headers = new Headers(options.headers);
    headers.set('PayPal-Request-Id', idempotencyKey);
    const res = await fetchImpl(url, { ...options, headers });
    if (res.ok) return res.json();
    if (res.status === 429 || res.status >= 500) {
      lastError = new Error(`HTTP ${res.status}: ${await res.text()}`);
      if (attempt < maxRetries) {
        await new Promise(r => setTimeout(r, 1000 * (attempt + 1)));
        continue;
      }
    }
    throw new PaymentProviderError(await res.text(), res.status, res.status === 429 || res.status >= 500);
  }
  throw lastError!;
}

interface TokenResponse { access_token: string; }

export class SandboxAdapter implements PaymentAdapter {
  private readonly fetchImpl: typeof fetch;

  constructor(fetchImpl: typeof fetch = fetch) {
    this.fetchImpl = fetchImpl;
  }

  async getToken(): Promise<string> {
    const id = process.env.PAYPAL_CLIENT_ID;
    const secret = process.env.PAYPAL_CLIENT_SECRET;
    const missing: string[] = [];
    if (!id) missing.push('PAYPAL_CLIENT_ID');
    if (!secret) missing.push('PAYPAL_CLIENT_SECRET');
    if (missing.length) throw new MissingCredentialsError(missing);

    const base = process.env.PAYPAL_BASE_URL || 'https://api-m.sandbox.paypal.com';
    assertSandboxBaseUrl(base);

    const tokenRes = await fetchWithRetry(
      this.fetchImpl,
      `${base}/v1/oauth2/token`,
      {
        method: 'POST',
        headers: {
          Authorization: `Basic ${Buffer.from(`${id}:${secret}`).toString('base64')}`,
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: 'grant_type=client_credentials',
      },
      'token-' + crypto.randomUUID()
    ) as TokenResponse;
    return tokenRes.access_token;
  }

  // Exposed for smoke test to test token directly
  async getTokenForTest(): Promise<string> {
    return this.getToken();
  }

  async charge(req: ChargeRequest): Promise<ChargeResult> {
    assertRepresentable(req.amount);
    const token = await this.getToken();
    const base = process.env.PAYPAL_BASE_URL || 'https://api-m.sandbox.paypal.com';
    assertSandboxBaseUrl(base);

    const orderRes = await fetchWithRetry(
      this.fetchImpl,
      `${base}/v2/checkout/orders`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          intent: 'CAPTURE',
          purchase_units: [{ amount: { currency_code: req.currency, value: microToDecimal(req.amount) } }],
        }),
      },
      req.idempotencyKey
    ) as { id: string };
    const capRes = await fetchWithRetry(
      this.fetchImpl,
      `${base}/v2/checkout/orders/${orderRes.id}/capture`,
      {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      },
      req.idempotencyKey
    ) as { purchase_units: Array<{ payments: { captures: Array<{ id: string }> } }> };
    const captureId = capRes.purchase_units?.[0]?.payments?.captures?.[0]?.id;
    if (!captureId) throw new PaymentProviderError('capture response contained no capture id');
    return { ref: captureId, mode: 'SANDBOX' };
  }

  async authorize(req: AuthorizeRequest): Promise<AuthorizeResult> {
    // Legacy one-call authorize - kept for backward compatibility with escrow flow
    // This is NOT used by the smoke test
    assertRepresentable(req.amount);
    const token = await this.getToken();
    const base = process.env.PAYPAL_BASE_URL || 'https://api-m.sandbox.paypal.com';
    assertSandboxBaseUrl(base);

    const orderRes = await fetchWithRetry(
      this.fetchImpl,
      `${base}/v2/checkout/orders`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          intent: 'AUTHORIZE',
          purchase_units: [{ amount: { currency_code: req.currency, value: microToDecimal(req.amount) } }],
        }),
      },
      req.idempotencyKey
    ) as { id: string };
    const authRes = await fetchWithRetry(
      this.fetchImpl,
      `${base}/v2/checkout/orders/${orderRes.id}/authorize`,
      {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      },
      req.idempotencyKey
    ) as { purchase_units: Array<{ payments: { authorizations: Array<{ id: string }> } }> };
    const authId = authRes.purchase_units?.[0]?.payments?.authorizations?.[0]?.id;
    if (!authId) throw new PaymentProviderError('authorize response contained no authorization id');
    return { ref: authId, mode: 'SANDBOX' };
  }

  async createAuthorizeOrder(req: CreateAuthorizeOrderRequest): Promise<CreateAuthorizeOrderResult> {
    assertRepresentable(req.amount);
    const token = await this.getToken();
    const base = process.env.PAYPAL_BASE_URL || 'https://api-m.sandbox.paypal.com';
    assertSandboxBaseUrl(base);

    const orderRes = await fetchWithRetry(
      this.fetchImpl,
      `${base}/v2/checkout/orders`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          intent: 'AUTHORIZE',
          purchase_units: [{ amount: { currency_code: req.currency, value: microToDecimal(req.amount) } }],
        }),
      },
      req.idempotencyKey
    ) as { id: string; links: Array<{ rel: string; href: string }> };
    const approveLink = orderRes.links?.find((l) => l.rel === 'approve' || l.rel === 'payer-action');
    const approveUrl = approveLink?.href;
    if (!approveUrl) throw new PaymentProviderError('order response contained no approve link');
    return { orderId: orderRes.id, approveUrl, mode: 'SANDBOX' };
  }

  async authorizeOrder(req: AuthorizeOrderRequest): Promise<AuthorizeOrderResult> {
    const token = await this.getToken();
    const base = process.env.PAYPAL_BASE_URL || 'https://api-m.sandbox.paypal.com';
    assertSandboxBaseUrl(base);

    const authRes = await fetchWithRetry(
      this.fetchImpl,
      `${base}/v2/checkout/orders/${req.orderId}/authorize`,
      {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      },
      req.idempotencyKey
    ) as { purchase_units: Array<{ payments: { authorizations: Array<{ id: string }> } }> };
    const authId = authRes.purchase_units?.[0]?.payments?.authorizations?.[0]?.id;
    if (!authId) throw new PaymentProviderError('authorize response contained no authorization id');
    return { ref: authId, mode: 'SANDBOX' };
  }

  async capture(req: CaptureRequest): Promise<CaptureResult> {
    assertRepresentable(req.amount);
    const token = await this.getToken();
    const base = process.env.PAYPAL_BASE_URL || 'https://api-m.sandbox.paypal.com';
    assertSandboxBaseUrl(base);

    const capRes = await fetchWithRetry(
      this.fetchImpl,
      `${base}/v2/payments/authorizations/${req.authRef}/capture`,
      {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ amount: { currency_code: 'USD', value: microToDecimal(req.amount) } }),
      },
      req.idempotencyKey
    ) as { id: string };
    return { ref: capRes.id, mode: 'SANDBOX' };
  }

  async voidAuthorization(req: VoidRequest): Promise<void> {
    const token = await this.getToken();
    const base = process.env.PAYPAL_BASE_URL || 'https://api-m.sandbox.paypal.com';
    assertSandboxBaseUrl(base);

    await fetchWithRetry(
      this.fetchImpl,
      `${base}/v2/payments/authorizations/${req.authRef}/void`,
      {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      },
      req.idempotencyKey
    );
  }

  async payout(req: PayoutRequest): Promise<PayoutResult> {
    assertRepresentable(req.amount);
    const token = await this.getToken();
    const base = process.env.PAYPAL_BASE_URL || 'https://api-m.sandbox.paypal.com';
    assertSandboxBaseUrl(base);

    const payeeEmail = process.env.PAYPAL_PAYEE_EMAIL;
    if (!payeeEmail) throw new MissingCredentialsError(['PAYPAL_PAYEE_EMAIL']);

    const senderBatchId = `batch_${req.idempotencyKey}`;
    const payoutRes = await fetchWithRetry(
      this.fetchImpl,
      `${base}/v1/payments/payouts`,
      {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sender_batch_header: {
            sender_batch_id: senderBatchId,
            email_subject: 'ATN Payout',
            email_message: 'Payment from ATN escrow release',
          },
          items: [{
            recipient_type: 'EMAIL',
            amount: { value: microToDecimal(req.amount), currency: req.currency },
            receiver: payeeEmail,
            note: `ATN payout for ${req.payeeRef}`,
            sender_item_id: req.idempotencyKey,
          }],
        }),
      },
      req.idempotencyKey
    ) as { batch_header: { payout_batch_id: string } };
    return { ref: payoutRes.batch_header?.payout_batch_id || senderBatchId, mode: 'SANDBOX' };
  }

  async refund(req: RefundRequest): Promise<void> {
    assertRepresentable(req.amount);
    const token = await this.getToken();
    const base = process.env.PAYPAL_BASE_URL || 'https://api-m.sandbox.paypal.com';
    assertSandboxBaseUrl(base);

    await fetchWithRetry(
      this.fetchImpl,
      `${base}/v2/payments/captures/${req.captureRef}/refund`,
      {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ amount: { currency_code: 'USD', value: microToDecimal(req.amount) } }),
      },
      req.idempotencyKey
    );
  }
}

/**
 * Server-path adapter for SETTLEMENT_MODE=PAYPAL_SANDBOX.
 * PayPal Orders need a human buyer to approve each order in a browser, so escrow holds
 * (authorize, capture, void, refund) stay ledger-only here. Real PayPal calls on this path:
 * Payouts, used for channel settlement and escrow release. The real Orders flow
 * (authorize, capture, void, refund) is exercised by `npm run paypal:smoke`.
 */
export class HybridSandboxAdapter implements PaymentAdapter {
  private readonly ledger = new SimulatedAdapter();
  private readonly paypal: SandboxAdapter;

  constructor(fetchImpl?: typeof fetch) {
    this.paypal = new SandboxAdapter(fetchImpl);
  }

  async charge(req: ChargeRequest): Promise<ChargeResult> {
    const out = await this.paypal.payout({
      amount: req.amount,
      currency: req.currency,
      payeeRef: req.channelId,
      idempotencyKey: req.idempotencyKey,
    });
    return { ref: out.ref, mode: out.mode };
  }

  authorize(req: AuthorizeRequest): Promise<AuthorizeResult> {
    return this.ledger.authorize(req);
  }

  createAuthorizeOrder(req: CreateAuthorizeOrderRequest): Promise<CreateAuthorizeOrderResult> {
    return this.paypal.createAuthorizeOrder(req);
  }

  authorizeOrder(req: AuthorizeOrderRequest): Promise<AuthorizeOrderResult> {
    return this.paypal.authorizeOrder(req);
  }

  capture(req: CaptureRequest): Promise<CaptureResult> {
    return this.ledger.capture(req);
  }

  voidAuthorization(req: VoidRequest): Promise<void> {
    return this.ledger.voidAuthorization(req);
  }

  payout(req: PayoutRequest): Promise<PayoutResult> {
    return this.paypal.payout(req);
  }

  refund(req: RefundRequest): Promise<void> {
    return this.ledger.refund(req);
  }
}

export function createPaymentAdapter(fetchImpl?: typeof fetch): PaymentAdapter {
  const mode = process.env.SETTLEMENT_MODE || 'SIMULATED';
  if (mode === 'PAYPAL_SANDBOX') {
    return new HybridSandboxAdapter(fetchImpl);
  }
  return new SimulatedAdapter();
}