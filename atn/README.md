# ATN (core)

Infrastructure for verifiable agent-to-agent payments: integer micro-dollar money, an audited SQLite store,
signed streaming vouchers, an escrow with a structural model inspector, a payment-adapter layer, and an HTTP gateway.

## Run

```
npm install
npm run typecheck
npm test
node scripts/demo.mjs      # starts the server on a free port and runs the end-to-end demo
npm run serve              # PORT (default 8787), HOST, DB_PATH (default ./atn.db)
```

## What exists

- Money: integer micro-dollars only (src/domain/money.ts).
- Database and audit log with guard triggers (src/db, src/audit); secrets are filtered from audit payloads.
- Streaming: Ed25519 signed cumulative vouchers over WebSocket, single settlement per channel (src/streaming; README.STREAMING.md).
- Escrow and inspector: structural ONNX metadata checks, not a sandbox, no model execution (src/escrow; README.ESCROW.md).
- Payments: simulated adapter by default, PayPal sandbox adapter (never exercised against the real sandbox), idempotency store, reconciliation (README.PAYMENTS.md).
- Trust authority: delegation lookup, ceiling check, atomic reservations (src/trust; README.TRUST.md).
- HTTP gateway (src/http).

## Not implemented yet

Signed delegation tokens and request envelopes, vaults with expiry, revocation, hash-chained audit,
merchant trust scores, LLM-driven agents, and a user interface. The PayPal adapter has not been run against the live sandbox.
