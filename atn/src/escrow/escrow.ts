import { randomUUID } from 'node:crypto';
import { record } from '../audit/audit.js';
import type { Database } from '../db/db.js';
import type { PaymentAdapter } from '../payments/adapter.js';
import { getVault, release, reserveForChannel, updateMerchantTrust } from '../trust/authority.js';
import { inspectArtifact, type InspectionResult } from './inspector.js';

export interface EscrowRow {
  id: string;
  payer_agent_id: string;
  payee_agent_id: string;
  amount: number;
  currency: string;
  status: 'CREATED' | 'FUNDED' | 'INSPECTING' | 'RELEASED' | 'REFUNDED' | 'FAILED';
  artifact_ref: string | null;
  idempotency_key: string;
  vault_id: string | null;
  reservation_ref: string | null;
  deadline_at: number | null;
  attempts: number;
  spec: string | null;
  auth_ref: string | null;
  capture_ref: string | null;
  payout_ref: string | null;
  created_at: number;
  funded_at: number | null;
  released_at: number | null;
  refunded_at: number | null;
}

export interface CreateEscrowInput {
  payerAgentId: string;
  payeeAgentId: string;
  amount: number;
  currency: string;
  vaultId: string;
  deadlineAt: number;
  spec?: string | null;
  artifactRef?: string | null;
  idempotencyKey: string;
}

export class EscrowNotFoundError extends Error {
  constructor(readonly escrowId: string) {
    super(`Escrow ${escrowId} was not found`);
    this.name = 'EscrowNotFoundError';
  }
}

export class EscrowStateError extends Error {
  constructor(readonly escrowId: string, expected: string, readonly actual: string) {
    super(`Escrow ${escrowId} must be ${expected}; current state is ${actual}`);
    this.name = 'EscrowStateError';
  }
}

export class EscrowCounterpartyError extends Error {
  constructor(detail: string) {
    super(detail);
    this.name = 'EscrowCounterpartyError';
  }
}

export class EscrowConflictError extends Error {
  constructor(readonly idempotencyKey: string) {
    super(`Escrow idempotency key ${JSON.stringify(idempotencyKey)} was used with different parameters`);
    this.name = 'EscrowConflictError';
  }
}

export function findEscrow(db: Database, escrowId: string): EscrowRow | undefined {
  return db.prepare('SELECT * FROM escrows WHERE id = ?').get(escrowId) as EscrowRow | undefined;
}

export function requireEscrow(db: Database, escrowId: string): EscrowRow {
  const row = findEscrow(db, escrowId);
  if (!row) throw new EscrowNotFoundError(escrowId);
  return row;
}

function assertState(row: EscrowRow, expected: string): void {
  if (row.status !== expected) throw new EscrowStateError(row.id, expected, row.status);
}

function appendTransition(
  db: Database,
  escrowId: string,
  event: string,
  detail: Readonly<Record<string, unknown>>,
  createdAt: number,
): void {
  const detailJson = JSON.stringify(detail);
  db.prepare(
    'INSERT INTO escrow_events (escrow_id, event, detail, created_at) VALUES (?, ?, ?, ?)',
  ).run(escrowId, event, detailJson, createdAt);
  record(db, {
    entityType: 'escrow',
    entityId: null,
    event: `escrow.${event.toLowerCase()}`,
    payload: { escrowId, ...detail },
    actor: 'system',
  });
}

function sameCreateParams(row: EscrowRow, input: CreateEscrowInput): boolean {
  return (
    row.payer_agent_id === input.payerAgentId &&
    row.payee_agent_id === input.payeeAgentId &&
    row.amount === input.amount &&
    row.currency === input.currency &&
    row.vault_id === input.vaultId
  );
}

export function createEscrow(db: Database, input: CreateEscrowInput): EscrowRow {
  if (!Number.isSafeInteger(input.amount) || input.amount <= 0) {
    throw new RangeError('Escrow amount must be a positive integer in micro-dollars');
  }
  if (!input.payerAgentId || !input.payeeAgentId || !input.currency || !input.idempotencyKey || !input.vaultId) {
    throw new TypeError('Escrow agent IDs, currency, vaultId, and idempotency key must not be empty');
  }

  return db.transaction(() => {
    const existing = db
      .prepare('SELECT * FROM escrows WHERE idempotency_key = ?')
      .get(input.idempotencyKey) as EscrowRow | undefined;
    if (existing) {
      if (!sameCreateParams(existing, input)) throw new EscrowConflictError(input.idempotencyKey);
      return existing;
    }

    const vault = getVault(db, input.vaultId);
    if (!vault || vault.state !== 'OPEN') {
      throw new Error('Vault not found or not open');
    }
    const payee = db.prepare('SELECT revoked_at FROM agents WHERE external_id = ?').get(input.payeeAgentId) as { revoked_at: number | null } | undefined;
    if (payee === undefined) throw new EscrowCounterpartyError('Payee agent not found');
    if (payee.revoked_at !== null) throw new EscrowCounterpartyError('Payee agent is revoked');
    const delegation = db.prepare('SELECT counterparty_allowlist_json FROM delegations WHERE id = ?').get(vault.delegation_id) as { counterparty_allowlist_json: string | null } | undefined;
    const allowedPayees = JSON.parse(delegation?.counterparty_allowlist_json || '[]') as string[];
    if (!allowedPayees.includes(input.payeeAgentId)) throw new EscrowCounterpartyError('Payee not in delegation counterparties');
    const now = Date.now();
    const ttlSeconds = Math.max(1, Math.ceil((input.deadlineAt - now) / 1000));
    const reservation = reserveForChannel(db, input.vaultId, input.amount, ttlSeconds, now);

    const id = randomUUID();
    db.prepare(
      `INSERT INTO escrows
        (id, payer_agent_id, payee_agent_id, amount, currency, status, artifact_ref,
         idempotency_key, vault_id, reservation_ref, deadline_at, attempts, spec, created_at, funded_at, released_at, refunded_at)
        VALUES (?, ?, ?, ?, ?, 'CREATED', ?, ?, ?, ?, ?, 0, ?, ?, NULL, NULL, NULL)`,
    ).run(
      id,
      input.payerAgentId,
      input.payeeAgentId,
      input.amount,
      input.currency,
      input.artifactRef ?? `escrow_${id}`,
      input.idempotencyKey,
      input.vaultId,
      reservation.reservationId,
      input.deadlineAt,
      input.spec ?? null,
      now,
    );
    appendTransition(db, id, 'CREATED', { status: 'CREATED' }, now);
    return requireEscrow(db, id);
  })();
}

export async function fundEscrow(
  db: Database,
  escrowId: string,
  adapter: PaymentAdapter,
): Promise<EscrowRow> {
  const escrow = requireEscrow(db, escrowId);
  if (escrow.status === 'FUNDED') return escrow;
  assertState(escrow, 'CREATED');

  let authResult: { ref: string } | null = null;
  let authError: Error | null = null;
  try {
    authResult = await adapter.authorize({
      amount: escrow.amount,
      currency: escrow.currency,
      idempotencyKey: `${escrow.idempotency_key}-auth`,
      escrowId: escrow.id,
    });
  } catch (error) {
    authError = error instanceof Error ? error : new Error(String(error));
  }

  if (authError || !authResult) {
    db.transaction(() => {
      const current = requireEscrow(db, escrowId);
      if (current.status !== 'CREATED') return;
      const now = Date.now();
      db.prepare("UPDATE escrows SET status = 'FAILED' WHERE id = ? AND status = 'CREATED'").run(escrowId);
      if (current.reservation_ref) {
        release(db, current.reservation_ref, now);
      }
      appendTransition(db, escrowId, 'FAILED', { status: 'FAILED', cause: authError?.message ?? 'auth failed' }, now);
    })();
    throw authError ?? new Error('Authorization failed');
  }

  return db.transaction(() => {
    const current = requireEscrow(db, escrowId);
    if (current.status === 'FUNDED') return current;
    assertState(current, 'CREATED');
    const now = Date.now();
    const update = db
      .prepare("UPDATE escrows SET status = 'FUNDED', auth_ref = ?, funded_at = ? WHERE id = ? AND status = 'CREATED'")
      .run(authResult!.ref, now, escrowId);
    if (update.changes !== 1) throw new EscrowStateError(escrowId, 'CREATED', requireEscrow(db, escrowId).status);
    appendTransition(db, escrowId, 'FUNDED', { from: 'CREATED', status: 'FUNDED' }, now);
    return requireEscrow(db, escrowId);
  })();
}

export async function inspectEscrow(
  db: Database,
  escrowId: string,
  artifactBytes: Buffer,
  declaredMediaType: string,
  adapter: PaymentAdapter,
): Promise<InspectionResult> {
  const initialEscrow = requireEscrow(db, escrowId);
  if (initialEscrow.status === 'RELEASED') {
    return { outcome: 'PASS', reasons: ['ALREADY_RELEASED'], artifactSha256: '', artifactBytes: 0 };
  }
  if (initialEscrow.status === 'REFUNDED') {
    return { outcome: 'FAIL', reasons: ['ALREADY_REFUNDED'], artifactSha256: '', artifactBytes: 0 };
  }
  if (initialEscrow.status !== 'FUNDED') {
    throw new EscrowStateError(escrowId, 'FUNDED', initialEscrow.status);
  }

  db.transaction(() => {
    const current = requireEscrow(db, escrowId);
    if (current.status === 'FUNDED') {
      const now = Date.now();
      db.prepare("UPDATE escrows SET status = 'INSPECTING' WHERE id = ? AND status = 'FUNDED'").run(escrowId);
      appendTransition(db, escrowId, 'INSPECTING', { from: 'FUNDED', status: 'INSPECTING' }, now);
    }
  })();

  const result = inspectArtifact({ bytes: artifactBytes, declaredMediaType });
  const detail = {
    outcome: result.outcome,
    reasons: result.reasons,
    artifactSha256: result.artifactSha256,
    artifactBytes: result.artifactBytes,
  };

  const current = requireEscrow(db, escrowId);
  if (result.outcome === 'PASS') {
    let captureRef = current.capture_ref;
    if (!captureRef) {
      const capResult = await adapter.capture({
        authRef: current.auth_ref ?? 'mock-auth',
        amount: current.amount,
        idempotencyKey: `${current.idempotency_key}-capture`,
      });
      captureRef = capResult.ref;
      db.prepare('UPDATE escrows SET capture_ref = ? WHERE id = ?').run(captureRef, escrowId);
    }

    await adapter.payout({
      amount: current.amount,
      currency: current.currency,
      payeeRef: current.payee_agent_id,
      idempotencyKey: `${current.idempotency_key}-payout`,
    });

    db.transaction(() => {
      const cur = requireEscrow(db, escrowId);
      const now = Date.now();
      db.prepare(
        `INSERT INTO artifact_inspections
          (escrow_id, outcome, reasons, artifact_sha256, artifact_bytes, inspected_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
      ).run(escrowId, result.outcome, JSON.stringify(result.reasons), result.artifactSha256, result.artifactBytes, now);

      db.prepare("UPDATE escrows SET status = 'RELEASED', released_at = ? WHERE id = ?").run(now, escrowId);

      if (cur.vault_id && cur.reservation_ref) {
        db.prepare('UPDATE vaults SET reserved = reserved - ?, committed = committed + ? WHERE id = ?')
          .run(cur.amount, cur.amount, cur.vault_id);
        db.prepare("UPDATE budget_reservations SET status = 'SETTLED', amount = ? WHERE reservation_ref = ?")
          .run(cur.amount, cur.reservation_ref);
      }

      updateMerchantTrust(db, cur.payee_agent_id, +10, 'ESCROW_PASS', cur.id);
      appendTransition(db, escrowId, 'RELEASED', { from: 'INSPECTING', status: 'RELEASED', ...detail }, now);
    })();
  } else if (result.outcome === 'FAIL') {
    await adapter.voidAuthorization({
      authRef: current.auth_ref ?? 'mock-auth',
      idempotencyKey: `${current.idempotency_key}-void`,
    });

    db.transaction(() => {
      const cur = requireEscrow(db, escrowId);
      const now = Date.now();
      db.prepare(
        `INSERT INTO artifact_inspections
          (escrow_id, outcome, reasons, artifact_sha256, artifact_bytes, inspected_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
      ).run(escrowId, result.outcome, JSON.stringify(result.reasons), result.artifactSha256, result.artifactBytes, now);

      db.prepare("UPDATE escrows SET status = 'REFUNDED', refunded_at = ? WHERE id = ?").run(now, escrowId);

      if (cur.reservation_ref) {
        release(db, cur.reservation_ref, now);
      }

      updateMerchantTrust(db, cur.payee_agent_id, -50, 'ESCROW_FAIL', cur.id);
      appendTransition(db, escrowId, 'INSPECTION_NON_PASS', { from: 'INSPECTING', status: 'REFUNDED', ...detail }, now);
    })();
  } else {
    // INCONCLUSIVE
    let autoRefund = false;
    db.transaction(() => {
      const cur = requireEscrow(db, escrowId);
      const now = Date.now();
      db.prepare(
        `INSERT INTO artifact_inspections
          (escrow_id, outcome, reasons, artifact_sha256, artifact_bytes, inspected_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
      ).run(escrowId, result.outcome, JSON.stringify(result.reasons), result.artifactSha256, result.artifactBytes, now);

      const nextAttempts = cur.attempts + 1;
      if (nextAttempts >= 3) {
        autoRefund = true;
        db.prepare("UPDATE escrows SET attempts = ?, status = 'REFUNDED', refunded_at = ? WHERE id = ?").run(nextAttempts, now, escrowId);
        if (cur.reservation_ref) {
          release(db, cur.reservation_ref, now);
        }
        appendTransition(db, escrowId, 'INSPECTION_NON_PASS', { from: 'INSPECTING', status: 'REFUNDED', attempts: nextAttempts, autoRefund: true, ...detail }, now);
      } else {
        db.prepare("UPDATE escrows SET attempts = ?, status = 'FUNDED' WHERE id = ?").run(nextAttempts, escrowId);
        appendTransition(db, escrowId, 'INSPECTION_NON_PASS', { from: 'INSPECTING', status: 'FUNDED', attempts: nextAttempts, ...detail }, now);
      }
    })();

    if (autoRefund) {
      try {
        await adapter.voidAuthorization({
          authRef: current.auth_ref ?? 'mock-auth',
          idempotencyKey: `${current.idempotency_key}-void-auto`,
        });
      } catch {}
    }
  }

  return result;
}

export async function refundEscrow(db: Database, escrowId: string, adapter: PaymentAdapter): Promise<EscrowRow> {
  const current = requireEscrow(db, escrowId);
  if (current.status === 'REFUNDED') return current;
  if (current.status !== 'FUNDED' && current.status !== 'INSPECTING') {
    throw new EscrowStateError(escrowId, 'FUNDED or INSPECTING', current.status);
  }

  if (current.auth_ref) {
    try {
      await adapter.voidAuthorization({
        authRef: current.auth_ref,
        idempotencyKey: `${current.idempotency_key}-refund`,
      });
    } catch {}
  }

  return db.transaction(() => {
    const cur = requireEscrow(db, escrowId);
    if (cur.status === 'REFUNDED') return cur;
    const now = Date.now();
    db.prepare("UPDATE escrows SET status = 'REFUNDED', refunded_at = ? WHERE id = ?").run(now, escrowId);
    if (cur.reservation_ref) {
      release(db, cur.reservation_ref, now);
    }
    appendTransition(db, escrowId, 'REFUNDED', { from: cur.status, status: 'REFUNDED' }, now);
    return requireEscrow(db, escrowId);
  })();
}

export async function sweepStaleEscrows(db: Database, adapter: PaymentAdapter, now?: number): Promise<void> {
  const nowMs = now ?? Date.now();
  const staleEscrows = db.prepare(
    "SELECT * FROM escrows WHERE status IN ('FUNDED', 'INSPECTING') AND deadline_at IS NOT NULL AND deadline_at <= ?"
  ).all(nowMs) as EscrowRow[];

  for (const escrow of staleEscrows) {
    if (escrow.auth_ref) {
      try {
        await adapter.voidAuthorization({
          authRef: escrow.auth_ref,
          idempotencyKey: `${escrow.idempotency_key}-sweep`,
        });
      } catch {}
    }
    db.transaction(() => {
      const cur = requireEscrow(db, escrow.id);
      if (cur.status !== 'FUNDED' && cur.status !== 'INSPECTING') return;
      const ts = Date.now();
      db.prepare("UPDATE escrows SET status = 'REFUNDED', refunded_at = ? WHERE id = ?").run(ts, escrow.id);
      if (cur.reservation_ref) {
        release(db, cur.reservation_ref, ts);
      }
      appendTransition(db, escrow.id, 'REFUNDED', { from: cur.status, status: 'REFUNDED', reason: 'deadline_expired' }, ts);
    })();
  }
}