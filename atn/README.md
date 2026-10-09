# PayPal ATN — Autonomous Trust Network

The infrastructure layer that lets AI agents transact under verifiable
authorization.

Lifecycle: **Authorize → Consume → Verify → Settle**.

Core principle: agents perform work; ATN controls the transaction. Agents may
never grant themselves authority, raise their own ceiling, or declare their own
deliverable verified. All financial and authorization rules are enforced
server-side and are independent of any prompt.

## What exists (Milestone 0)

This milestone is the **foundation only**. No signing, no vouchers, no escrow,
no HTTP routes.

- **Money** (`src/domain/money.ts`) — integer micro-dollars (1 USD = 1_000_000).
  Parsing and formatting use BigInt only; arithmetic is integer-only. No
  floating-point money anywhere. Rejects negative amounts, non-numeric input,
  and values beyond `Number.MAX_SAFE_INTEGER`.
- **State machine** (`src/domain/state.ts`) — explicit legal-transition table
  for the 15 transaction states. `transition(from, to)` throws
  `IllegalTransitionError` on any move that is not in the table. The machine is
  extensible (`StateMachine`, `withTransitions`) so separate streaming and
  escrow machines can be derived from the shared base later.
- **Database** (`src/db/schema.sql`, `src/db/db.ts`,
  `src/db/migrations/001_initial.sql`) — SQLite schema for principals, agents,
  delegations, transactions (with a `version` column for optimistic
  concurrency), budget reservations, and an append-only audit log. Money is
  stored as `INTEGER` micro-dollars. `CHECK` constraints reject negative
  amounts; `UNIQUE` constraints protect external ids; audit
  `UPDATE`/`DELETE` are blocked by database triggers. A migration runner
  tracks applied migrations in `_migrations` and is idempotent.
- **Audit** (`src/audit/audit.ts`) — `record(event)` inserts a row *inside the
  caller's transaction* (it does not open one of its own), so an audit event
  commits or rolls back with the business change it describes. There is no
  update or delete path. Payloads containing secret-bearing keys are rejected
  before serialization; secrets are never logged.

## What is NOT implemented (yet)

- Signing / ZKP / proof-of-agent authorization.
- Vouchers, streaming state channels, channel balance ledgers.
- Escrow locking, sandboxed verification, asset delivery.
- Settlement or refund execution (the rail itself).
- HTTP routes, WebSockets, or any network call.
- Optimistic-concurrency writes (the `version` column exists; the compare-and-
  swap write path is future work).
- Budget ceiling enforcement logic (the schema stores ceilings; enforcement is
  a later milestone).
- Any persistence of secrets or credentials.

## Assumptions

- All amounts are USD and stored as integer micro-dollars. A dollar string
  with more than six fractional digits is rejected as unrepresentable.
- Money values are non-negative; negative balances are not modeled.
- The 15 states and the base transition table are a server-side contract; the
  DB `CHECK` on `transactions.state` mirrors the domain enum.
- The base transition table is intentionally permissive where later machines
  will restrict: streaming and escrow machines will specialize it.
- The audit log is tamper-evident at the schema level (no UPDATE/DELETE) but is
  not cryptographically chained or signed yet.
- One budget reservation per transaction (UNIQUE `transaction_id`).
- SQLite is the storage engine for this milestone; nothing in the domain layer
  depends on it.

## Usage

```sh
npm install
npm run typecheck   # strict TypeScript check
npm test            # vitest suite
npm run build       # emit dist/ (includes copying SQL migrations)
npm run dev         # tsx watch on src/index.ts
```

The public surface is re-exported from `src/index.ts`.