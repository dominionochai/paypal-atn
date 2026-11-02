import { PayPalSandboxProvider } from './providers/paypal.js';

/**
 * this is a naming/compat shim over providers/paypal.ts; the sandbox path is UNVERIFIED without real PayPal credentials; it never fakes a successful charge and throws MissingCredentialsError when PAYPAL_CLIENT_ID or PAYPAL_CLIENT_SECRET is absent.
 */
export { PayPalSandboxProvider };
export { MissingCredentialsError, PaymentProviderError } from './adapter.js';

export type PayPalSandboxOptions = ConstructorParameters<
  typeof PayPalSandboxProvider
>[1];
