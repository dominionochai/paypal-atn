import { randomUUID } from 'node:crypto';
import { record } from '../audit/audit.js';
import type { Database } from '../db/db.js';
import type { PaymentAdapter } from '../payments/adapter.js';
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
  artifactRef: string | null;
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

export class EscrowConflictError extends Error {
  constructor(readonly idempotencyKey: string) {
    super(`Escrow idempotency key ${JSON.stringify(idempotencyKey)} was used with different parameters`);
    this.name = 'EscrowConflictError';
  }
}

function findEscrow(db: Database, escrowId: string): EscrowRow | undefined {
  return db.prepare('SELECT * FROM escrows WHERE id = ?').get(escrowId) as EscrowRow | undefined;
}

function requireEscrow(db: Database, escrowId: string): EscrowRow {
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
    row.artifact_ref === input.artifactRef
  );
}

export function createEscrow(db: Database, input: CreateEscrowInput): EscrowRow {
  if (!Number.isSafeInteger(input.amount) || input.amount <= 0) {
    throw new RangeError('Escrow amount must be a positive integer in micro-dollars');
  }
  if (!input.payerAgentId || !input.payeeAgentId || !input.currency || !input.idempotencyKey) {
    throw new TypeError('Escrow agent IDs, currency, and idempotency key must not be empty');
  }

  return db.transaction(() => {
    const existing = db
      .prepare('SELECT * FROM escrows WHERE idempotency_key = ?')
      .get(input.idempotencyKey) as EscrowRow | undefined;
    if (existing) {
      if (!sameCreateParams(existing, input)) throw new EscrowConflictError(input.idempotencyKey);
      return existing;
    }

    const now = Date.now();
    const id = randomUUID();
    db.prepare(
      `INSERT INTO escrows
        (id, payer_agent_id, payee_agent_id, amount, currency, status, artifact_ref,
         idempotency_key, created_at, funded_at, released_at, refunded_at)
       VALUES (?, ?, ?, ?, ?, 'CREATED', ?, ?, ?, NULL, NULL, NULL)`,
    ).run(
      id,
      input.payerAgentId,
      input.payeeAgentId,
      input.amount,
      input.currency,
      input.artifactRef,
      input.idempotencyKey,
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
  assertState(escrow, 'CREATED');

  try {
    await adapter.charge({
      amount: escrow.amount,
      currency: escrow.currency,
      idempotencyKey: escrow.idempotency_key,
      channelId: escrow.id,
    });
  } catch (error) {
    db.transaction(() => {
      const current = requireEscrow(db, escrowId);
      if (current.status !== 'CREATED') return;
      const now = Date.now();
      const update = db
        .prepare("UPDATE escrows SET status = 'FAILED' WHERE id = ? AND status = 'CREATED'")
        .run(escrowId);
      if (update.changes !== 1) throw new EscrowStateError(escrowId, 'CREATED', requireEscrow(db, escrowId).status);
      appendTransition(db, escrowId, 'FAILED', { status: 'FAILED', cause: error instanceof Error ? error.name : 'unknown' }, now);
    })();
    throw error;
  }

  return db.transaction(() => {
    const current = requireEscrow(db, escrowId);
    assertState(current, 'CREATED');
    const now = Date.now();
    const update = db
      .prepare("UPDATE escrows SET status = 'FUNDED', funded_at = ? WHERE id = ? AND status = 'CREATED'")
      .run(now, escrowId);
    if (update.changes !== 1) throw new EscrowStateError(escrowId, 'CREATED', requireEscrow(db, escrowId).status);
    appendTransition(db, escrowId, 'FUNDED', { from: 'CREATED', status: 'FUNDED' }, now);
    return requireEscrow(db, escrowId);
  })();
}

export function inspectEscrow(
  db: Database,
  escrowId: string,
  artifactBytes: Buffer,
  declaredMediaType: string,
): InspectionResult {
  db.transaction(() => {
    const current = requireEscrow(db, escrowId);
    assertState(current, 'FUNDED');
    const now = Date.now();
    const update = db
      .prepare("UPDATE escrows SET status = 'INSPECTING' WHERE id = ? AND status = 'FUNDED'")
      .run(escrowId);
    if (update.changes !== 1) throw new EscrowStateError(escrowId, 'FUNDED', requireEscrow(db, escrowId).status);
    appendTransition(db, escrowId, 'INSPECTING', { from: 'FUNDED', status: 'INSPECTING' }, now);
  })();

  const result = inspectArtifact({ bytes: artifactBytes, declaredMediaType });
  const detail = {
    outcome: result.outcome,
    reasons: result.reasons,
    artifactSha256: result.artifactSha256,
    artifactBytes: result.artifactBytes,
  };

  db.transaction(() => {
    const current = requireEscrow(db, escrowId);
    assertState(current, 'INSPECTING');
    const now = Date.now();
    db.prepare(
      `INSERT INTO artifact_inspections
        (escrow_id, outcome, reasons, artifact_sha256, artifact_bytes, inspected_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
    ).run(escrowId, result.outcome, JSON.stringify(result.reasons), result.artifactSha256, result.artifactBytes, now);

    const nextStatus = result.outcome === 'PASS' ? 'RELEASED' : 'FUNDED';
    const update = db
      .prepare(
        `UPDATE escrows
         SET status = ?, released_at = CASE WHEN ? = 'RELEASED' THEN ? ELSE released_at END
         WHERE id = ? AND status = 'INSPECTING'`,
      )
      .run(nextStatus, nextStatus, now, escrowId);
    if (update.changes !== 1) throw new EscrowStateError(escrowId, 'INSPECTING', requireEscrow(db, escrowId).status);

    const event = result.outcome === 'PASS' ? 'RELEASED' : 'INSPECTION_NON_PASS';
    appendTransition(db, escrowId, event, { from: 'INSPECTING', status: nextStatus, ...detail }, now);
  })();

  return result;
}

export function refundEscrow(db: Database, escrowId: string): EscrowRow {
  return db.transaction(() => {
    const current = requireEscrow(db, escrowId);
    if (current.status !== 'FUNDED' && current.status !== 'INSPECTING') {
      throw new EscrowStateError(escrowId, 'FUNDED or INSPECTING', current.status);
    }
    const now = Date.now();
    const update = db
      .prepare(
        "UPDATE escrows SET status = 'REFUNDED', refunded_at = ? WHERE id = ? AND status IN ('FUNDED', 'INSPECTING')",
      )
      .run(now, escrowId);
    if (update.changes !== 1) throw new EscrowStateError(escrowId, 'FUNDED or INSPECTING', requireEscrow(db, escrowId).status);
    appendTransition(db, escrowId, 'REFUNDED', { from: current.status, status: 'REFUNDED' }, now);
    return requireEscrow(db, escrowId);
  })();
}
