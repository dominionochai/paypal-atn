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

export interface PaymentAdapter {
  charge(req: ChargeRequest): Promise<ChargeResult>;
  authorize(req: AuthorizeRequest): Promise<AuthorizeResult>;
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
  constructor(message: string, public status?: number, public retryable = false) {
    super(message);
    this.name = 'PaymentProviderError';
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

async function fetchWithRetry<T>(
  fetchImpl: typeof fetch,
  url: string,
  options: RequestInit,
  idempotencyKey: string,
  maxRetries = 3
): Promise<T> {
  let lastError: Error | null = null;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    const headers = new Headers(options.headers);
    headers.set('PayPal-Request-Id', idempotencyKey);
    const res = await fetchImpl(url, { ...options, headers });
    if (res.ok) return res.json() as Promise<T>;
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

export class SandboxAdapter implements PaymentAdapter {
  constructor(private fetchImpl: typeof fetch = fetch) {}

  private async getToken(): Promise<string> {
    const id = process.env.PAYPAL_CLIENT_ID;
    const secret = process.env.PAYPAL_CLIENT_SECRET;
    const missing: string[] = [];
    if (!id) missing.push('PAYPAL_CLIENT_ID');
    if (!secret) missing.push('PAYPAL_CLIENT_SECRET');
    if (missing.length) throw new MissingCredentialsError(missing);

    const base = process.env.PAYPAL_BASE_URL ?? 'https://api-m.sandbox.paypal.com';
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
    );
    return (tokenRes as { access_token: string }).access_token;
  }

  async charge(req: ChargeRequest): Promise<ChargeResult> {
    assertRepresentable(req.amount);
    const token = await this.getToken();
    const base = process.env.PAYPAL_BASE_URL ?? 'https://api-m.sandbox.paypal.com';
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
    );
    const order = orderRes as { id: string };
    const capRes = await fetchWithRetry(
      this.fetchImpl,
      `${base}/v2/checkout/orders/${order.id}/capture`,
      {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      },
      req.idempotencyKey
    );
    const cap = capRes as { purchase_units?: Array<{ payments?: { captures?: Array<{ id: string }> } }> };
    const captureId = cap.purchase_units?.[0]?.payments?.captures?.[0]?.id;
    if (!captureId) throw new PaymentProviderError('capture response contained no capture id');
    return { ref: captureId, mode: 'SANDBOX' };
  }

  async authorize(req: AuthorizeRequest): Promise<AuthorizeResult> {
    assertRepresentable(req.amount);
    const token = await this.getToken();
    const base = process.env.PAYPAL_BASE_URL ?? 'https://api-m.sandbox.paypal.com';
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
    );
    const order = orderRes as { id: string };
    const authRes = await fetchWithRetry(
      this.fetchImpl,
      `${base}/v2/checkout/orders/${order.id}/authorize`,
      {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      },
      req.idempotencyKey
    );
    const auth = authRes as { purchase_units?: Array<{ payments?: { authorizations?: Array<{ id: string }> } }> };
    const authId = auth.purchase_units?.[0]?.payments?.authorizations?.[0]?.id;
    if (!authId) throw new PaymentProviderError('authorize response contained no authorization id');
    return { ref: authId, mode: 'SANDBOX' };
  }

  async capture(req: CaptureRequest): Promise<CaptureResult> {
    assertRepresentable(req.amount);
    const token = await this.getToken();
    const base = process.env.PAYPAL_BASE_URL ?? 'https://api-m.sandbox.paypal.com';
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
    );
    const cap = capRes as { id: string };
    return { ref: cap.id, mode: 'SANDBOX' };
  }

  async voidAuthorization(req: VoidRequest): Promise<void> {
    const token = await this.getToken();
    const base = process.env.PAYPAL_BASE_URL ?? 'https://api-m.sandbox.paypal.com';
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
    const base = process.env.PAYPAL_BASE_URL ?? 'https://api-m.sandbox.paypal.com';
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
    );
    const payout = payoutRes as { batch_header?: { payout_batch_id: string } };
    return { ref: payout.batch_header?.payout_batch_id ?? senderBatchId, mode: 'SANDBOX' };
  }

  async refund(req: RefundRequest): Promise<void> {
    assertRepresentable(req.amount);
    const token = await this.getToken();
    const base = process.env.PAYPAL_BASE_URL ?? 'https://api-m.sandbox.paypal.com';
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