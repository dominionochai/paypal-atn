# ATN local demo

This demo exercises the ATN HTTP API in a local, isolated simulation. It starts the server on loopback with a temporary SQLite database, creates an ephemeral Ed25519 key pair, and sends signed requests to the local server. It is intended to show the request/response flow and the demo's checks for voucher spending, the channel ceiling, replay rejection, settlement authorization, and idempotent settlement. Escrow steps are conditional on the escrow routes being present in the checked-out code.

## Run it

From the repository root:

```sh
cd atn && node scripts/demo.mjs
```

The script starts and stops its local server, removes its temporary database and directory, and reports each step as `PASS`, `FAIL`, or `SKIP`. Requests and responses are printed as the flow runs, followed by a `Summary` table with columns for step, result, and detail. On a successful run, the five cumulative voucher amounts are 10,000,000 through 50,000,000 micro-dollars, and the simulated settlement total is:

```text
Exact total charged (SIMULATED): $50.000000 (50000000 micro-dollars)
```

The conversion is **$50 = 50,000,000 micro-dollars** (1 dollar = 1,000,000 micro-dollars). Optional escrow checks may be reported as skipped if those routes are unavailable. A `FAIL` indicates a failed check; the script exits nonzero if any step fails.

## What this does NOT prove

This is a local `SIMULATED`-mode demo, not a live payment test. It does **not** prove PayPal LIVE behavior, and it does not use or touch real PayPal sandbox credentials. It demonstrates only the local simulated API flow; it is not evidence that a payment was sent, that PayPal accepted anything, or that production credentials or integrations work.
