import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createDatabase, type Database } from '../src/db/db';
import {
  createEscrow,
  EscrowConflictError,
  EscrowStateError,
  fundEscrow,
  inspectEscrow,
  refundEscrow,
  type EscrowRow,
} from '../src/escrow/escrow';
import { inspectArtifact } from '../src/escrow/inspector';

const VALID_PROTOBUF = Buffer.from([0x08, 0x01, 0x12, 0x01, 0x78]);
const MEDIA_TYPE = 'application/octet-stream';

let db: Database;
let tempDir: string;

beforeEach(() => {
  tempDir = mkdtempSync(join(tmpdir(), 'paypal-atn-escrow-'));
  db = createDatabase(join(tempDir, 'escrow.sqlite'));
});

afterEach(() => {
  db.close();
  rmSync(tempDir, { recursive: true, force: true });
});

function createTestEscrow(idempotencyKey = 'escrow-key') {
  return createEscrow(db, {
    payerAgentId: 'payer-agent',
    payeeAgentId: 'payee-agent',
    amount: 250_000,
    currency: 'USD',
    artifactRef: 'artifact://minimal-model',
    idempotencyKey,
  });
}

const resolvingAdapter = {
  charge: async () => ({ ref: 'charge-reference', mode: 'SIMULATED' as const }),
};

async function createFundedEscrow(idempotencyKey = 'funded-key'): Promise<EscrowRow> {
  const escrow = createTestEscrow(idempotencyKey);
  return fundEscrow(db, escrow.id, resolvingAdapter);
}

function eventsFor(escrowId: string): string[] {
  const rows = db
    .prepare('SELECT event FROM escrow_events WHERE escrow_id = ? ORDER BY id')
    .all(escrowId) as Array<{ event: string }>;
  return rows.map((row) => row.event);
}

function expectEvents(escrowId: string, expected: string[]) {
  expect(eventsFor(escrowId)).toEqual(expected);
}

describe('escrow lifecycle', () => {
  it('creates a CREATED row and writes its escrow event', () => {
    const escrow = createTestEscrow();

    expect(escrow.status).toBe('CREATED');
    expect(escrow.id).toEqual(expect.any(String));
    expect(escrow.amount).toBe(250_000);
    expect(escrow.funded_at).toBeNull();
    expectEvents(escrow.id, ['CREATED']);
  });

  it('returns the same row for a repeated idempotency key without duplicating it', () => {
    const first = createTestEscrow('same-key');
    const retry = createTestEscrow('same-key');
    const count = db.prepare('SELECT COUNT(*) AS n FROM escrows').get() as { n: number };

    expect(retry).toEqual(first);
    expect(count.n).toBe(1);
    expectEvents(first.id, ['CREATED']);
  });

  it('throws the exported conflict error when a key is reused with a different amount', () => {
    const first = createTestEscrow('conflicting-key');
    expect(() =>
      createEscrow(db, {
        payerAgentId: 'payer-agent',
        payeeAgentId: 'payee-agent',
        amount: 250_001,
        currency: 'USD',
        artifactRef: 'artifact://minimal-model',
        idempotencyKey: 'conflicting-key',
      }),
    ).toThrow(EscrowConflictError);

    const count = db.prepare('SELECT COUNT(*) AS n FROM escrows').get() as { n: number };
    expect(count.n).toBe(1);
    expectEvents(first.id, ['CREATED']);
  });

  it('moves CREATED to FUNDED, sets funded_at, and records the transition', async () => {
    const escrow = createTestEscrow('fund-success');
    const funded = await fundEscrow(db, escrow.id, resolvingAdapter);

    expect(funded.status).toBe('FUNDED');
    expect(funded.funded_at).toEqual(expect.any(Number));
    expectEvents(escrow.id, ['CREATED', 'FUNDED']);
  });

  it('marks funding as FAILED and rethrows when the adapter rejects', async () => {
    const escrow = createTestEscrow('fund-failure');
    const rejection = new Error('adapter rejected the charge');
    const rejectingAdapter = {
      charge: async () => {
        throw rejection;
      },
    };

    await expect(fundEscrow(db, escrow.id, rejectingAdapter)).rejects.toBe(rejection);
    const stored = db.prepare('SELECT status FROM escrows WHERE id = ?').get(escrow.id) as {
      status: string;
    };
    expect(stored.status).toBe('FAILED');
    expectEvents(escrow.id, ['CREATED', 'FAILED']);
  });

  it('rejects inspection of a CREATED, unfunded escrow with the exported state error', () => {
    const escrow = createTestEscrow('inspect-created');

    expect(() => inspectEscrow(db, escrow.id, VALID_PROTOBUF, MEDIA_TYPE)).toThrow(EscrowStateError);
    expectEvents(escrow.id, ['CREATED']);
  });

  it('releases a FUNDED escrow after a passing artifact inspection and persists the inspection', async () => {
    const escrow = await createFundedEscrow('inspect-pass');
    const result = inspectEscrow(db, escrow.id, VALID_PROTOBUF, MEDIA_TYPE);
    const stored = db.prepare('SELECT status FROM escrows WHERE id = ?').get(escrow.id) as {
      status: string;
    };
    const inspection = db
      .prepare('SELECT outcome, reasons, artifact_bytes FROM artifact_inspections WHERE escrow_id = ?')
      .get(escrow.id) as { outcome: string; reasons: string; artifact_bytes: number };

    expect(result.outcome).toBe('PASS');
    expect(stored.status).toBe('RELEASED');
    expect(inspection.outcome).toBe('PASS');
    expect(JSON.parse(inspection.reasons)).toEqual(result.reasons);
    expect(inspection.artifact_bytes).toBe(VALID_PROTOBUF.length);
    expectEvents(escrow.id, ['CREATED', 'FUNDED', 'INSPECTING', 'RELEASED']);
  });

  it('keeps a FUNDED escrow when its artifact inspection fails and persists FAIL', async () => {
    const escrow = await createFundedEscrow('inspect-fail');
    const result = inspectEscrow(db, escrow.id, Buffer.from('PyFunc'), MEDIA_TYPE);
    const stored = db.prepare('SELECT status FROM escrows WHERE id = ?').get(escrow.id) as {
      status: string;
    };
    const inspection = db
      .prepare('SELECT outcome FROM artifact_inspections WHERE escrow_id = ?')
      .get(escrow.id) as { outcome: string };

    expect(result.outcome).toBe('FAIL');
    expect(stored.status).toBe('FUNDED');
    expect(inspection.outcome).toBe('FAIL');
    expect(result.reasons.join(' ')).toContain('FORBIDDEN_OP:PyFunc');
    expectEvents(escrow.id, ['CREATED', 'FUNDED', 'INSPECTING', 'INSPECTION_NON_PASS']);
  });

  it('refunds a FUNDED escrow and records the transition', async () => {
    const escrow = await createFundedEscrow('refund-funded');
    const refunded = refundEscrow(db, escrow.id);

    expect(refunded.status).toBe('REFUNDED');
    expect(refunded.refunded_at).toEqual(expect.any(Number));
    expectEvents(escrow.id, ['CREATED', 'FUNDED', 'REFUNDED']);
  });

  it('throws the exported state error when refund is attempted after release', async () => {
    const escrow = await createFundedEscrow('refund-released');
    const inspection = inspectEscrow(db, escrow.id, VALID_PROTOBUF, MEDIA_TYPE);
    expect(inspection.outcome).toBe('PASS');

    expect(() => refundEscrow(db, escrow.id)).toThrow(EscrowStateError);
    expectEvents(escrow.id, ['CREATED', 'FUNDED', 'INSPECTING', 'RELEASED']);
  });
});

describe('artifact inspection', () => {
  it('passes a minimal well-formed protobuf with an accepted declared media type', () => {
    const result = inspectArtifact({ bytes: VALID_PROTOBUF, declaredMediaType: MEDIA_TYPE });

    expect(result.outcome).toBe('PASS');
    expect(result.reasons).toContain('INFO_IR_VERSION:1');
    expect(result.artifactBytes).toBe(VALID_PROTOBUF.length);
  });

  it('fails a buffer containing a forbidden PyFunc hint', () => {
    const result = inspectArtifact({ bytes: Buffer.from('PyFunc'), declaredMediaType: MEDIA_TYPE });

    expect(result.outcome).toBe('FAIL');
    expect(result.reasons.join(' ')).toContain('FORBIDDEN_OP:PyFunc');
  });

  it('returns INCONCLUSIVE for empty and truncated-varint buffers', () => {
    const empty = inspectArtifact({ bytes: Buffer.alloc(0), declaredMediaType: MEDIA_TYPE });
    const truncated = inspectArtifact({ bytes: Buffer.from([0x08, 0x80]), declaredMediaType: MEDIA_TYPE });

    expect(empty.outcome).toBe('INCONCLUSIVE');
    expect(empty.reasons).toContain('EMPTY_ARTIFACT');
    expect(truncated.outcome).toBe('INCONCLUSIVE');
    // inspector.ts reports the parser's concrete reason code for a truncated varint.
    expect(truncated.reasons).toContain('MALFORMED_PROTOBUF');
  });

  it('fails with HASH_MISMATCH when the expected SHA-256 is wrong', () => {
    const result = inspectArtifact({
      bytes: VALID_PROTOBUF,
      declaredMediaType: MEDIA_TYPE,
      expectedSha256: '0'.repeat(64),
    });

    expect(result.outcome).toBe('FAIL');
    expect(result.reasons).toContain('HASH_MISMATCH');
  });

  it('fails with OVERSIZE when maxBytes is below the artifact size', () => {
    const result = inspectArtifact({
      bytes: VALID_PROTOBUF,
      declaredMediaType: MEDIA_TYPE,
      maxBytes: VALID_PROTOBUF.length - 1,
    });

    expect(result.outcome).toBe('FAIL');
    expect(result.reasons).toContain('OVERSIZE');
  });
});
