/**
 * Explicit transaction state machine.
 *
 * The legal-transition table is the single source of truth for what a
 * transaction may become. It is deliberately conservative: no transition may
 * move a transaction into a state that the server would not enforce, and
 * terminal states (SETTLED, REFUNDED, REJECTED, EXPIRED, CANCELLED) absorb all
 * further moves.
 *
 * The machine is designed to be extended: separate streaming and escrow
 * machines will be derived from the base machine (see `StateMachine` and
 * `withTransitions`). Agents never get to decide their own transitions; the
 * server evaluates every move against this table.
 */

export const TRANSACTION_STATES = [
  "CREATED",
  "AUTHORIZED",
  "ACTIVE",
  "COMPLETED",
  "SETTLEMENT_PENDING",
  "SETTLED",
  "REJECTED",
  "EXPIRED",
  "CANCELLED",
  "DISPUTED",
  "VERIFICATION_PENDING",
  "VERIFICATION_FAILED",
  "REFUND_PENDING",
  "REFUND_FAILED",
  "REFUNDED",
  "SETTLEMENT_FAILED",
] as const;

export type TransactionState = (typeof TRANSACTION_STATES)[number];

export function isTransactionState(value: unknown): value is TransactionState {
  return (
    typeof value === "string" &&
    (TRANSACTION_STATES as readonly string[]).includes(value)
  );
}

export class IllegalTransitionError extends Error {
  readonly from: string;
  readonly to: string;

  constructor(from: string, to: string) {
    super(`illegal transaction state transition: ${from} -> ${to}`);
    this.name = "IllegalTransitionError";
    this.from = from;
    this.to = to;
  }
}

export type TransitionTable<S extends string = TransactionState> = Readonly<
  Record<S, ReadonlySet<S>>
>;

function dest(...states: TransactionState[]): ReadonlySet<TransactionState> {
  return new Set(states);
}

const NONE: ReadonlySet<TransactionState> = new Set();

/**
 * Base legal-transition table for the whole transaction lifecycle:
 * Authorize -> Consume -> Verify -> Settle, plus dispute, refund, and failure
 * paths. Terminal states have no outgoing transitions.
 */
export const BASE_TRANSITIONS: TransitionTable<TransactionState> = {
  CREATED: dest("AUTHORIZED", "REJECTED", "EXPIRED", "CANCELLED"),
  AUTHORIZED: dest("ACTIVE", "REJECTED", "EXPIRED", "CANCELLED"),
  ACTIVE: dest("COMPLETED", "VERIFICATION_PENDING", "DISPUTED", "EXPIRED", "CANCELLED"),
  COMPLETED: dest("VERIFICATION_PENDING", "SETTLEMENT_PENDING", "DISPUTED"),
  VERIFICATION_PENDING: dest("SETTLEMENT_PENDING", "VERIFICATION_FAILED", "DISPUTED", "EXPIRED", "CANCELLED"),
  VERIFICATION_FAILED: dest("REFUND_PENDING", "REJECTED", "DISPUTED"),
  SETTLEMENT_PENDING: dest("SETTLED", "SETTLEMENT_FAILED", "DISPUTED"),
  SETTLEMENT_FAILED: dest("REFUND_PENDING", "REJECTED", "DISPUTED", "SETTLEMENT_PENDING"),
  DISPUTED: dest("REFUND_PENDING", "SETTLEMENT_PENDING", "VERIFICATION_PENDING", "CANCELLED", "REJECTED"),
  REFUND_PENDING: dest("REFUNDED", "REFUND_FAILED", "DISPUTED"),
  REFUND_FAILED: dest("REFUND_PENDING", "DISPUTED"),
  SETTLED: NONE,
  REJECTED: NONE,
  EXPIRED: NONE,
  CANCELLED: NONE,
  REFUNDED: NONE,
};

/**
 * A generic state machine driven by an explicit legal-transition table.
 * `transition`/`assertLegal` throw `IllegalTransitionError` on any move that is
 * not in the table, including moves to/from states the machine does not know.
 */
export class StateMachine<S extends string = TransactionState> {
  constructor(private readonly table: TransitionTable<S>) {}

  can(from: S, to: S): boolean {
    if (!Object.prototype.hasOwnProperty.call(this.table, from)) {
      return false;
    }
    const destinations = this.table[from];
    if (destinations === undefined) {
      return false;
    }
    return destinations.has(to);
  }

  /** Throw if the move from -> to is not permitted by the transition table. */
  assertLegal(from: S, to: S): void {
    if (!this.can(from, to)) {
      throw new IllegalTransitionError(from, to);
    }
  }

  /**
   * Transition the machine from `from` to `to`. Throws `IllegalTransitionError`
   * on any move not in the table; otherwise returns `to`.
   */
  transition(from: S, to: S): S {
    this.assertLegal(from, to);
    return to;
  }

  /** All states reachable in one legal move from `from`. */
  legalDestinations(from: S): readonly S[] {
    const destinations = this.table[from];
    return destinations === undefined ? [] : [...destinations];
  }

  /**
   * Return a new machine with `extra` transitions merged over this table.
   * Used to derive streaming/escrow machines that share the base lifecycle.
   */
  withTransitions(extra: Readonly<Partial<Record<S, readonly S[]>>>): StateMachine<S> {
    const merged = { ...this.table } as Record<S, ReadonlySet<S>>;
    for (const from of Object.keys(extra) as S[]) {
      const additions = extra[from];
      if (additions === undefined) {
        continue;
      }
      const existing = merged[from] ?? new Set<S>();
      merged[from] = new Set<S>([...existing, ...additions]);
    }
    return new StateMachine<S>(merged);
  }
}

/** The base machine governing the full transaction lifecycle. */
export const BASE_TRANSACTION_MACHINE = new StateMachine<TransactionState>(BASE_TRANSITIONS);

/**
 * Base machine bound to the transaction lifecycle. Streaming and escrow
 * machines will be derived from this by adding their specific transitions.
 */
export class BaseTransactionMachine extends StateMachine<TransactionState> {
  constructor() {
    super(BASE_TRANSITIONS);
  }
}