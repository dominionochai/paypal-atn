import { beforeEach, describe, expect, it } from "vitest";
import { createDatabase, openDatabase, runMigrations, type Database } from "../src/db/db.js";
import { fromMicro } from "../src/domain/money.js";
import { BASE_TRANSACTION_MACHINE } from "../src/domain/state.js";

function seedPrincipalAndAgents(db: Database): { buyerId: number; workerId: number } {
  const principalId = db
    .prepare("INSERT INTO principals (external_id, name) VALUES (?, ?)")
    .run("principal-1", "Ada")
    .lastInsertRowid as number;

  const buyerId = db
    .prepare("INSERT INTO agents (external_id, principal_id, name) VALUES (?, ?, ?)")
    .run("agent-buyer-1", principalId, "Market Research Agent")
    .lastInsertRowid as number;

  const workerId = db
    .prepare("INSERT INTO agents (external_id, principal_id, name) VALUES (?, ?, ?)")
    .run("agent-worker-1", principalId, "Scraper Agent")
    .lastInsertRowid as number;

  return { buyerId, workerId };
}

function seedDelegation(db: Database, agentId: number, ceiling: number): number {
  const principalId = db
    .prepare("SELECT principal_id FROM agents WHERE id = ?")
    .get(agentId) as { principal_id: number };
  return db
    .prepare(
      "INSERT INTO delegations (external_id, principal_id, agent_id, budget_ceiling) VALUES (?, ?, ?, ?)",
    )
    .run(`delegation-${agentId}-${ceiling}`, principalId.principal_id, agentId, ceiling)
    .lastInsertRowid as number;
}

describe("migration runner", () => {
  it("applies migrations and is idempotent", () => {
    const db = createDatabase(":memory:");
    expect(() => runMigrations(db)).not.toThrow();

    const rows = db.prepare("SELECT filename FROM _migrations ORDER BY filename").all();
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.map((r) => (r as { filename: string }).filename)).toContain("001_initial.sql");

    expect(() => runMigrations(db)).not.toThrow();
    const rowsAfter = db.prepare("SELECT COUNT(*) AS n FROM _migrations").get() as {
      n: number;
    };
    expect(rowsAfter.n).toBe(rows.length);
    db.close();
  });
});

describe("schema constraints", () => {
  let db: Database;
  beforeEach(() => {
    db = createDatabase(":memory:");
  });

  it("rejects a negative transaction amount", () => {
    const { buyerId, workerId } = seedPrincipalAndAgents(db);
    const delegationId = seedDelegation(db, buyerId, 50_000_000);
    expect(() =>
      db
        .prepare(
          `INSERT INTO transactions (external_id, delegation_id, buyer_agent_id, worker_agent_id, amount)
           VALUES (?, ?, ?, ?, ?)`,
        )
        .run("tx-neg", delegationId, buyerId, workerId, -1),
    ).toThrow(/CHECK/);
  });

  it("rejects a negative delegation budget ceiling", () => {
    const { buyerId } = seedPrincipalAndAgents(db);
    expect(() => seedDelegation(db, buyerId, -5)).toThrow(/CHECK/);
  });

  it("rejects a negative budget reservation amount", () => {
    const { buyerId, workerId } = seedPrincipalAndAgents(db);
    const delegationId = seedDelegation(db, buyerId, 50_000_000);
    const txId = db
      .prepare(
        `INSERT INTO transactions (external_id, delegation_id, buyer_agent_id, worker_agent_id, amount)
         VALUES (?, ?, ?, ?, ?)`,
      )
      .run("tx-ok", delegationId, buyerId, workerId, 200)
      .lastInsertRowid as number;

    expect(() =>
      db
        .prepare(
          "INSERT INTO budget_reservations (delegation_id, transaction_id, amount) VALUES (?, ?, ?)",
        )
        .run(delegationId, txId, -1),
    ).toThrow(/CHECK/);
  });

  it("rejects an unknown transaction state", () => {
    const { buyerId, workerId } = seedPrincipalAndAgents(db);
    const delegationId = seedDelegation(db, buyerId, 50_000_000);
    expect(() =>
      db
        .prepare(
          `INSERT INTO transactions (external_id, delegation_id, buyer_agent_id, worker_agent_id, amount, state)
           VALUES (?, ?, ?, ?, ?, ?)`,
        )
        .run("tx-bad-state", delegationId, buyerId, workerId, 100, "NOT_A_STATE"),
    ).toThrow(/CHECK/);
  });

  it("enforces unique external_id on principals, agents, and transactions", () => {
    const { buyerId } = seedPrincipalAndAgents(db);

    expect(() =>
      db.prepare("INSERT INTO principals (external_id, name) VALUES (?, ?)").run("principal-1", "Dup"),
    ).toThrow(/UNIQUE/);

    expect(() =>
      db
        .prepare("INSERT INTO agents (external_id, principal_id, name) VALUES (?, ?, ?)")
        .run("agent-buyer-1", buyerId, "Dup"),
    ).toThrow(/UNIQUE/);
  });

  it("enforces one budget reservation per transaction", () => {
    const { buyerId, workerId } = seedPrincipalAndAgents(db);
    const delegationId = seedDelegation(db, buyerId, 50_000_000);
    const txId = db
      .prepare(
        `INSERT INTO transactions (external_id, delegation_id, buyer_agent_id, worker_agent_id, amount)
         VALUES (?, ?, ?, ?, ?)`,
      )
      .run("tx-res", delegationId, buyerId, workerId, 200)
      .lastInsertRowid as number;

    db.prepare(
      "INSERT INTO budget_reservations (delegation_id, transaction_id, amount) VALUES (?, ?, ?)",
    ).run(delegationId, txId, 200);

    expect(() =>
      db
        .prepare(
          "INSERT INTO budget_reservations (delegation_id, transaction_id, amount) VALUES (?, ?, ?)",
        )
        .run(delegationId, txId, 200),
    ).toThrow(/UNIQUE/);
  });
});

describe("transactions table", () => {
  let db: Database;
  beforeEach(() => {
    db = createDatabase(":memory:");
  });

  it("stores money as INTEGER micro-dollars", () => {
    const { buyerId, workerId } = seedPrincipalAndAgents(db);
    const delegationId = seedDelegation(db, buyerId, 50_000_000);
    db.prepare(
      `INSERT INTO transactions (external_id, delegation_id, buyer_agent_id, worker_agent_id, amount)
       VALUES (?, ?, ?, ?, ?)`,
    ).run("tx-amount", delegationId, buyerId, workerId, fromMicro(200));

    const row = db
      .prepare("SELECT amount FROM transactions WHERE external_id = ?")
      .get("tx-amount") as { amount: number };
    expect(typeof row.amount).toBe("number");
    expect(row.amount).toBe(200);
  });

  it("defaults version to 1 for optimistic concurrency", () => {
    const { buyerId, workerId } = seedPrincipalAndAgents(db);
    const delegationId = seedDelegation(db, buyerId, 50_000_000);
    db.prepare(
      `INSERT INTO transactions (external_id, delegation_id, buyer_agent_id, worker_agent_id, amount)
       VALUES (?, ?, ?, ?, ?)`,
    ).run("tx-version", delegationId, buyerId, workerId, 200);

    const row = db
      .prepare("SELECT version FROM transactions WHERE external_id = ?")
      .get("tx-version") as { version: number };
    expect(row.version).toBe(1);
  });

  it("defaults state to CREATED, matching the state machine", () => {
    const { buyerId, workerId } = seedPrincipalAndAgents(db);
    const delegationId = seedDelegation(db, buyerId, 50_000_000);
    db.prepare(
      `INSERT INTO transactions (external_id, delegation_id, buyer_agent_id, worker_agent_id, amount)
       VALUES (?, ?, ?, ?, ?)`,
    ).run("tx-state", delegationId, buyerId, workerId, 200);

    const row = db
      .prepare("SELECT state FROM transactions WHERE external_id = ?")
      .get("tx-state") as { state: string };
    expect(row.state).toBe("CREATED");
    expect(BASE_TRANSACTION_MACHINE.can("CREATED", "AUTHORIZED")).toBe(true);
  });

  it("rejects an amount that is not a safe integer", () => {
    const { buyerId, workerId } = seedPrincipalAndAgents(db);
    const delegationId = seedDelegation(db, buyerId, 50_000_000);
    expect(() =>
      db
        .prepare(
          `INSERT INTO transactions (external_id, delegation_id, buyer_agent_id, worker_agent_id, amount)
           VALUES (?, ?, ?, ?, ?)`,
        )
        .run("tx-float", delegationId, buyerId, workerId, 0.5),
    ).toThrow(/INTEGER/);
  });
});

describe("foreign keys", () => {
  it("rejects an agent without a principal", () => {
    const db = createDatabase(":memory:");
    expect(() =>
      db
        .prepare("INSERT INTO agents (external_id, principal_id, name) VALUES (?, ?, ?)")
        .run("agent-orphan", 9999, "Orphan"),
    ).toThrow(/FOREIGN KEY/);
    db.close();
  });
});

describe("openDatabase", () => {
  it("opens a raw connection without migrations", () => {
    const db = openDatabase(":memory:");
    expect(() => db.prepare("SELECT * FROM principals").all()).toThrow(/no such table/);
    db.close();
  });
});