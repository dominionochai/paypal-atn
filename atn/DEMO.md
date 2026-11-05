# ATN Demo

A local demo of the real HTTP API. It starts the server on a free port, drives it with signed requests, prints a PASS / FAIL / SKIP line per step, and exits non-zero on any FAIL.

## Run

```sh
cd atn
npm install
node scripts/demo.mjs
```

## Modes

| Mode | Description |
|------|-------------|
| `SETTLEMENT_MODE=SIMULATED` (default) | Offline demo, no PayPal credentials needed. Uses SimulatedAdapter. |
| `SETTLEMENT_MODE=PAYPAL_SANDBOX` | Real PayPal sandbox calls. Requires valid credentials in `atn/.env`. |

### SIMULATED Mode (Default)

No PayPal credentials are used. Settlement runs in SIMULATED mode.

### PAYPAL_SANDBOX Mode

Set `SETTLEMENT_MODE=PAYPAL_SANDBOX` and provide valid sandbox credentials in `atn/.env`:

```env
PAYPAL_CLIENT_ID=your-sandbox-client-id
PAYPAL_CLIENT_SECRET=your-sandbox-client-secret
PAYPAL_PAYEE_EMAIL=your-payee@example.com
PAYPAL_BASE_URL=https://api-m.sandbox.paypal.com
SETTLEMENT_MODE=PAYPAL_SANDBOX
```

In this mode:
- Channel settlement uses `adapter.charge` (real PayPal CAPTURE order).
- Escrow release uses `adapter.capture` + `adapter.payout` (real PayPal Payouts API).
- The escrow hold stays a ledger hold (simulated authorize) because PayPal Orders need buyer approval.

## What it exercises (SIMULATED mode)

- Opens a $50 vault (50,000,000 micro-dollars; 1 USD = 1,000,000 micro-dollars).
- Creates a channel with ceiling 100,000 micro-dollars.
- Streams 500 signed vouchers of 200 micro-dollars each (total 100,000).
- Over-ceiling voucher rejected (HTTP 422 OVER_BUDGET).
- Replayed voucher rejected (HTTP 409).
- Settlement succeeds for the full 100,000; repeating the same idempotency key is safe.
- Vault committed 100,000, available 49,900,000 printed.
- Unsigned channel create rejected (401 MISSING_ENVELOPE).
- Wrong-principal revoke rejected (403 FORBIDDEN).
- Principal revokes delegation, subsequent spend denied (VAULT_REVOKED).
- Escrow 1: create, fund, inspect with valid artifact → RELEASED.
- Vault committed 25,100,000, available 24,900,000 printed.
- Escrow 2: create, fund, inspect with bad artifact → REFUNDED.
- Vault available back to 24,900,000 printed.

## PayPal Sandbox Smoke Test

Run the sandbox smoke test (requires valid credentials in `atn/.env`):

```sh
npm run paypal:smoke
```

Flow:
1. Token request
2. Create AUTHORIZE order, print approve URL, wait for Enter
3. Capture $0.10, then refund it
4. Second order: authorize then void
5. $0.10 payout to `PAYPAL_PAYEE_EMAIL`
6. Prints every PayPal id/status as a table; never prints secrets.
7. Exits non-zero on failure; prints specific message for 401 invalid_client.

## Known SKIP

Escrow inspect and release over HTTP in SIMULATED mode are fully implemented and tested (not SKIP). In PAYPAL_SANDBOX mode, escrow release uses real Payouts API.

## What this does NOT prove

- Real PayPal behavior beyond sandbox (no LIVE mode implemented).
- Zero-knowledge proofs (none are implemented).
- Safety across multiple processes.
- Production hardening (rate limits, WAF, etc.).