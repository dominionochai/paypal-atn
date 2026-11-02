# Trust Core

## What this is

Trust Core provides server-side proof-of-agent authority. The client holds no authority; every check runs server-side against the database. A signed voucher proves that the payer said something, not that the payer was allowed to say it.

## Authorization checks

`authorize(db, { agentId, action, counterpartyId, amount, now? })` in `atn/src/trust/authority.ts` evaluates checks in this exact order and returns the first failure:

| DenyCode | Trigger |
| --- | --- |
| `UNKNOWN_AGENT` | The agent does not exist. |
| `AGENT_REVOKED` | The agent is revoked. |
| `DELEGATION_MISSING` | No delegation exists for the agent. |
| `DELEGATION_EXPIRED` | The delegation has expired. |
| `DELEGATION_REVOKED` | The delegation is revoked. |
| `COUNTERPARTY_DENIED` | The counterparty is not allowed by the delegation. |
| `SCOPE_DENIED` | The action is outside the delegation scope. |
| `CEILING_EXCEEDED` | The amount exceeds the delegation ceiling. |
| `BUDGET_EXHAUSTED` | The agent's available budget is insufficient. |

## Schema additions

`atn/src/db/migrations/007_trust.sql` adds:

- `agents.revoked_at` and `agents.budget_micro`.
- `delegations.scope_json`, `delegations.counterparty_allowlist_json`, and `delegations.revoked_at`.
- `budget_reservations.expires_at`; `budget_reservations.transaction_id` is relaxed to allow `NULL`.

A `NULL` scope means all actions; a `NULL` counterparty allowlist means any counterparty; a `NULL` `budget_micro` means unlimited budget.

## Reservation lifecycle

Reservations transition `reserve -> commit | release`. The expiry sweep marks stale `reserved` rows `expired`. If commit fails, `reserveAndCommit` releases the reservation and rethrows the error. Committing or releasing an already-final reservation is a no-op, not an error.

## Money

Money is represented as integer micro-dollars: 1 USD = 1,000,000 micro-dollars. Never use floats for money.

## Audit events

Every reserve, commit, and release writes an `audit_events` row with `entity_type`, `entity_id`, `event`, `payload`, `actor`, and `created_at`.

## Database hardening

`atn/src/db/hardening.ts` enables and reads back/verifies WAL, `foreign_keys=ON`, `synchronous=FULL`, `busy_timeout=5000`, `trusted_schema=OFF`, and `temp_store=MEMORY`. It throws if `foreign_keys` or `trusted_schema` did not apply. `db.ts` calls it before migrations.

## Not implemented

ZKP proofs, distributed or multi-process locking, per-action rate limits at the trust layer, and key rotation are not implemented.

## Commands

```sh
cd atn && npm install && npm run typecheck && npm test
```

No test run is claimed in this document.
