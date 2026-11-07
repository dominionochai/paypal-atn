import { afterEach, describe, expect, it } from 'vitest';
import { SandboxAdapter } from '../src/payments/adapter.js';

const keys = ['PAYPAL_CLIENT_ID', 'PAYPAL_CLIENT_SECRET', 'PAYPAL_BASE_URL'];
const saved: Record<string, string | undefined> = {};
afterEach(() => {
  for (const key of keys) {
    if (saved[key] === undefined) delete process.env[key];
    else process.env[key] = saved[key];
  }
});

describe('PayPal void returns 204 No Content', () => {
  it('treats an empty successful response as success instead of failing JSON parsing', async () => {
    for (const key of keys) saved[key] = process.env[key];
    process.env.PAYPAL_CLIENT_ID = 'unit-test-id';
    process.env.PAYPAL_CLIENT_SECRET = 'unit-test-secret';
    delete process.env.PAYPAL_BASE_URL;
    const urls: string[] = [];
    const stub = (async (input: RequestInfo | URL) => {
      const url = String(input);
      urls.push(url);
      if (url.endsWith('/v1/oauth2/token')) {
        return new Response(JSON.stringify({ access_token: 'tok', expires_in: 3600, token_type: 'Bearer' }), { status: 200 });
      }
      return new Response(null, { status: 204 });
    }) as typeof fetch;
    const adapter = new SandboxAdapter(stub);
    await expect(adapter.voidAuthorization({ authRef: 'AUTH-1', idempotencyKey: 'void-1' })).resolves.toBeUndefined();
    expect(urls.some((url) => url.endsWith('/v2/payments/authorizations/AUTH-1/void'))).toBe(true);
  });
});
