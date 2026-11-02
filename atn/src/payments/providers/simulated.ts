import { createHash } from 'node:crypto';
import {
  microsToDecimal,
  type CapturedOrder,
  type CaptureOrderInput,
  type CreateOrderInput,
  type CreatedOrder,
  type PaymentProvider,
} from './paypal.js';

interface SimulatedOrder { readonly amountMicros: number; readonly currency: string }
function deterministicRef(kind: string, value: unknown): string {
  const digest = createHash('sha256').update(JSON.stringify(value)).digest('hex').slice(0, 24);
  return `SIMULATED-${kind}-${digest}`;
}

/** No-network provider with stable, deterministic references for offline runs. */
export class SimulatedPaymentProvider implements PaymentProvider {
  readonly mode = 'simulated' as const;
  readonly label = 'SIMULATED' as const;
  private readonly orders = new Map<string, SimulatedOrder>();

  async createOrder(input: CreateOrderInput): Promise<CreatedOrder> {
    if (!input.idempotencyKey.trim()) throw new TypeError('idempotencyKey must not be empty');
    const currency = input.currency ?? 'USD';
    if (!/^[A-Z]{3}$/.test(currency)) throw new TypeError('currency must be a three-letter uppercase code');
    microsToDecimal(input.amountMicros);
    const orderId = deterministicRef('ORDER', {
      amountMicros: input.amountMicros,
      currency,
      idempotencyKey: input.idempotencyKey,
    });
    this.orders.set(orderId, { amountMicros: input.amountMicros, currency });
    return { orderId, status: 'CREATED' };
  }

  async captureOrder(input: CaptureOrderInput): Promise<CapturedOrder> {
    if (!input.idempotencyKey.trim()) throw new TypeError('idempotencyKey must not be empty');
    const order = this.orders.get(input.orderId);
    if (!order) throw new Error(`Unknown simulated order ${input.orderId}`);
    return {
      orderId: input.orderId,
      captureId: deterministicRef('CAPTURE', { orderId: input.orderId, idempotencyKey: input.idempotencyKey }),
      status: 'COMPLETED',
      amountMicros: order.amountMicros,
      currency: order.currency,
    };
  }
}
