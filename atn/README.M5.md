# HTTP API (Milestone 5)

The HTTP server exposes the channel lifecycle routes below. JSON request bodies must use `Content-Type: application/json`. Request bodies larger than 1 MiB receive `413 PAYLOAD_TOO_LARGE`.

## Routes

### Create a channel

- **Method and path:** `POST /v1/channels`
- **Body:** `{ "payerAgentId": "<string>", "payeeAgentId": "<string>", "payerPublicKey": "<PEM public key>", "ceiling": <positive integer in micro-dollars>, "ttlSeconds": <positive integer> }`
- **Success:** `201 Created`; returns `channelId`, `ceiling`, and `expiresAt`.
- **Errors:** `400 Bad Request` for invalid JSON or invalid fields; `413 Payload Too Large` when the body limit is exceeded; `500 Internal Server Error` for an unexpected server-side failure.

### Retrieve a channel

- **Method and path:** `GET /v1/channels/{channelId}`
- **Body:** none.
- **Success:** `200 OK`; returns the channel `id`, `spent`, `ceiling`, `status`, `lastNonce`, and `expiresAt`.
- **Errors:** `404 Not Found` when the channel does not exist.

### Submit a voucher

- **Method and path:** `POST /v1/channels/{channelId}/vouchers`
- **Body:** `{ "payload": { "channelId": "<string>", "payeeAgentId": "<string>", "cumulativeAmount": <integer>, "nonce": <integer>, "issuedAt": <integer timestamp> }, "signature": "<base64 Ed25519 signature>" }`
- **Success:** `200 OK`; returns `{ "ok": true, "spent": <integer>, "ceiling": <integer> }`.
- **Errors:** `400 Bad Request` for invalid JSON or request shape; `404 Not Found` for an unknown channel; `409 Conflict` with `REPLAYED` for a voucher nonce already accepted; `422 Unprocessable Entity` for other invalid vouchers (for example, an invalid signature or stale/non-monotonic voucher); `413 Payload Too Large` when the body limit is exceeded.

### Settle a channel

- **Method and path:** `POST /v1/channels/{channelId}/settle`
- **Body:** `{ "idempotencyKey": "<non-empty string>" }`
- **Required header:** `x-atn-authority: <channel payeeAgentId>`.
- **Success:** `200 OK`; returns the channel ID, settled amount, settlement mode, adapter reference, and idempotency key.
- **Errors:** `400 Bad Request` for invalid JSON or a missing/invalid idempotency key; `403 Forbidden` when the authority header is absent or does not match the channel payee; `404 Not Found` for an unknown channel; `409 Conflict` when the channel has already been settled; `413 Payload Too Large` when the body limit is exceeded; `500 Internal Server Error` for an unexpected server-side failure.

The authority is checked by the server: the `x-atn-authority` header must exactly match the payee agent ID stored on that channel. A caller-supplied header is not proof of authority by itself.

Clients hold no server or PayPal keys and cannot sign on behalf of the server. The voucher endpoint accepts a supplied signature and verifies it against the payer public key registered on the channel; this HTTP API does not provide a signing endpoint or expose private signing keys.

## Not implemented

- **Escrow HTTP routes:** Not implemented; this server currently exposes no escrow HTTP endpoints.
- **PayPal LIVE:** Not implemented; settlement uses the configured server-side adapter and this HTTP API does not enable PayPal LIVE payments.

## Commands

```sh
cd atn
npm install
npm test
npm run typecheck
npm run serve
```
