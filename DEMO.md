# ATN Demo

A local, offline demo of the real HTTP API. It starts the server on a free port, drives it with signed requests, prints a PASS / FAIL / SKIP line per step, and exits non-zero on any FAIL.

## Run

```
cd atn
npm install
node scripts/demo.mjs
```

No PayPal credentials are used. Settlement runs in SIMULATED mode.

## What it exercises

- Opens a $50 channel (50,000,000 micro-dollars; 1 USD = 1,000,000 micro-dollars).
- Sends three Ed25519-signed cumulative vouchers ($10, $25, $50). The signing bytes match src/streaming/signing.ts.
- Over-ceiling voucher is rejected (HTTP 422).
- Replayed voucher is rejected (HTTP 409).
- Settlement with the wrong authority header is rejected (HTTP 403).
- Settlement succeeds once for the full amount; repeating the same idempotency key is safe.
- Creates a $25 escrow.

## Known SKIP

Escrow inspect and release are reported as SKIP: no HTTP route funds an escrow yet, so inspection cannot succeed over HTTP. The escrow module itself is covered by unit tests. This is planned work, not a pass.

## What this does NOT prove

- Real PayPal behavior (the PayPal sandbox adapter has not been run against the live sandbox).
- Zero-knowledge proofs (none are implemented).
- Safety across multiple processes.
- Authentication of the HTTP caller: signed delegations and request envelopes are not implemented yet.
