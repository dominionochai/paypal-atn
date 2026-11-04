import { randomUUID } from 'node:crypto';
import type { Database } from '../db/db.js';

interface AgentRow {
  id: number;
  revoked_at: number | null;
  budget_micro: number | null;
  ed25519_public_key: string;
}

interface DelegationRow {
  id: number;
  budget_ceiling: number;
  expires_at: string | null;
  revoked_at: number | null;
  scope_json: string | null;
  counterparty_allowlist_json: string | null;
  status: string;
}

interface ReservationRow {
  id: number;
  status: string;
  expires_at: number;
  reservation_ref: string | null;
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
  | 'RESERVATION_EXPIRED'
  | 'INTERNAL'
  | 'FORGED_SIGNATURE'
  | 'WRONG_KEY'
  | 'EXPIRED'
  | 'NOT_YET_VALID'
  | 'OVER_CEILING'
  | 'REPLAYED'
  | 'SKEWED_TIMESTAMP'
  | 'VAULT_MISSING'
  | 'VAULT_EXPIRED'
  | 'VAULT_REVOKED';

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

interface VaultRow {
  id: string;
  delegation_id: number;
  funded: number;
  reserved: number;
  committed: number;
  state: string;
  expires_at: string;
  opened_at: string;
  funding_ref_hash: string;
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
    `SELECT id, status, expires_at, reservation_ref
       FROM budget_reservations
      WHERE reservation_ref = ? OR id = ?
      LIMIT 1`,
  ).get(reservationId, Number(reservationId) || -1) as ReservationRow | undefined;
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
    const nowMilliseconds = nowSeconds > 1e11 ? nowSeconds : nowSeconds * 1000;

    return db.transaction((): AuthorityDecision => {
      const agent = db.prepare(
        `SELECT id, revoked_at, budget_micro, ed25519_public_key
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
        `SELECT id, budget_ceiling, expires_at, revoked_at,
                scope_json, counterparty_allowlist_json, status
           FROM delegations
          WHERE agent_id = ?
            AND status = 'ACTIVE'
          ORDER BY id
          LIMIT 1`,
      ).get(agent.id) as DelegationRow | undefined;

      if (delegation === undefined) {
        return denied('DELEGATION_MISSING', 'No active delegation exists for this agent.');
      }
      if (delegation.expires_at !== null) {
        const expiryMilliseconds = Date.parse(delegation.expires_at);
        if (Number.isFinite(expiryMilliseconds) && expiryMilliseconds <= nowMilliseconds) {
          return denied('DELEGATION_EXPIRED', 'The delegation has expired.');
        }
      }
      if (delegation.revoked_at !== null || delegation.status === 'REVOKED') {
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

      // Vault enforcement: check vault existence, state, and expiry
      const vault = db.prepare(
        `SELECT id, funded, reserved, committed, state, expires_at
           FROM vaults
          WHERE delegation_id = ?
          ORDER BY opened_at DESC
          LIMIT 1`
      ).get(delegation.id) as VaultRow & { expires_at: string } | undefined;

      if (!vault) {
        return denied('VAULT_MISSING', 'No vault exists for this delegation.');
      }
      if (vault.state === 'REVOKED') {
        return denied('VAULT_REVOKED', 'The vault has been revoked.');
      }
      const vaultExpMs = Date.parse(vault.expires_at);
      if (vault.state === 'EXPIRED' || (Number.isFinite(vaultExpMs) && vaultExpMs <= nowMilliseconds)) {
        return denied('VAULT_EXPIRED', 'The vault has expired.');
      }
      if (vault.state !== 'OPEN') {
        return denied('VAULT_MISSING', 'The vault is not open.');
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
      if (req.amount > delegationAvailable || req.amount > vault.funded - vault.committed - vault.reserved) {
        return denied('CEILING_EXCEEDED', 'The requested amount exceeds the remaining delegation ceiling or vault balance.');
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
    return denied('INTERNAL', 'Authorization could not be completed because the database operation failed.');
  }
}

export function reserve(
  db: Database,
  decision: Extract<AuthorityDecision, { allowed: true }>,
  amount: number,
  ttlSeconds: number,
  now?: number,
  reservationRef?: string,
): { reservationId: string; expiresAt: number } {
  if (!isSafeMicroAmount(amount) || amount === 0) {
    throw new RangeError('Reservation amount must be a positive safe integer in micro-dollars.');
  }
  if (!Number.isSafeInteger(ttlSeconds) || ttlSeconds <= 0) {
    throw new RangeError('Reservation TTL must be a positive safe integer in seconds.');
  }

  const baseTime = now !== undefined ? now : Date.now();
  const nowMs = baseTime > 1e11 ? baseTime : baseTime * 1000;
  const reservationId = reservationRef ?? randomUUID();
  const expiresAt = nowMs + ttlSeconds * 1000;
  if (!Number.isSafeInteger(expiresAt)) {
    throw new RangeError('Reservation expiry exceeds the safe integer range.');
  }

  return db.transaction(() => {
    const delegationIdNum = Number(decision.delegationId);
    const ceilingRow = db.prepare('SELECT budget_ceiling FROM delegations WHERE id = ?')
      .get(delegationIdNum) as { budget_ceiling: number } | undefined;
    if (ceilingRow === undefined) {
      throw new RangeError('The delegation for this reservation no longer exists.');
    }
    const committed = (db.prepare(
      "SELECT COALESCE((SELECT SUM(t.amount) FROM transactions AS t WHERE t.delegation_id = ? AND t.state = 'SETTLED'), 0) " +
      "+ COALESCE((SELECT SUM(r.amount) FROM budget_reservations AS r WHERE r.delegation_id = ? AND r.status = 'SETTLED' AND r.transaction_id IS NULL), 0) AS total",
    ).get(delegationIdNum, delegationIdNum) as SumRow | undefined)?.total ?? 0;
    const held = (db.prepare(
      "SELECT COALESCE(SUM(amount), 0) AS total FROM budget_reservations WHERE delegation_id = ? AND status = 'RESERVED' AND expires_at > ?",
    ).get(delegationIdNum, nowMs) as SumRow | undefined)?.total ?? 0;
    if (amount > ceilingRow.budget_ceiling - committed - held) {
      throw new RangeError('Reservation amount exceeds the remaining delegation ceiling.');
    }

    const vault = db.prepare('SELECT id, funded, reserved, committed, state FROM vaults WHERE delegation_id = ? AND state = \'OPEN\'')
      .get(delegationIdNum) as VaultRow | undefined;
    if (vault === undefined) {
      throw new RangeError('No open vault found for this delegation.');
    }
    if (vault.reserved + vault.committed + amount > vault.funded) {
      throw new RangeError('Reservation amount exceeds vault funded ceiling.');
    }
    db.prepare('UPDATE vaults SET reserved = reserved + ? WHERE id = ?').run(amount, vault.id);

    const insert = db.prepare(
      `INSERT INTO budget_reservations
         (delegation_id, transaction_id, amount, status, expires_at, reservation_ref)
       VALUES (?, NULL, ?, 'RESERVED', ?, ?)`,
    ).run(delegationIdNum, amount, expiresAt, reservationId);
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
  }).immediate();
}

export function commit(db: Database, reservationId: string, now?: number): void {
  const baseTime = now !== undefined ? now : Date.now();
  const nowMs = baseTime > 1e11 ? baseTime : baseTime * 1000;
  const expired = db.transaction((): boolean => {
    const reservation = findReservation(db, reservationId);
    if (reservation === undefined) {
      throw new Error('Reservation was not found.');
    }
    if (reservation.status !== 'RESERVED') return false;
    if (reservation.expires_at <= nowMs) {
      const result = db.prepare(
        `UPDATE budget_reservations SET status = 'EXPIRED'
          WHERE id = ? AND status = 'RESERVED'`,
      ).run(reservation.id);
      if (result.changes > 0) {
        addAuditEvent(db, reservation.id, 'reservation.expired', { reason: 'ttl_elapsed' }, null);
      }
      return true;
    }

    const resRow = db.prepare('SELECT delegation_id, amount FROM budget_reservations WHERE id = ?').get(reservation.id) as { delegation_id: number; amount: number } | undefined;
    if (resRow) {
      const vault = db.prepare('SELECT id FROM vaults WHERE delegation_id = ? AND state = \'OPEN\'').get(resRow.delegation_id) as { id: string } | undefined;
      if (vault) {
        db.prepare('UPDATE vaults SET reserved = reserved - ?, committed = committed + ? WHERE id = ?').run(resRow.amount, resRow.amount, vault.id);
      }
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

export function release(db: Database, reservationId: string, now?: number): void {
  const baseTime = now !== undefined ? now : Date.now();
  const nowMs = baseTime > 1e11 ? baseTime : baseTime * 1000;
  db.transaction(() => {
    const reservation = findReservation(db, reservationId);
    if (reservation === undefined || reservation.status !== 'RESERVED') return;
    if (reservation.expires_at <= nowMs) {
      const result = db.prepare(
        `UPDATE budget_reservations SET status = 'EXPIRED'
          WHERE id = ? AND status = 'RESERVED'`,
      ).run(reservation.id);
      if (result.changes > 0) {
        addAuditEvent(db, reservation.id, 'reservation.expired', { reason: 'ttl_elapsed' }, null);
      }
      return;
    }

    const resRow = db.prepare('SELECT delegation_id, amount FROM budget_reservations WHERE id = ?').get(reservation.id) as { delegation_id: number; amount: number } | undefined;
    if (resRow) {
      const vault = db.prepare('SELECT id FROM vaults WHERE delegation_id = ? AND state = \'OPEN\'').get(resRow.delegation_id) as { id: string } | undefined;
      if (vault) {
        db.prepare('UPDATE vaults SET reserved = reserved - ? WHERE id = ?').run(resRow.amount, vault.id);
      }
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
  now?: number,
  reservationRef?: string,
): { reservationId: string } {
  const reservation = reserve(db, decision, amount, ttlSeconds, now, reservationRef);
  try {
    commit(db, reservation.reservationId, now);
  } catch (error: unknown) {
    try {
      release(db, reservation.reservationId, now);
    } catch {
      // Preserve original commit failure.
    }
    throw error;
  }
  return { reservationId: reservation.reservationId };
}

export function createVault(
  db: Database,
  options: { delegationId: number | string; funded: number; fundingRef: string; ttlSeconds?: number; now?: number },
): { id: string; funded: number; expiresAt: string; state: string } {
  const delegationIdNum = Number(options.delegationId);
  const delegation = db.prepare('SELECT budget_ceiling, status, expires_at, revoked_at FROM delegations WHERE id = ?').get(delegationIdNum) as DelegationRow | undefined;
  if (!delegation) {
    throw new Error('DELEGATION_MISSING: Delegation not found for vault creation.');
  }
  if (delegation.status !== 'ACTIVE' || delegation.revoked_at !== null) {
    throw new Error('DELEGATION_REVOKED: Delegation is not active or has been revoked.');
  }
  if (delegation.expires_at !== null) {
    const expMs = Date.parse(delegation.expires_at);
    const baseTime = options.now !== undefined ? options.now : Date.now();
    const nowMs = baseTime > 1e11 ? baseTime : baseTime * 1000;
    if (Number.isFinite(expMs) && expMs <= nowMs) {
      throw new Error('DELEGATION_EXPIRED: Delegation has expired.');
    }
  }
  if (!isSafeMicroAmount(options.funded) || options.funded > delegation.budget_ceiling) {
    throw new Error('CEILING_EXCEEDED: Vault funded amount cannot exceed delegation budget ceiling.');
  }

  const vaultId = randomUUID();
  const baseTime = options.now !== undefined ? options.now : Date.now();
  const nowMs = baseTime > 1e11 ? baseTime : baseTime * 1000;
  const openedAtIso = new Date(nowMs).toISOString();
  const thirtyMinLaterMs = nowMs + 30 * 60 * 1000;

  let expiryMs = thirtyMinLaterMs;
  if (delegation.expires_at !== null) {
    const delegationExpMs = Date.parse(delegation.expires_at);
    if (Number.isFinite(delegationExpMs)) {
      expiryMs = Math.min(delegationExpMs, thirtyMinLaterMs);
    }
  }
  if (options.ttlSeconds !== undefined) {
    expiryMs = Math.min(expiryMs, nowMs + options.ttlSeconds * 1000);
  }
  const expiresAtIso = new Date(expiryMs).toISOString();
  // fundingRef supplied as 64-hex commitment (sha256(secret||nonce)), stored as-is
  const fundingRefHash = options.fundingRef;

  db.prepare(
    `INSERT INTO vaults (id, delegation_id, funded, state, expires_at, opened_at, funding_ref_hash)
     VALUES (?, ?, ?, 'OPEN', ?, ?, ?)`,
  ).run(vaultId, delegationIdNum, options.funded, expiresAtIso, openedAtIso, fundingRefHash);

  return { id: vaultId, funded: options.funded, expiresAt: expiresAtIso, state: 'OPEN' };
}

export function getVault(db: Database, vaultId: string): VaultRow | undefined {
  return db.prepare('SELECT * FROM vaults WHERE id = ?').get(vaultId) as VaultRow | undefined;
}

export function revokeDelegation(db: Database, delegationId: number | string, now?: number): void {
  const delegationIdNum = Number(delegationId);
  db.transaction(() => {
    db.prepare("UPDATE delegations SET status = 'REVOKED', revoked_at = ? WHERE id = ?").run(Math.floor((now ?? Date.now()) / 1000), delegationIdNum);
    const reservedList = db.prepare("SELECT id FROM budget_reservations WHERE delegation_id = ? AND status = 'RESERVED'").all(delegationIdNum) as Array<{ id: number }>;
    for (const res of reservedList) {
      release(db, String(res.id), now);
    }
    db.prepare("UPDATE vaults SET state = 'REVOKED' WHERE delegation_id = ? AND state = 'OPEN'").run(delegationIdNum);
  })();
}

export function revokeVault(db: Database, vaultId: string, now?: number): void {
  db.transaction(() => {
    const vault = getVault(db, vaultId);
    if (!vault) return;
    db.prepare("UPDATE vaults SET state = 'REVOKED' WHERE id = ?").run(vaultId);
    // Release vault's open reservations without revoking the delegation
    const reservedList = db.prepare("SELECT id FROM budget_reservations WHERE delegation_id = ? AND status = 'RESERVED'").all(vault.delegation_id) as Array<{ id: number }>;
    for (const res of reservedList) {
      release(db, String(res.id), now);
    }
  })();
}

export function sweepExpired(db: Database, now?: number): void {
  const baseTime = now !== undefined ? now : Date.now();
  const nowMs = baseTime > 1e11 ? baseTime : baseTime * 1000;
  const nowIso = new Date(nowMs).toISOString();

  db.transaction(() => {
    db.prepare("UPDATE vaults SET state = 'EXPIRED' WHERE state = 'OPEN' AND expires_at <= ?").run(nowIso);
    // Release vault open reservations for expired vaults
    const expiredVaults = db.prepare("SELECT delegation_id FROM vaults WHERE state = 'EXPIRED'").all() as Array<{ delegation_id: number }>;
    for (const v of expiredVaults) {
      const reservedList = db.prepare("SELECT id FROM budget_reservations WHERE delegation_id = ? AND status = 'RESERVED'").all(v.delegation_id) as Array<{ id: number }>;
      for (const res of reservedList) {
        release(db, String(res.id), nowMs);
      }
    }
    const stale = db.prepare("SELECT id FROM budget_reservations WHERE status = 'RESERVED' AND expires_at <= ?").all(nowMs) as Array<{ id: number }>;
    for (const res of stale) {
      release(db, String(res.id), nowMs);
    }
  })();
}
