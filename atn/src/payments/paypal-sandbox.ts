import {
  MissingPayPalCredentialsError,
  PayPalProviderError,
  PayPalSandboxProvider,
} from './providers/paypal.js';

/**
 * Naming/compatibility shim for the verified PayPal sandbox provider.
 * UNVERIFIED without PayPal sandbox credentials; this provider never fakes a
 * successful charge. When supplied credentials omit either PAYPAL_CLIENT_ID
 * or PAYPAL_CLIENT_SECRET, it throws MissingPayPalCredentialsError.
 * This module only re-exports the provider; it does not load environment values.
 */
export {
  MissingPayPalCredentialsError,
  PayPalProviderError,
  PayPalSandboxProvider,
};

export type PayPalSandboxOptions = ConstructorParameters<
  typeof PayPalSandboxProvider
>[1];
