export type PaymentMode = 'SIMULATED' | 'SANDBOX' | 'LIVE';
export interface ChargeRequest { amount: number; currency: string; idempotencyKey: string; channelId: string; }
export interface ChargeResult { ref: string; mode: PaymentMode; }
export interface PaymentAdapter { charge(req: ChargeRequest): Promise<ChargeResult>; }

export class MissingCredentialsError extends Error { constructor(missing: string[]) { super(`missing PayPal credentials: ${missing.join(', ')}`); this.name = 'MissingCredentialsError'; } }

export class PaymentProviderError extends Error { constructor(message: string, public status?: number, public retryable = false) { super(message); this.name = 'PaymentProviderError'; } }

export class SimulatedAdapter implements PaymentAdapter {
  async charge(req: ChargeRequest): Promise<ChargeResult> { return { ref: `sim_${req.channelId}_${req.idempotencyKey}`, mode: 'SIMULATED' }; }
}

function microToDecimal(amount: number): string {
  if (!Number.isSafeInteger(amount) || amount < 0) throw new Error('amount must be a non-negative integer in micro-dollars');
  const whole = Math.floor(amount / 1_000_000);
  const frac = amount % 1_000_000;
  return `${whole}.${frac.toString().padStart(6, '0').slice(0, 2)}`;
}

export class SandboxAdapter implements PaymentAdapter {
  constructor(private fetchImpl: typeof fetch = fetch) {}
  async charge(req: ChargeRequest): Promise<ChargeResult> {
    const id = process.env.PAYPAL_CLIENT_ID; const secret = process.env.PAYPAL_CLIENT_SECRET;
    const missing: string[] = []; if (!id) missing.push('PAYPAL_CLIENT_ID'); if (!secret) missing.push('PAYPAL_CLIENT_SECRET');
    if (missing.length) throw new MissingCredentialsError(missing);
    const base = process.env.PAYPAL_BASE_URL ?? 'https://api-m.sandbox.paypal.com';
    const tokenRes = await this.fetchImpl(`${base}/v1/oauth2/token`, { method: 'POST', headers: { Authorization: `Basic ${Buffer.from(`${id}:${secret}`).toString('base64')}`, 'Content-Type': 'application/x-www-form-urlencoded' }, body: 'grant_type=client_credentials' });
    if (!tokenRes.ok) throw new PaymentProviderError(`token request failed: ${tokenRes.status}`, tokenRes.status, tokenRes.status >= 500);
    const token = (await tokenRes.json() as { access_token: string }).access_token;
    const orderRes = await this.fetchImpl(`${base}/v2/checkout/orders`, { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', 'PayPal-Request-Id': req.idempotencyKey }, body: JSON.stringify({ intent: 'CAPTURE', purchase_units: [{ amount: { currency_code: req.currency, value: microToDecimal(req.amount) } }] }) });
    if (!orderRes.ok) throw new PaymentProviderError(`order create failed: ${orderRes.status}`, orderRes.status, orderRes.status >= 500);
    const order = await orderRes.json() as { id: string };
    const capRes = await this.fetchImpl(`${base}/v2/checkout/orders/${order.id}/capture`, { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', 'PayPal-Request-Id': req.idempotencyKey } });
    if (!capRes.ok) throw new PaymentProviderError(`capture failed: ${capRes.status}`, capRes.status, capRes.status >= 500);
    const cap = await capRes.json() as { purchase_units?: Array<{ payments?: { captures?: Array<{ id: string }> } }> };
    const captureId = cap.purchase_units?.[0]?.payments?.captures?.[0]?.id;
    if (!captureId) throw new PaymentProviderError('capture response contained no capture id');
    return { ref: captureId, mode: 'SANDBOX' };
  }
}
