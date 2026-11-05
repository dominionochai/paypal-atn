# Payments (M4 + H1 PayPal Integration)

This layer is deliberately separate from transaction settlement. Provider I/O is outside SQLite transactions; the SQLite idempotency ledger reserves a request before network I/O and records its outcome after.

## Providers

- `PayPalSandboxProvider` (SandboxAdapter) is pinned to `https://api-m.sandbox.paypal.com`. Supply sandbox credentials via environment variables and an optional `fetcher` for controlled tests. Create and capture requests send the idempotency key in `PayPal-Request-Id`.
- `SimulatedPaymentProvider` (SimulatedAdapter) is completely offline, exposes the label `SIMULATED`, and produces deterministic `SIMULATED-ORDER-…` and `SIMULATED-CAPTURE-…` references from the operation input. It is suitable for demos and deterministic tests, not evidence of a real transfer.
- Money crossing this API is integer `amountMicros` (micro-dollars). `microToDecimal` and `decimalToMicros` use exact integer/BigInt conversions, not floating-point rounding. Captures expose `captureId`, `status`, `amountMicros`, and `currency`.

## H1 PayPal Sandbox Implementation

### Supported Operations

| Adapter Method | PayPal Endpoint | Purpose |
|----------------|-----------------|---------|
| `authorize` | POST /v2/checkout/orders (intent=AUTHORIZE) + POST /v2/checkout/orders/{id}/authorize | Create authorization hold (escrow hold) |
| `capture` | POST /v2/payments/authorizations/{id}/capture | Capture authorized amount |
| `voidAuthorization` | POST /v2/payments/authorizations/{id}/void | Release authorization hold |
| `payout` | POST /v1/payments/payouts | Pay payee via Payouts API |
| `refund` | POST /v2/payments/captures/{id}/refund | Refund a captured payment |
| `charge` | POST /v2/checkout/orders (intent=CAPTURE) + capture | Legacy channel settlement |

### Key Implementation Details

- **OAuth**: Token fetched from `/v1/oauth2/token` with client credentials grant, cached per adapter instance.
- **Idempotency**: Every request sends `PayPal-Request-Id` header derived from the idempotency key.
- **Retry Logic**: Retries only on HTTP 429 or 5xx, up to 3 total attempts, using the same `PayPal-Request-Id`.
- **Amounts**: All amounts are 2-decimal USD strings (e.g., "10.00"). Any amount not a multiple of 10,000 micro-dollars (1 cent) throws `NotRepresentableError`.
- **Base URL**: Hard-refuses any `PAYPAL_BASE_URL` other than `https://api-m.sandbox.paypal.com`.
- **Secrets**: Never logged; redacted in error messages (`***REDACTED***`).
- **Payouts**: Uses PayPal Payouts API with sender_batch_id derived from idempotency key, recipient from `PAYPAL_PAYEE_EMAIL`.

### Mode Behavior

| Mode | Channel Settlement | Escrow Release |
|------|-------------------|----------------|
| `SETTLEMENT_MODE=SIMULATED` | SimulatedAdapter.charge | SimulatedAdapter.capture + payout |
| `SETTLEMENT_MODE=PAYPAL_SANDBOX` | SandboxAdapter.charge | SandboxAdapter.capture + payout (ledger hold stays via authorize) |

**Important**: In `PAYPAL_SANDBOX` mode, escrow release uses `adapter.payout` (real Payouts call). The escrow hold stays a ledger hold (simulated authorize) because PayPal Orders need buyer approval. The adapter.authorize creates an AUTHORIZE intent order, but the buyer must approve it before capture.

## Error Handling

- `MissingCredentialsError`: Required env vars not set.
- `PaymentProviderError`: Wraps HTTP errors with status and retryable flag.
- `NotRepresentableError`: Amount not a multiple of 10,000 micro-dollars (1 cent).
- `InvalidBaseUrlError`: PAYPAL_BASE_URL is not the sandbox URL.

Secrets are never logged or stored (memory cache only, expiry-aware, redacted in errors).

## Smoke Script

Run the sandbox smoke test:

```sh
npm run paypal:smoke
```

Requires valid sandbox credentials in `atn/.env`. Flow:
1. Token request
2. Create AUTHORIZE order, print approve URL, wait for Enter
3. Capture $0.10, then refund it
4. Second order: authorize then void
5. $0.10 payout to `PAYPAL_PAYEE_EMAIL`
6. Prints every PayPal id/status as a table; never prints secrets.
7. Exits non-zero on failure; prints specific message for 401 invalid_client.

## Tests

Tests use stubbed `fetch` only; no network calls. They verify:
- Request shape, headers, `PayPal-Request-Id`
- Retry on 5xx, no retry on 4xx
- `NotRepresentableError` for non-cent amounts
- Refusal of non-sandbox base URL
- Secret redaction in errors
- 401 invalid_client message

## Reconciliation

`reconcilePayments(localPayments, fetchRemotePayments)` injects the remote snapshot fetcher and delegates comparison to pure `buildReconciliationReport(local, remote)`. Records pair on the stable `reference`; duplicate references and invalid currencies/amounts are rejected. Amounts are compared as integer micro-dollars (and currency codes must match); statuses compare exactly.

## Commands

Run from the `atn/` directory:

```sh
npm ci
npm run typecheck
npm test
npm run build
npm run paypal:smoke
```

The payment tests use real module imports, an in-memory SQLite database, and injected fake `fetch` responses only. They need no PayPal credentials and make no real network or sandbox calls. Sandbox behavior in this suite is verified against stubs, not live credentials.