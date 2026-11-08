# ATN demo

A local, offline run of the full lifecycle against the real HTTP API. It starts the server on a free port, registers a principal and agents, and prints PASS or FAIL for each step. It exits non-zero on any failure, and uses simulated settlement, so no credentials are needed.

```
cd atn
npm ci
node scripts/demo.mjs        # about 3 seconds
```

## Steps it checks

1. The server starts and answers `/health`.
2. The principal opens a $50 vault from a signed delegation.
3. A channel opens with a $0.10 ceiling, and 500 signed vouchers of 200 micro-dollars are accepted.
4. A voucher above the ceiling is rejected (422), and a replayed voucher is rejected (409).
5. Settlement pays exactly 100,000 micro-dollars once, and repeating it is safe.
6. Escrow 1: create, fund, inspect a valid artifact, released. The vault shows committed 25,100,000 and available 24,900,000.
7. Escrow 2: a bad artifact is refunded, and the vault's available balance returns to 24,900,000.
8. An unsigned request is rejected (401), and a wrong-principal revoke is rejected (403).
9. The principal revokes the delegation, and a new channel is then refused.
10. The total charged equals 100,000 micro-dollars.

## More

- `npm run scenario -- all`: five agent scenarios with a deterministic model (add `--live` for Gemini).
- `npm run paypal:smoke`: the real PayPal sandbox flow, which needs credentials and two manual buyer approvals. A recorded run is in [`atn/docs/PAYPAL_SANDBOX_PROOF.md`](atn/docs/PAYPAL_SANDBOX_PROOF.md).

## What the demo does not prove

- Real PayPal behavior: the demo uses simulated settlement. Use the smoke script for the sandbox.
- That a language model resists prompt injection: use `npm run scenario -- prompt-injection --live`.
- Safety beyond a single process on one SQLite database.
- Zero-knowledge proofs: none are implemented. Delegations are Ed25519-signed.
