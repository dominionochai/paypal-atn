# Payments (M4)

This layer is deliberately separate from transaction settlement. Provider I/O is outside SQLite transactions; the SQLite idempotency ledger reserves a request before network I/O and records its outcome after.

## Providers

- `PayPalSandboxProvider` is pinned to `https://api-m.sandbox.paypal.com`. Supply sandbox credentials to its constructor and an optional `fetcher` for controlled tests. Create and capture requests send the idempotency key in `PayPal-Request-Id`.
- `SimulatedPaymentProvider` is completely offline, exposes the label `SIMULATED`, and produces deterministic `SIMULATED-ORDER-…` and `SIMULATED-CAPTURE-…` references from the operation input. It is suitable for demos and deterministic tests, not evidence of a real transfer.
- Money crossing this API is integer `amountMicros` (micro-dollars). `microsToDecimal` and `decimalToMicros` use exact integer/BigInt conversions, not floating-point rounding. Captures expose `captureId`, `status`, `amountMicros`, and `currency`.

## Retry and failure behavior

The OAuth request is typed as a `PayPalProviderError`. A token-fetch failure is definitive for the payment operation because no payment request was sent; it is safe for the idempotency reservation to be retried. A provider 4xx response is definitive and is not retried. A payment 5xx response is retried at most twice after the initial attempt (three total attempts), using the same PayPal request ID. After the final 5xx, the typed error reports an unknown outcome; reconcile before submitting again. Transport failure after a payment request may have been sent is also an unknown outcome. Do not blindly retry an `UNKNOWN` idempotency record.

## Idempotency semantics

`SqliteIdempotencyStore` hashes canonicalized request data with SHA-256. A matching key and request hash replays the JSON result already stored and does not call the provider again. Reusing a key for a different request raises `IdempotencyConflictError`. An existing `IN_FLIGHT` record raises `IdempotencyInFlightError`; do not submit it again. Definitive failures are recorded as `FAILED` and can be retried. A non-definitive provider outcome becomes `UNKNOWN`, raises `PaymentOutcomeUnknownError`, and remains locked pending reconciliation. Successful results are stored and replayed as JSON. Keep provider I/O outside database transactions.

## Reconciliation report

`reconcilePayments(localPayments, fetchRemotePayments)` injects the remote snapshot fetcher and delegates comparison to pure `buildReconciliationReport(local, remote)`. Records pair on the stable `reference`; duplicate references and invalid currencies/amounts are rejected. Amounts are compared as integer micro-dollars (and currency codes must match); statuses compare exactly. Each report category is a deterministically reference-sorted array:

- `matched`: local and remote reference, amount/currency, and status all agree. Each item has `{ reference, local, remote }`.
- `local_only`: local payment snapshot has no remote reference.
- `remote_only`: remote payment snapshot has no local reference.
- `amount_mismatch`: paired records differ in micro-dollar amount or currency; each item has `{ reference, local, remote }`.
- `status_mismatch`: paired records differ in status; each item has `{ reference, local, remote }`.

A pair can appear in both mismatch arrays if both values differ. Reconciliation is read/compare only; it does not retry or mutate provider payments. A reconcile CLI is not included in this milestone's permitted paths; use the exported TypeScript functions.

## Commands

Run from the `atn/` directory:

```sh
npm ci
npm run typecheck
npm test
npm run build
```

The payment tests use real module imports, an in-memory SQLite database, and injected fake `fetch` responses only. They need no PayPal credentials and make no real network or sandbox calls. Sandbox behavior in this suite is verified against stubs, not live credentials.
