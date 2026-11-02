# M2 Streaming Vouchers and Settlement

## What M2 implements

M2 adds SQLite-backed payment channels and accepted vouchers, Ed25519 signing and verification over a canonical binary payload, nonce/replay checks, a WebSocket acknowledgement/state stream, channel closure and settlement, and `SIMULATED` and PayPal `SANDBOX` payment adapters. The server applies database migrations on startup. Run it from the `atn` project directory.

## Cumulative voucher format

A voucher payload contains `channelId`, `payeeAgentId`, `cumulativeAmount` (integer micro-dollars), `nonce`, and `issuedAt` (milliseconds since epoch). Its canonical bytes encode each string as a 4-byte big-endian byte length followed by UTF-8 bytes, then encode each integer as a signed 8-byte big-endian integer. The payer signs those canonical bytes with Ed25519; the signature is transported as base64.

The amount is cumulative: it represents the total amount owed so far, not a new increment. A compliant issuer only advances its cumulative total, so a decrease is structurally impossible; the receiver still rejects a decreasing amount defensively. This avoids adding the same value twice when vouchers are retried or re-sent. Each accepted voucher also advances the channel nonce.

## Rejection reason codes

The validator and WebSocket protocol use these exact reason codes:

- `STALE` — expired/future-issued voucher or a nonce that is not newer than the accepted nonce.
- `REPLAYED` — the `(channel, nonce)` pair already exists.
- `TAMPERED` — signature verification failed.
- `OVER_BUDGET` — channel ceiling or delegation budget would be exceeded.
- `WRONG_PARTY` — channel or payee identity does not match.
- `NON_MONOTONIC` — cumulative amount is lower than the already-spent amount.
- `CHANNEL_CLOSED` — channel is not open for voucher acceptance.
- `UNKNOWN_CHANNEL` — no such channel exists.

## Settlement and payment adapters

Settlement is idempotent by key: settling again with the same idempotency key returns the existing settlement row and does not call the adapter/charge again. Reusing that key for a different channel is an error. A different key on an already settled channel throws `AlreadySettledError` (the `AlreadySettled` condition).

Payment adapter modes are `SIMULATED` / `SANDBOX` / `LIVE`. `SimulatedAdapter` returns a synthetic reference. `SandboxAdapter` uses PayPal's sandbox OAuth/order/capture endpoints and throws `MissingCredentialsError` when credentials are missing; it does not fake a successful payment. PayPal sandbox path is **UNVERIFIED** unless real PayPal sandbox credentials were used to exercise it.

## Not implemented

- Escrow / ONNX inspector.
- HTTP routes.
- PayPal LIVE mode.

## Commands

Run these commands from `atn/`:

```sh
npm install
npm test
npm run typecheck
npm run stream:server
```

The streaming server reads `PORT` (default `8787`), `ATN_DB_PATH` (default `./atn.db`), and `DELEGATION_BUDGET` (default `Number.MAX_SAFE_INTEGER`, in micro-dollars). It applies migrations before listening. `npm run stream:server` starts a WebSocket server; it does not provide HTTP application routes.
