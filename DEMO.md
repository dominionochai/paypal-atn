# ATN Offline Demo

This guide describes the local, simulated ATN demo. It is documentation only; no claim is made here that the demo has been run.

## Prerequisites

From the repository root, install the project dependencies:

```sh
npm install
```

The project must have `tsx` available as a development dependency for the demo script.

## Run

From the repository root, run exactly:

```sh
cd atn && node scripts/demo.mjs
```

The demo is intended to run offline against simulated behavior. It does not require real PayPal credentials or make PayPal LIVE calls.

## What the demo exercises

The local scenarios are intended to demonstrate and report on:

- **Server-side authorization:** authorization is checked by the server-side flow, rather than relying only on a client/UI decision.
- **Ceiling enforcement:** an operation that exceeds the configured ceiling is rejected.
- **Replay rejection:** a replayed request is rejected instead of being accepted as a fresh operation.
- **Settlement idempotency:** repeating a settlement operation does not apply the settlement more than once.
- **Escrow inspect/release:** the demo attempts to inspect escrow state and exercise the release flow when that endpoint is available.
- **Offline simulation:** the scenarios use simulated/local behavior and do not contact PayPal LIVE or use real sandbox credentials.

For amount examples, **$50 = 50,000,000 micro-dollars**, using **1 USD = 1,000,000 micro-dollars**.

## Reading the summary

The expected summary is a table with a check name, a status, and optional details, for example:

| Check | Status | Details |
| --- | --- | --- |
| Server-side authorization | PASS / FAIL / SKIP | Scenario result or reason |
| Ceiling enforcement | PASS / FAIL / SKIP | Scenario result or reason |
| Replay rejection | PASS / FAIL / SKIP | Scenario result or reason |
| Settlement idempotency | PASS / FAIL / SKIP | Scenario result or reason |
| Escrow inspect/release | PASS / FAIL / SKIP | Scenario result or reason |

- **PASS** means the expected behavior was observed for that scenario.
- **FAIL** means the expected behavior was not observed, or the scenario encountered an unexpected error.
- **SKIP** means a scenario could not or should not be exercised in the current environment; it is not evidence of a pass.
- If the escrow endpoint returns **404**, report escrow as **SKIP** rather than treating the unavailable endpoint as a successful release or as proof of the escrow behavior.

## What this does NOT prove

- It does **not** prove PayPal LIVE behavior or use real PayPal sandbox credentials; those remain untouched.
- It does **not** prove zero-knowledge-proof (ZKP) behavior.
- It does **not** prove multiprocess locking or concurrency safety across multiple processes.
- Any demo canonicalization logic is a reconstruction of `signing.ts`, not an authoritative verification of it; the canonicalization must be rechecked against `signing.ts` before relying on it.
