# ATN core

The implementation behind the three layers described in the [root README](../README.md): Proof-of-Agent, Neural Streaming and VeriPay Escrow.

```
npm ci
npm run typecheck
npm test
node scripts/demo.mjs
npm run scenario -- all
npm run serve        # PORT (default 8787), HOST, DB_PATH (default ./atn.db), ATN_ADMIN_TOKEN
```

Module documents: [HTTP API](README.API.md), [agents](README.AGENTS.md), [streaming](README.STREAMING.md), [escrow](README.ESCROW.md), [payments](README.PAYMENTS.md), [trust](README.TRUST.md). A recorded PayPal sandbox run is in [docs/PAYPAL_SANDBOX_PROOF.md](docs/PAYPAL_SANDBOX_PROOF.md).
