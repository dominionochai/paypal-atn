# Streaming (M2)

M2 implements signed, cumulative-payment channels, voucher validation, a WebSocket interface, and channel settlement. Channel amounts are integer micro-dollars. Channel records, accepted vouchers, and settlements are stored in SQLite.

## Channels and vouchers

Opening a channel records its payer and payee agent IDs, the payer's public key, a positive-integer ceiling, zero initial spend and nonce, `OPEN` status, creation time, and expiry time (`now + ttlSeconds`). The channel API accepts vouchers only while the channel is open and not expired.

A voucher payload has exactly these signed fields:

| Field | Type | Meaning |
| --- | --- | --- |
| `channelId` | string | Channel identifier |
| `payeeAgentId` | string | Intended payee agent |
| `cumulativeAmount` | number | Cumulative amount in micro-dollars |
| `nonce` | number | Per-channel ordering/replay value |
| `issuedAt` | number | Issuance timestamp value |

The canonical signed bytes are the concatenation, in this exact order, of `channelId`, `payeeAgentId`, `cumulativeAmount`, `nonce`, and `issuedAt`. Each string is UTF-8 encoded and preceded by its byte length as a 4-byte unsigned big-endian integer. Each numeric value is checked to be a JavaScript safe integer, converted to `BigInt`, and encoded as an 8-byte signed big-endian integer. There are no separators or other fields. The payload is signed and verified with Node.js Ed25519 (`sign`/`verify` with a `null` digest); the signature is represented as base64.

Acceptance checks that the channel is `OPEN` and unexpired; payload channel and payee IDs match; the signature verifies against the channel payer public key; the nonce has not already been stored and is greater than the last accepted nonce; and the cumulative amount is at least the channel's current spend, no greater than its ceiling, and no greater than the caller-supplied delegation budget. The signed `issuedAt` value is not separately freshness-checked by the validator; expiry is checked against the channel's `expires_at`.

Amounts are cumulative, not per-voucher increments. A successful acceptance sets `spent` to the greater of its previous value and the voucher amount, and rejects any voucher whose amount is below current `spent`. Thus, once an amount has been accepted, no subsequent accepted voucher can lower it: a decrease is structurally excluded by the acceptance predicate and state update, rather than being repaired by summing or subtracting vouchers.

### Rejection reason codes

The validator returns the first applicable reason in its check order; an absent channel is handled before voucher validation. The WebSocket layer also emits the protocol-level codes listed below.

| Exact code | Trigger |
| --- | --- |
| `UNKNOWN_CHANNEL` | No channel exists for the requested channel ID. |
| `CHANNEL_CLOSED` | The channel status is not `OPEN`. |
| `STALE` | The channel has expired, or the voucher nonce is less than or equal to the last accepted nonce. |
| `WRONG_PARTY` | The voucher channel ID differs from the channel ID, or its payee agent ID differs from the channel payee. |
| `TAMPERED` | Voucher signature verification fails. |
| `REPLAYED` | The `(channel_id, nonce)` already exists; a database uniqueness conflict is also reported as replay. |
| `NON_MONOTONIC` | `cumulativeAmount` is below the channel's current `spent`. |
| `OVER_BUDGET` | `cumulativeAmount` exceeds the channel ceiling or the supplied delegation budget. |
| `BAD_MESSAGE` | A WebSocket message is invalid JSON or does not have the expected voucher message shape. |
| `INTERNAL` | A WebSocket handler catches an internal exception, including a channel that disappears after acceptance. |

Nonce checking is per channel: accepted nonces must increase strictly beyond `last_nonce`, and the migration additionally declares `UNIQUE(channel_id, nonce)` on vouchers. A duplicate accepted nonce is therefore rejected even if it races the in-memory/order check.

## WebSocket streaming

`stream:server` starts the WebSocket server. Its port is `PORT` or `8787` by default; `DELEGATION_BUDGET` defaults to `Number.MAX_SAFE_INTEGER` and must be a non-negative safe integer. Clients send JSON messages of the form `{"type":"voucher","channelId":"…","voucher":{"payload":{"channelId":"…","payeeAgentId":"…","cumulativeAmount":123,"nonce":1,"issuedAt":1700000000000},"signature":"base64"}}`. On acceptance, the sender receives an `ack` with the channel's updated `spent` and `ceiling`; connected watchers for that channel receive a `state` message with `spent`, `ceiling`, and `status`. Rejections are returned to the sender as `reject` messages with the validation code and detail.

## Settlement

Settlement charges the channel's current cumulative `spent` in USD through the supplied payment adapter, stores the settlement amount, mode, idempotency key, and adapter reference, marks the channel `SETTLED`, and records a settlement audit event. Reusing an idempotency key for the same channel returns the existing settlement row. Reusing that key for a different channel throws an error; settling an already-settled channel with a different key throws `AlreadySettled`.

The payment adapter supports `SIMULATED` and `SANDBOX` paths. `SIMULATED` is offline and returns a deterministic simulated reference; this is not evidence of a real transfer. `SANDBOX` uses the PayPal sandbox API path and requires `PAYPAL_CLIENT_ID` and `PAYPAL_CLIENT_SECRET`; absent credentials cause `MissingCredentialsError` rather than a fabricated success. The sandbox path is **UNVERIFIED** unless it was exercised with real sandbox credentials. No claim of a verified PayPal sandbox transaction is made here.

## Not implemented

- PayPal LIVE payments.
- A WebSocket transport wired into the HTTP gateway: the gateway accepts vouchers over HTTP, and the WebSocket module here is tested separately. Escrow and the HTTP routes are documented in README.ESCROW.md and README.API.md.

## Commands

Run these commands from the repository root:

```sh
cd atn
npm install
npm test
npm run typecheck
npm run stream:server
```
