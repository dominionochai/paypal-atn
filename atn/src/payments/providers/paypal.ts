import { Buffer } from 'node:buffer';

export const PAYPAL_SANDBOX_API = 'https://api-m.sandbox.paypal.com';
/** Three total attempts: the initial request plus two retries, HTTP 5xx only. */
export const PAYPAL_PAYMENT_MAX_ATTEMPTS = 3;

export interface CreateOrderInput {
  readonly amountMicros: number;
  readonly currency?: string;
  readonly idempotencyKey: string;
}
export interface CaptureOrderInput {
  readonly orderId: string;
  readonly idempotencyKey: string;
}
export interface CreatedOrder {
  readonly orderId: string;
  readonly status: string;
}
export interface CapturedOrder {
  readonly orderId: string;
  readonly captureId: string;
  readonly status: string;
  readonly amountMicros: number;
  readonly currency: string;
}
export interface PaymentProvider {
  readonly mode: 'paypal-sandbox' | 'simulated';
  createOrder(input: CreateOrderInput): Promise<CreatedOrder>;
  captureOrder(input: CaptureOrderInput): Promise<CapturedOrder>;
}

export class PayPalProviderError extends Error {
  constructor(
    message: string,
    readonly status: number | undefined,
    readonly retryable: boolean,
    readonly definitive: boolean,
    readonly outcomeUnknown: boolean,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = 'PayPalProviderError';
  }
}
export class MissingPayPalCredentialsError extends PayPalProviderError {
  constructor() {
    super('PayPal sandbox credentials are required (PAYPAL_CLIENT_ID and PAYPAL_CLIENT_SECRET)', undefined, false, true, false);
    this.name = 'MissingPayPalCredentialsError';
  }
}
interface TokenResponse { readonly access_token?: unknown }
interface OrderResponse { readonly id?: unknown; readonly status?: unknown; readonly purchase_units?: unknown }
function nonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}

/** Format safe integer micro-dollars without floating point or rounding. */
export function microsToDecimal(amountMicros: number): string {
  if (!Number.isSafeInteger(amountMicros) || amountMicros < 0) throw new RangeError('amountMicros must be a non-negative safe integer');
  const amount = BigInt(amountMicros);
  const whole = (amount / 1_000_000n).toString();
  const fraction = (amount % 1_000_000n).toString().padStart(6, '0').replace(/0+$/, '');
  return fraction.length === 0 ? `${whole}.00` : `${whole}.${fraction.padEnd(2, '0')}`;
}
/** Parse a provider decimal amount exactly into integer micro-dollars. */
export function decimalToMicros(value: unknown): number {
  if (typeof value !== 'string' || !/^\d+(?:\.\d{1,6})?$/.test(value)) {
    throw new TypeError('PayPal amount must be a non-negative decimal with at most six fractional digits');
  }
  const [whole, fraction = ''] = value.split('.');
  if (whole === undefined) {
    throw new PayPalProviderError('expected value missing from PayPal response', undefined, false, false, true);
  }
  const micros = BigInt(whole) * 1_000_000n + BigInt(fraction.padEnd(6, '0'));
  if (micros > BigInt(Number.MAX_SAFE_INTEGER)) throw new RangeError('PayPal amount exceeds the safe integer micro-dollar range');
  return Number(micros);
}

/** PayPal Orders API client pinned to the sandbox endpoint. */
export class PayPalSandboxProvider implements PaymentProvider {
  readonly mode = 'paypal-sandbox' as const;
  private readonly fetcher: typeof fetch;
  constructor(
    private readonly credentials: { readonly clientId?: string; readonly clientSecret?: string },
    options: { readonly fetcher?: typeof fetch } = {},
  ) {
    this.fetcher = options.fetcher ?? fetch;
  }

  async createOrder(input: CreateOrderInput): Promise<CreatedOrder> {
    this.validateIdempotencyKey(input.idempotencyKey);
    const currency = input.currency ?? 'USD';
    if (!/^[A-Z]{3}$/.test(currency)) throw new TypeError('currency must be a three-letter uppercase code');
    const value = microsToDecimal(input.amountMicros);
    const response = await this.paymentRequest<OrderResponse>('/v2/checkout/orders', input.idempotencyKey, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ intent: 'CAPTURE', purchase_units: [{ amount: { currency_code: currency, value } }] }),
    });
    if (!nonEmptyString(response.id)) {
      throw new PayPalProviderError('PayPal order response did not include an order ID', undefined, false, false, true);
    }
    return { orderId: response.id, status: nonEmptyString(response.status) ? response.status : 'CREATED' };
  }

  async captureOrder(input: CaptureOrderInput): Promise<CapturedOrder> {
    this.validateIdempotencyKey(input.idempotencyKey);
    if (!input.orderId.trim()) throw new TypeError('orderId must not be empty');
    const response = await this.paymentRequest<OrderResponse>(
      `/v2/checkout/orders/${encodeURIComponent(input.orderId)}/capture`, input.idempotencyKey,
      { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' },
    );
    const units = Array.isArray(response.purchase_units) ? response.purchase_units : [];
    const unit = units[0] as { readonly payments?: { readonly captures?: readonly unknown[] } } | undefined;
    const capture = unit?.payments?.captures?.[0] as {
      readonly id?: unknown;
      readonly status?: unknown;
      readonly amount?: { readonly value?: unknown; readonly currency_code?: unknown };
    } | undefined;
    if (!nonEmptyString(capture?.id)) {
      throw new PayPalProviderError('PayPal capture response did not include a capture ID', undefined, false, false, true);
    }
    if (!nonEmptyString(capture.status) || !nonEmptyString(capture.amount?.currency_code)) {
      throw new PayPalProviderError('PayPal capture response did not include status, amount, and currency', undefined, false, false, true);
    }
    let amountMicros: number;
    try {
      amountMicros = decimalToMicros(capture.amount.value);
    } catch (error) {
      throw new PayPalProviderError('PayPal capture response included an invalid amount', undefined, false, false, true, { cause: error });
    }
    return { orderId: input.orderId, captureId: capture.id, status: capture.status, amountMicros, currency: capture.amount.currency_code };
  }

  private validateIdempotencyKey(key: string): void {
    if (!key.trim()) throw new TypeError('idempotencyKey must not be empty');
  }

  private async accessToken(): Promise<string> {
    const { clientId, clientSecret } = this.credentials;
    if (!clientId || !clientSecret) throw new MissingPayPalCredentialsError();
    let response: Response;
    try {
      response = await this.fetcher(`${PAYPAL_SANDBOX_API}/v1/oauth2/token`, {
        method: 'POST',
        headers: {
          Authorization: `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString('base64')}`,
          'Content-Type': 'application/x-www-form-urlencoded',
          Accept: 'application/json',
        },
        body: 'grant_type=client_credentials',
      });
    } catch (error) {
      // No payment request was sent; this reservation is safe to retry.
      throw new PayPalProviderError('PayPal OAuth request failed before a payment request was sent', undefined, true, true, false, { cause: error });
    }
    let payload: TokenResponse;
    try {
      payload = await this.readJson<TokenResponse>(response, 'PayPal OAuth', false);
    } catch (error) {
      if (error instanceof PayPalProviderError) {
        throw new PayPalProviderError(error.message, error.status, error.retryable, true, false, { cause: error });
      }
      throw error;
    }
    if (!nonEmptyString(payload.access_token)) {
      throw new PayPalProviderError('PayPal OAuth response did not include an access token', response.status, true, true, false);
    }
    return payload.access_token;
  }

  private async paymentRequest<T>(path: string, idempotencyKey: string, init: RequestInit): Promise<T> {
    const token = await this.accessToken();
    for (let attempt = 1; ; attempt += 1) {
      let response: Response;
      try {
        response = await this.fetcher(`${PAYPAL_SANDBOX_API}${path}`, {
          ...init,
          headers: {
            Accept: 'application/json',
            Authorization: `Bearer ${token}`,
            'PayPal-Request-Id': idempotencyKey,
            ...init.headers,
          },
        });
      } catch (error) {
        throw new PayPalProviderError('PayPal payment request failed; provider outcome may be unknown', undefined, true, false, true, { cause: error });
      }
      try {
        return await this.readJson<T>(response, 'PayPal payment', true);
      } catch (error) {
        if (error instanceof PayPalProviderError && error.retryable && error.status !== undefined && error.status >= 500 && attempt < PAYPAL_PAYMENT_MAX_ATTEMPTS) {
          // Reuse the same PayPal-Request-Id on every retry.
          continue;
        }
        throw error;
      }
    }
  }

  private async readJson<T>(response: Response, operation: string, paymentMayHaveBeenSent: boolean): Promise<T> {
    let text: string;
    try {
      text = await response.text();
    } catch (error) {
      throw new PayPalProviderError(`${operation} response could not be read`, response.status, true, false, paymentMayHaveBeenSent, { cause: error });
    }
    if (!response.ok) {
      const detail = text.slice(0, 500);
      const definitive = response.status >= 400 && response.status < 500;
      throw new PayPalProviderError(
        `${operation} returned HTTP ${response.status}${detail ? `: ${detail}` : ''}`,
        response.status,
        response.status >= 500,
        definitive,
        paymentMayHaveBeenSent && !definitive,
      );
    }
    try {
      return JSON.parse(text) as T;
    } catch (error) {
      throw new PayPalProviderError(`${operation} returned invalid JSON`, response.status, false, false, paymentMayHaveBeenSent, { cause: error });
    }
  }
}
