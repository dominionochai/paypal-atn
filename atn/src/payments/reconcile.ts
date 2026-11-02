export interface ReconciliationPayment {
  /** Stable provider reference or local payment reference used to pair records. */
  readonly reference: string;
  /** Integer micro-dollars; never a floating-point decimal. */
  readonly amountMicros: number;
  readonly currency: string;
  readonly status: string;
}
export interface ReconciliationPair {
  readonly reference: string;
  readonly local: ReconciliationPayment;
  readonly remote: ReconciliationPayment;
}
export interface ReconciliationReport {
  readonly matched: readonly ReconciliationPair[];
  readonly local_only: readonly ReconciliationPayment[];
  readonly remote_only: readonly ReconciliationPayment[];
  readonly amount_mismatch: readonly ReconciliationPair[];
  readonly status_mismatch: readonly ReconciliationPair[];
}

function validatePayments(records: readonly ReconciliationPayment[], source: string): void {
  const references = new Set<string>();
  for (const payment of records) {
    if (!payment.reference.trim()) throw new TypeError(`${source} payment reference must not be empty`);
    if (references.has(payment.reference)) throw new TypeError(`Duplicate ${source} payment reference: ${payment.reference}`);
    references.add(payment.reference);
    if (!Number.isSafeInteger(payment.amountMicros) || payment.amountMicros < 0) throw new RangeError(`${source} amountMicros must be a non-negative safe integer`);
    if (!/^[A-Z]{3}$/.test(payment.currency)) throw new TypeError(`${source} currency must be a three-letter uppercase code`);
    if (!payment.status.trim()) throw new TypeError(`${source} payment status must not be empty`);
  }
}

/** Pure, deterministic comparison of local and fetched provider snapshots. */
export function buildReconciliationReport(
  localPayments: readonly ReconciliationPayment[],
  remotePayments: readonly ReconciliationPayment[],
): ReconciliationReport {
  validatePayments(localPayments, 'local');
  validatePayments(remotePayments, 'remote');
  const localByReference = new Map(localPayments.map((payment) => [payment.reference, payment]));
  const remoteByReference = new Map(remotePayments.map((payment) => [payment.reference, payment]));
  const matched: ReconciliationPair[] = [];
  const local_only: ReconciliationPayment[] = [];
  const remote_only: ReconciliationPayment[] = [];
  const amount_mismatch: ReconciliationPair[] = [];
  const status_mismatch: ReconciliationPair[] = [];

  for (const local of localPayments) {
    const remote = remoteByReference.get(local.reference);
    if (!remote) { local_only.push(local); continue; }
    const pair = { reference: local.reference, local, remote };
    const amountsMatch = local.amountMicros === remote.amountMicros && local.currency === remote.currency;
    const statusesMatch = local.status === remote.status;
    if (!amountsMatch) amount_mismatch.push(pair);
    if (!statusesMatch) status_mismatch.push(pair);
    if (amountsMatch && statusesMatch) matched.push(pair);
  }
  for (const remote of remotePayments) if (!localByReference.has(remote.reference)) remote_only.push(remote);
  const sortByReference = <T extends { readonly reference: string }>(items: T[]): T[] => items.sort((a, b) => a.reference.localeCompare(b.reference));
  return {
    matched: sortByReference(matched),
    local_only: sortByReference(local_only),
    remote_only: sortByReference(remote_only),
    amount_mismatch: sortByReference(amount_mismatch),
    status_mismatch: sortByReference(status_mismatch),
  };
}

/** Fetch the complete provider snapshot through an injected adapter, then compare it. */
export async function reconcilePayments(
  localPayments: readonly ReconciliationPayment[],
  fetchRemotePayments: () => Promise<readonly ReconciliationPayment[]>,
): Promise<ReconciliationReport> {
  return buildReconciliationReport(localPayments, await fetchRemotePayments());
}
