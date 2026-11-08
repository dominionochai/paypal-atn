# HTTP API

All bodies are JSON (`Content-Type: application/json`, 1 MiB limit). Amounts are integer micro-dollars (1 USD = 1,000,000). The request shapes below are exercised end to end by [`src/agents/client.ts`](src/agents/client.ts), `scripts/demo.mjs` and the tests.

## Authentication

- **Signed envelope.** Every `POST`, `PUT`, `PATCH` and `DELETE`, and every `GET` of a vault, channel or escrow, must carry these headers: `x-atn-agent-id`, `x-atn-nonce`, `x-atn-timestamp` (milliseconds) and `x-atn-signature`. The signature is an Ed25519 signature over `{agentId, method, path, bodySha256, nonce, timestamp}`, verified against the key registered for that agent (or principal). The server recomputes the body hash. A reused nonce, a timestamp more than 60 seconds off, a missing envelope or a wrong key is rejected.
- **Admin routes** (`/v1/principals`, `/v1/agents`) use `Authorization: Bearer <ATN_ADMIN_TOKEN>`. If `ATN_ADMIN_TOKEN` is unset they are refused.
- `GET /health` is public.

## Routes

| Route | Signed by | Body (main fields) |
| --- | --- | --- |
| `POST /v1/principals` | admin token | `externalId`, `name`, `publicKey` |
| `POST /v1/agents` | admin token | `externalId`, `principalExternalId`, `name`, `publicKey`, `budgetMicro` |
| `POST /v1/delegations` | the delegated agent presents it | `{ payload, signature }`: a delegation signed by the principal (`ceiling`, `scope`, `counterparties`, `expiresAt`, optional `minCounterpartyTrust`, `nonce`) |
| `POST /v1/vaults` | principal | `delegationId`, `funded`, `fundingRef` (64-hex commitment) |
| `GET /v1/vaults/:id` | principal | none; returns `funded`, `reserved`, `committed`, `state` |
| `POST /v1/delegations/:id/revoke` | principal | `{}` |
| `POST /v1/vaults/:id/revoke` | principal | `{}` |
| `POST /v1/channels` | payer agent | `payerAgentId`, `payeeAgentId`, `vaultId`, `ceiling`, `ttlSeconds` |
| `POST /v1/channels/:id/vouchers` | payer agent | `{ payload: {channelId, payeeAgentId, cumulativeAmount, nonce, issuedAt}, signature }` |
| `POST /v1/channels/:id/settle` | payee agent | `idempotencyKey` |
| `GET /v1/channels/:id` | a party | none |
| `POST /v1/escrows` | payer agent | `payerAgentId`, `payeeAgentId`, `amount`, `currency`, `vaultId`, `deadlineAt`, `idempotencyKey` |
| `POST /v1/escrows/:id/fund` | payer agent | `{}` |
| `POST /v1/escrows/:id/inspect` | payee agent | `artifactBase64`, `declaredMediaType` |
| `POST /v1/escrows/:id/refund` | payer agent | `{}` |
| `GET /v1/escrows/:id` | a party | none |

## Common errors

`401 MISSING_ENVELOPE` or `FORGED_SIGNATURE`; `403 FORBIDDEN` (not a party to the object); `409 REPLAYED`; `413 PAYLOAD_TOO_LARGE`; `422` with a specific code such as `COUNTERPARTY_DENIED`, `COUNTERPARTY_UNTRUSTED`, `CEILING_EXCEEDS_VAULT`, `OVER_BUDGET`, `VAULT_REVOKED`; `429 RATE_LIMITED` (default 120 requests per minute per client; raise `RATE_LIMIT_MAX`).
