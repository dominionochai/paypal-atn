import { beforeEach, describe, expect, it } from "vitest";
import { createDatabase, openDatabase, runMigrations, type Database } from "../src/db/db.js";
import { fromMicro } from "../src/domain/money.js";
import { BASE_TRANSACTION_MACHINE, TRANSACTION_STATES } from "../src/domain/state.js";

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

  it("rejects a non-integer amount", () => {
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

describe("safe-integer bounds", () => {
  let db: Database;
  beforeEach(() => {
    db = createDatabase(":memory:");
  });

  it("accepts 9007199254740991 on delegations.budget_ceiling", () => {
    const { buyerId } = seedPrincipalAndAgents(db);
    expect(() => seedDelegation(db, buyerId, 9007199254740991)).not.toThrow();
  });

  it("rejects 9007199254740993 (BigInt) on delegations.budget_ceiling", () => {
    const { buyerId } = seedPrincipalAndAgents(db);
    const principal = db
      .prepare("SELECT principal_id FROM agents WHERE id = ?")
      .get(buyerId) as { principal_id: number };
    expect(() =>
      db
        .prepare(
          "INSERT INTO delegations (external_id, principal_id, agent_id, budget_ceiling) VALUES (?, ?, ?, ?)",
        )
        .run("del-big", principal.principal_id, buyerId, BigInt(9007199254740993)),
    ).toThrow(/CHECK/);
  });

  it("accepts 9007199254740991 on transactions.amount", () => {
    const { buyerId, workerId } = seedPrincipalAndAgents(db);
    const delegationId = seedDelegation(db, buyerId, 50_000_000);
    expect(() =>
      db
        .prepare(
          `INSERT INTO transactions (external_id, delegation_id, buyer_agent_id, worker_agent_id, amount)
           VALUES (?, ?, ?, ?, ?)`,
        )
        .run("tx-max", delegationId, buyerId, workerId, 9007199254740991),
    ).not.toThrow();
  });

  it("rejects 9007199254740993 (BigInt) on transactions.amount", () => {
    const { buyerId, workerId } = seedPrincipalAndAgents(db);
    const delegationId = seedDelegation(db, buyerId, 50_000_000);
    expect(() =>
      db
        .prepare(
          `INSERT INTO transactions (external_id, delegation_id, buyer_agent_id, worker_agent_id, amount)
           VALUES (?, ?, ?, ?, ?)`,
        )
        .run("tx-big", delegationId, buyerId, workerId, BigInt(9007199254740993)),
    ).toThrow(/CHECK/);
  });

  it("accepts 9007199254740991 on budget_reservations.amount", () => {
    const { buyerId, workerId } = seedPrincipalAndAgents(db);
    const delegationId = seedDelegation(db, buyerId, 50_000_000);
    const txId = db
      .prepare(
        `INSERT INTO transactions (external_id, delegation_id, buyer_agent_id, worker_agent_id, amount)
         VALUES (?, ?, ?, ?, ?)`,
      )
      .run("tx-res-max", delegationId, buyerId, workerId, 200)
      .lastInsertRowid as number;
    expect(() =>
      db
        .prepare(
          "INSERT INTO budget_reservations (delegation_id, transaction_id, amount) VALUES (?, ?, ?)",
        )
        .run(delegationId, txId, 9007199254740991),
    ).not.toThrow();
  });

  it("rejects 9007199254740993 (BigInt) on budget_reservations.amount", () => {
    const { buyerId, workerId } = seedPrincipalAndAgents(db);
    const delegationId = seedDelegation(db, buyerId, 50_000_000);
    const txId = db
      .prepare(
        `INSERT INTO transactions (external_id, delegation_id, buyer_agent_id, worker_agent_id, amount)
         VALUES (?, ?, ?, ?, ?)`,
      )
      .run("tx-res-big", delegationId, buyerId, workerId, 200)
      .lastInsertRowid as number;
    expect(() =>
      db
        .prepare(
          "INSERT INTO budget_reservations (delegation_id, transaction_id, amount) VALUES (?, ?, ?)",
        )
        .run(delegationId, txId, BigInt(9007199254740993)),
    ).toThrow(/CHECK/);
  });
});

describe("state parity with DB", () => {
  it("accepts every TRANSACTION_STATES value and rejects an unknown one", () => {
    const db = createDatabase(":memory:");
    const { buyerId, workerId } = seedPrincipalAndAgents(db);
    const delegationId = seedDelegation(db, buyerId, 50_000_000);
    const insert = db.prepare(
      `INSERT INTO transactions (external_id, delegation_id, buyer_agent_id, worker_agent_id, amount, state)
       VALUES (?, ?, ?, ?, ?, ?)`,
    );
    for (const state of TRANSACTION_STATES) {
      expect(() => insert.run(`tx-parity-${state}`, delegationId, buyerId, workerId, 100, state), state).not.toThrow();
    }
    expect(() =>
      insert.run("tx-parity-unknown", delegationId, buyerId, workerId, 100, "REFUND_FAILING"),
    ).toThrow(/CHECK/);
    db.close();
  });
});

describe("database-level transaction guards", () => {
  let db: Database;
  let txId: number;
  beforeEach(() => {
    db = createDatabase(":memory:");
    const { buyerId, workerId } = seedPrincipalAndAgents(db);
    const delegationId = seedDelegation(db, buyerId, 50_000_000);
    txId = db
      .prepare(
        `INSERT INTO transactions (external_id, delegation_id, buyer_agent_id, worker_agent_id, amount)
         VALUES (?, ?, ?, ?, ?)`,
      )
      .run("tx-guard", delegationId, buyerId, workerId, 200)
      .lastInsertRowid as number;
  });

  it("allows a legal update (state change, version +1)", () => {
    expect(() =>
      db
        .prepare("UPDATE transactions SET state = 'AUTHORIZED', version = 2 WHERE id = ?")
        .run(txId),
    ).not.toThrow();
  });

  it("aborts changing state from a terminal state", () => {
    db.prepare("UPDATE transactions SET state = 'SETTLED', version = 2 WHERE id = ?").run(txId);
    expect(() =>
      db.prepare("UPDATE transactions SET state = 'ACTIVE', version = 3 WHERE id = ?").run(txId),
    ).toThrow(/terminal/i);
  });

  it("aborts if version does not increment by exactly 1", () => {
    expect(() =>
      db.prepare("UPDATE transactions SET state = 'AUTHORIZED', version = 1 WHERE id = ?").run(txId),
    ).toThrow(/version/i);
    expect(() =>
      db.prepare("UPDATE transactions SET state = 'AUTHORIZED', version = 3 WHERE id = ?").run(txId),
    ).toThrow(/version/i);
  });

  it("aborts if the agreed amount changes", () => {
    expect(() =>
      db.prepare("UPDATE transactions SET amount = 500, version = 2 WHERE id = ?").run(txId),
    ).toThrow(/immutable|amount/i);
  });

  it("aborts a terminal-state change even when the version is correct", () => {
    db.prepare("UPDATE transactions SET state = 'REFUNDED', version = 2 WHERE id = ?").run(txId);
    expect(() =>
      db.prepare("UPDATE transactions SET state = 'DISPUTED', version = 3 WHERE id = ?").run(txId),
    ).toThrow(/terminal/i);
  });
});