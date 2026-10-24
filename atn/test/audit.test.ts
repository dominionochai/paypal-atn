import { beforeEach, describe, expect, it } from "vitest";
import { record, type AuditEvent } from "../src/audit/audit.js";
import { createDatabase, type Database } from "../src/db/db.js";

function baseEvent(overrides: Partial<AuditEvent> = {}): AuditEvent {
  return {
    entityType: "transaction",
    entityId: 42,
    event: "transaction.created",
    payload: { amount: 200, currency: "USD" },
    actor: "principal-1",
    ...overrides,
  };
}

describe("audit record", () => {
  let db: Database;
  beforeEach(() => {
    db = createDatabase(":memory:");
  });

  it("appends an event and returns its id", () => {
    const id = record(db, baseEvent());
    expect(typeof id).toBe("number");
    expect(id).toBeGreaterThan(0);
  });

  it("stores the payload as JSON", () => {
    record(db, baseEvent());
    const row = db.prepare("SELECT payload FROM audit_events LIMIT 1").get() as {
      payload: string;
    };
    expect(JSON.parse(row.payload)).toEqual({ amount: 200, currency: "USD" });
  });

  it("stores a null payload as {}", () => {
    const { payload: _omit, ...withoutPayload } = baseEvent();
    record(db, withoutPayload);
    const row = db.prepare("SELECT payload FROM audit_events LIMIT 1").get() as {
      payload: string;
    };
    expect(row.payload).toBe("{}");
  });

  it("requires a non-empty entityType and event", () => {
    expect(() => record(db, baseEvent({ entityType: "" }))).toThrow(TypeError);
    expect(() => record(db, baseEvent({ event: "" }))).toThrow(TypeError);
  });

  it("writes within the caller's transaction (rollback removes the row)", () => {
    expect(() =>
      db.transaction(() => {
        record(db, baseEvent());
        throw new Error("boom");
      })(),
    ).toThrow(/boom/);

    const count = db.prepare("SELECT COUNT(*) AS n FROM audit_events").get() as { n: number };
    expect(count.n).toBe(0);
  });

  it("commits alongside the caller's transaction", () => {
    db.transaction(() => {
      record(db, baseEvent({ event: "transaction.created" }));
      record(db, baseEvent({ event: "transaction.authorized" }));
    })();

    const count = db.prepare("SELECT COUNT(*) AS n FROM audit_events").get() as { n: number };
    expect(count.n).toBe(2);
  });
});

describe("audit append-only", () => {
  let db: Database;
  beforeEach(() => {
    db = createDatabase(":memory:");
    record(db, baseEvent());
  });

  it("forbids UPDATE via the schema trigger", () => {
    expect(() =>
      db.prepare("UPDATE audit_events SET event = 'tampered'").run(),
    ).toThrow(/append-only/);
  });

  it("forbids DELETE via the schema trigger", () => {
    expect(() => db.prepare("DELETE FROM audit_events").run()).toThrow(/append-only/);
  });

  it("still contains the original row", () => {
    const row = db.prepare("SELECT event FROM audit_events LIMIT 1").get() as { event: string };
    expect(row.event).toBe("transaction.created");
  });
});

describe("audit secret policy", () => {
  let db: Database;
  beforeEach(() => {
    db = createDatabase(":memory:");
  });

  it("refuses to log a payload carrying an api key", () => {
    expect(() =>
      record(db, baseEvent({ payload: { apiKey: "sk-123" } })),
    ).toThrow(/secret/i);
  });

  it("refuses to log nested secrets", () => {
    expect(() =>
      record(db, baseEvent({ payload: { details: { password: "hunter2" } } })),
    ).toThrow(/secret/i);
  });

  it("refuses keys regardless of casing or separators", () => {
    expect(() => record(db, baseEvent({ payload: { CLIENT_SECRET: "x" } }))).toThrow(/secret/i);
    expect(() => record(db, baseEvent({ payload: { accessToken: "x" } }))).toThrow(/secret/i);
    expect(() => record(db, baseEvent({ payload: { authorization: "Bearer x" } }))).toThrow(
      /secret/i,
    );
  });

  it("allows benign payload fields", () => {
    expect(() =>
      record(
        db,
        baseEvent({ payload: { amount: 200, currency: "USD", note: "scraped 500 pages" } }),
      ),
    ).not.toThrow();
  });

  it("never writes a rejected event to the log", () => {
    expect(() => record(db, baseEvent({ payload: { token: "abc" } }))).toThrow(/secret/i);
    const count = db.prepare("SELECT COUNT(*) AS n FROM audit_events").get() as { n: number };
    expect(count.n).toBe(0);
  });
});

function buildNesting(depth: number): Record<string, unknown> {
  let cursor: Record<string, unknown> = {};
  const root = cursor;
  for (let i = 0; i < depth; i += 1) {
    const next: Record<string, unknown> = {};
    cursor["a"] = next;
    cursor = next;
  }
  return root;
}

describe("audit secret filter", () => {
  let db: Database;
  beforeEach(() => {
    db = createDatabase(":memory:");
  });

  it("rejects keys that contain a banned fragment as a substring", () => {
    const keys = [
      "delegationToken",
      "authToken",
      "apiSecret",
      "stripeApiKey",
      "privateKeyPem",
      "passphrase",
      "signingKey",
      "x-api-key",
      "accessToken",
      "clientSecret",
      "refreshToken",
      "apiKey",
      "sessionId",
      "cardNumber",
      "bankAccount",
      "mnemonic",
      "seed",
      "passwd",
      "password",
      "credential",
      "authorization",
      "bearer",
      "cookie",
      "token",
    ];
    for (const key of keys) {
      expect(() => record(db, baseEvent({ payload: { [key]: "value" } })), key).toThrow(
        /secret/i,
      );
    }
  });

  it("rejects exact-match sensitive keys but not lookalike substrings", () => {
    for (const key of ["pin", "pan", "otp", "cvv", "cvc", "ssn"]) {
      expect(() => record(db, baseEvent({ payload: { [key]: "1234" } })), key).toThrow(
        /secret/i,
      );
    }
    expect(() =>
      record(db, baseEvent({ payload: { shipping: "addr", company: "acme" } })),
    ).not.toThrow();
  });

  it("allows the signature key even with a token-shaped value", () => {
    expect(() =>
      record(
        db,
        baseEvent({
          payload: { signature: "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjMifQ.sig" },
        }),
      ),
    ).not.toThrow();
  });

  it("rejects Bearer-token values regardless of key name", () => {
    expect(() => record(db, baseEvent({ payload: { header: "Bearer abcdef" } }))).toThrow(
      /secret|bearer/i,
    );
    expect(() => record(db, baseEvent({ payload: { header: "bearer abcdef" } }))).toThrow(
      /secret|bearer/i,
    );
  });

  it("rejects JWT-shaped values regardless of key name", () => {
    const jwt =
      "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjMifQ.sflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c";
    expect(() => record(db, baseEvent({ payload: { ref: jwt } }))).toThrow(/secret|jwt/i);
  });

  it("rejects PEM private-key headers regardless of key name", () => {
    expect(() =>
      record(db, baseEvent({ payload: { cert: "-----BEGIN RSA PRIVATE KEY-----\nMIIE" } })),
    ).toThrow(/secret|private key/i);
    expect(() =>
      record(db, baseEvent({ payload: { cert: "-----BEGIN PRIVATE KEY-----" } })),
    ).toThrow(/secret|private key/i);
  });

  it("accepts public PEM headers", () => {
    expect(() =>
      record(db, baseEvent({ payload: { cert: "-----BEGIN PUBLIC KEY-----\nMIIBIjANBgk" } })),
    ).not.toThrow();
  });

  it("throws TypeError on a circular payload instead of overflowing the stack", () => {
    interface Node {
      self?: unknown;
    }
    const node: Node = {};
    node.self = node;
    expect(() =>
      record(db, baseEvent({ payload: node as unknown as Record<string, unknown> })),
    ).toThrow(TypeError);
  });

  it("rejects payloads nested deeper than 8 levels and accepts exactly 8", () => {
    expect(() => record(db, baseEvent({ payload: buildNesting(9) }))).toThrow(/nesting/i);
    expect(() => record(db, baseEvent({ payload: buildNesting(8) }))).not.toThrow();
  });

  it("rejects serialized payloads larger than 16 KiB", () => {
    expect(() =>
      record(db, baseEvent({ payload: { data: "x".repeat(20_000) } })),
    ).toThrow(RangeError);
  });

  it("never writes a rejected oversized event to the log", () => {
    expect(() => record(db, baseEvent({ payload: { data: "x".repeat(20_000) } }))).toThrow();
    const count = db.prepare("SELECT COUNT(*) AS n FROM audit_events").get() as { n: number };
    expect(count.n).toBe(0);
  });
});