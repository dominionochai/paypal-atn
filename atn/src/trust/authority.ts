import { randomUUID } from "node:crypto";
import type { Database } from '../db/db.js';

interface AgentRow {
  id: number;
  revoked_at: number | null;
  budget_micro: number | null;
}

interface DelegationRow {
  id: number;
  budget_ceiling: number;
  expires_at: string | null;
  revoked_at: number | null;
  scope_json: string | null;
  counterparty_allowlist_json: string | null;
}

interface ReservationRow {
  id: number;
  status: string;
  expires_at: number;
}

export type DenyCode =
  | 'UNKNOWN_AGENT'
  | 'AGENT_REVOKED'
  | 'DELEGATION_MISSING'
  | 'DELEGATION_EXPIRED'
  | 'DELEGATION_REVOKED'
  | 'SCOPE_DENIED'
  | 'CEILING_EXCEEDED'
  | 'BUDGET_EXHAUSTED'
  | 'COUNTERPARTY_DENIED'
  | 'RESERVATION_EXPIRED';

export type AuthorityDecision =
  | { allowed: true; agentId: string; delegationId: string; remainingBudget: number }
  | { allowed: false; code: DenyCode; detail: string };

export interface AuthorityRequest {
  agentId: string;
  action: string;
  counterpartyId: string;
  amount: number;
  now?: number;
}

interface SumRow {
  total: number | null;
}

interface PragmaColumn {
  cid: number;
  name: string;
  type: string;
  notnull: number;
  dflt_value: unknown;
  pk: number;
}

function isPragmaColumn(value: unknown): value is PragmaColumn {
  if (typeof value !== 'object' || value === null) return false;
  return (
    'cid' in value && typeof value.cid === 'number' &&
    'name' in value && typeof value.name === 'string' &&
    'type' in value && typeof value.type === 'string' &&
    'notnull' in value && typeof value.notnull === 'number' &&
    'dflt_value' in value &&
    'pk' in value && typeof value.pk === 'number'
  );
}

function readTableInfo(db: Database, tableName: 'budget_reservations'): readonly PragmaColumn[] {
  const result: unknown = db.pragma(`table_info(${tableName})`);
  if (!Array.isArray(result)) return [];
  return result.filter(isPragmaColumn);
}

function hasReservationExpiryColumn(db: Database): boolean {
  return readTableInfo(db, 'budget_reservations').some((column) => column.name === 'expires_at');
}

function denied(code: DenyCode, detail: string): AuthorityDecision {
  return { allowed: false, code, detail };
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((entry: unknown) => typeof entry === 'string');
}

function jsonListIncludes(value: string | null, candidate: string): boolean {
  if (value === null) return true;
  try {
    const parsed: unknown = JSON.parse(value);
    return isStringArray(parsed) && parsed.includes(candidate);
  } catch {
    return false;
  }
}

function isSafeMicroAmount(value: number): boolean {
  return Number.isSafeInteger(value) && value >= 0;
}

function addAuditEvent(
  db: Database,
  entityId: number,
  event: string,
  payload: Readonly<Record<string, unknown>>,
  actor: string | null,
): void {
  db.prepare(
    `INSERT INTO audit_events (entity_type, entity_id, event, payload, actor)
     VALUES ('budget_reservation', ?, ?, ?, ?)`,
  ).run(entityId, event, JSON.stringify(payload), actor);
}

function findReservation(db: Database, reservationId: string): ReservationRow | undefined {
  return db.prepare(
    `SELECT r.id, r.status, r.expires_at
       FROM budget_reservations AS r
       JOIN audit_events AS e
         ON e.entity_type = 'budget_reservation'
        AND e.entity_id = r.id
        AND e.event = 'reservation.reserved'
      WHERE json_extract(e.payload, '$.reservationId') = ?
      ORDER BY e.id DESC
      LIMIT 1`,
  ).get(reservationId) as ReservationRow | undefined;
}

class AuthorityFailure extends Error {
  constructor(readonly code: DenyCode, message: string) {
    super(message);
    this.name = 'AuthorityFailure';
  }
}

export function authorize(db: Database, req: AuthorityRequest): AuthorityDecision {
  try {
    const nowSeconds = req.now ?? Math.floor(Date.now() / 1000);
    const nowMilliseconds = nowSeconds * 1000;

    return db.transaction((): AuthorityDecision => {
      const agent = db.prepare(
        `SELECT id, revoked_at, budget_micro
           FROM agents
          WHERE external_id = ?`,
      ).get(req.agentId) as AgentRow | undefined;

      if (agent === undefined) {
        return denied('UNKNOWN_AGENT', 'No agent exists for the supplied agentId.');
      }
      if (agent.revoked_at !== null) {
        return denied('AGENT_REVOKED', 'The agent has been revoked.');
      }

      const delegation = db.prepare(
        `SELECT d.id, d.budget_ceiling, d.expires_at, d.revoked_at,
                d.scope_json, d.counterparty_allowlist_json
           FROM delegations AS d
           JOIN principals AS p ON p.id = d.principal_id
          WHERE d.agent_id = ?
            AND p.external_id = ?
            AND d.status = 'ACTIVE'
          ORDER BY d.id
          LIMIT 1`,
      ).get(agent.id, req.counterpartyId) as DelegationRow | undefined;

      if (delegation === undefined) {
        return denied('DELEGATION_MISSING', 'No active delegation exists for this agent and counterparty.');
      }
      if (delegation.expires_at !== null) {
        const expiryMilliseconds = Date.parse(delegation.expires_at);
        if (Number.isFinite(expiryMilliseconds) && expiryMilliseconds <= nowMilliseconds) {
          return denied('DELEGATION_EXPIRED', 'The delegation has expired.');
        }
      }
      if (delegation.revoked_at !== null) {
        return denied('DELEGATION_REVOKED', 'The delegation has been revoked.');
      }
      if (!jsonListIncludes(delegation.counterparty_allowlist_json, req.counterpartyId)) {
        return denied('COUNTERPARTY_DENIED', 'The counterparty is not in the delegation allowlist.');
      }
      if (!jsonListIncludes(delegation.scope_json, req.action)) {
        return denied('SCOPE_DENIED', 'The requested action is outside the delegation scope.');
      }
      if (!isSafeMicroAmount(req.amount)) {
        return denied('CEILING_EXCEEDED', 'The requested amount is not a non-negative safe integer in micro-dollars.');
      }

      const staleReservations = db.prepare(
        `SELECT id
           FROM budget_reservations
          WHERE status = 'RESERVED'
            AND expires_at <= ?`,
      ).all(nowMilliseconds) as Array<{ id: number }>;
      const expireReservation = db.prepare(
        `UPDATE budget_reservations
            SET status = 'EXPIRED'
          WHERE id = ? AND status = 'RESERVED'`,
      );
      for (const reservation of staleReservations) {
        const result = expireReservation.run(reservation.id);
        if (result.changes > 0) {
          addAuditEvent(db, reservation.id, 'reservation.expired', { reason: 'ttl_elapsed' }, null);
        }
      }

      const delegationCommitted = (db.prepare(
        `SELECT
           COALESCE((
             SELECT SUM(t.amount)
               FROM transactions AS t
              WHERE t.delegation_id = ? AND t.state = 'SETTLED'
           ), 0) + COALESCE((
             SELECT SUM(r.amount)
               FROM budget_reservations AS r
              WHERE r.delegation_id = ?
                AND r.status = 'SETTLED'
                AND r.transaction_id IS NULL
           ), 0) AS total`,
      ).get(delegation.id, delegation.id) as SumRow | undefined)?.total ?? 0;

      const delegationReserved = (db.prepare(
        `SELECT COALESCE(SUM(amount), 0) AS total
           FROM budget_reservations
          WHERE delegation_id = ?
            AND status = 'RESERVED'
            AND expires_at > ?`,
      ).get(delegation.id, nowMilliseconds) as SumRow | undefined)?.total ?? 0;

      const delegationAvailable = delegation.budget_ceiling - delegationCommitted - delegationReserved;
      if (req.amount > delegationAvailable) {
        return denied('CEILING_EXCEEDED', 'The requested amount exceeds the remaining delegation ceiling.');
      }

      if (agent.budget_micro !== null) {
        const agentCommitted = (db.prepare(
          `SELECT
             COALESCE((
               SELECT SUM(t.amount)
                 FROM transactions AS t
                WHERE t.buyer_agent_id = ? AND t.state = 'SETTLED'
             ), 0) + COALESCE((
               SELECT SUM(r.amount)
                 FROM budget_reservations AS r
                 JOIN delegations AS d ON d.id = r.delegation_id
                WHERE d.agent_id = ?
                  AND r.status = 'SETTLED'
                  AND r.transaction_id IS NULL
             ), 0) AS total`,
        ).get(agent.id, agent.id) as SumRow | undefined)?.total ?? 0;
        const agentAvailable = agent.budget_micro - agentCommitted;
        if (req.amount > agentAvailable) {
          return denied('BUDGET_EXHAUSTED', 'The requested amount exceeds the agent budget remaining.');
        }
        return {
          allowed: true,
          agentId: req.agentId,
          delegationId: String(delegation.id),
          remainingBudget: Math.min(delegationAvailable - req.amount, agentAvailable - req.amount),
        };
      }

      return {
        allowed: true,
        agentId: req.agentId,
        delegationId: String(delegation.id),
        remainingBudget: delegationAvailable - req.amount,
      };
    })();
  } catch {
    return denied('UNKNOWN_AGENT', 'Authorization could not be completed because the database operation failed.');
  }
}

export function reserve(
  db: Database,
  decision: Extract<AuthorityDecision, { allowed: true }>,
  amount: number,
  ttlSeconds: number,
): { reservationId: string; expiresAt: number } {
  if (!isSafeMicroAmount(amount) || amount === 0) {
    throw new RangeError('Reservation amount must be a positive safe integer in micro-dollars.');
  }
  if (!Number.isSafeInteger(ttlSeconds) || ttlSeconds <= 0) {
    throw new RangeError('Reservation TTL must be a positive safe integer in seconds.');
  }
  if (amount > decision.remainingBudget) {
    throw new RangeError('Reservation amount exceeds the authorized remaining budget.');
  }
  if (!hasReservationExpiryColumn(db)) {
    throw new Error('The trust schema migration has not added budget_reservations.expires_at.');
  }

  const reservationId = randomUUID();
  const expiresAt = Date.now() + ttlSeconds * 1000;
  if (!Number.isSafeInteger(expiresAt)) {
    throw new RangeError('Reservation expiry exceeds the safe integer range.');
  }

  return db.transaction(() => {
    const insert = db.prepare(
      `INSERT INTO budget_reservations
         (delegation_id, transaction_id, amount, status, expires_at)
       VALUES (?, NULL, ?, 'RESERVED', ?)`,
    ).run(Number(decision.delegationId), amount, expiresAt);
    const insertedId = insert.lastInsertRowid;
    const entityId = typeof insertedId === 'bigint' ? Number(insertedId) : insertedId;
    if (!Number.isSafeInteger(entityId)) {
      throw new RangeError('Inserted reservation identifier exceeds the safe integer range.');
    }
    addAuditEvent(
      db,
      entityId,
      'reservation.reserved',
      { reservationId, amount, expiresAt, delegationId: decision.delegationId },
      decision.agentId,
    );
    return { reservationId, expiresAt };
  })();
}

export function commit(db: Database, reservationId: string): void {
  const expired = db.transaction((): boolean => {
    const reservation = findReservation(db, reservationId);
    if (reservation === undefined) {
      throw new Error('Reservation was not found.');
    }
    if (reservation.status !== 'RESERVED') return false;
    if (reservation.expires_at <= Date.now()) {
      const result = db.prepare(
        `UPDATE budget_reservations SET status = 'EXPIRED'
          WHERE id = ? AND status = 'RESERVED'`,
      ).run(reservation.id);
      if (result.changes > 0) {
        addAuditEvent(db, reservation.id, 'reservation.expired', { reason: 'ttl_elapsed' }, null);
      }
      return true;
    }

    const result = db.prepare(
      `UPDATE budget_reservations SET status = 'SETTLED'
        WHERE id = ? AND status = 'RESERVED'`,
    ).run(reservation.id);
    if (result.changes > 0) {
      addAuditEvent(db, reservation.id, 'reservation.committed', { reservationId }, null);
    }
    return false;
  })();

  if (expired) {
    throw new AuthorityFailure('RESERVATION_EXPIRED', 'The reservation expired before it could be committed.');
  }
}

export function release(db: Database, reservationId: string): void {
  db.transaction(() => {
    const reservation = findReservation(db, reservationId);
    if (reservation === undefined || reservation.status !== 'RESERVED') return;
    if (reservation.expires_at <= Date.now()) {
      const result = db.prepare(
        `UPDATE budget_reservations SET status = 'EXPIRED'
          WHERE id = ? AND status = 'RESERVED'`,
      ).run(reservation.id);
      if (result.changes > 0) {
        addAuditEvent(db, reservation.id, 'reservation.expired', { reason: 'ttl_elapsed' }, null);
      }
      return;
    }

    const result = db.prepare(
      `UPDATE budget_reservations
          SET status = 'RELEASED', released_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
        WHERE id = ? AND status = 'RESERVED'`,
    ).run(reservation.id);
    if (result.changes > 0) {
      addAuditEvent(db, reservation.id, 'reservation.released', { reservationId }, null);
    }
  })();
}

export function reserveAndCommit(
  db: Database,
  decision: Extract<AuthorityDecision, { allowed: true }>,
  amount: number,
  ttlSeconds: number,
): { reservationId: string } {
  const reservation = reserve(db, decision, amount, ttlSeconds);
  try {
    commit(db, reservation.reservationId);
  } catch (error: unknown) {
    try {
      release(db, reservation.reservationId);
    } catch {
      // Preserve the original commit failure after the compensating release attempt.
    }
    throw error;
  }
  return { reservationId: reservation.reservationId };
}
