import { describe, expect, it } from "vitest";
import {
  BASE_TRANSACTION_MACHINE,
  BaseTransactionMachine,
  IllegalTransitionError,
  StateMachine,
  TRANSACTION_STATES,
  isTransactionState,
} from "../src/domain/state.js";

const machine = BASE_TRANSACTION_MACHINE;

describe("state set", () => {
  it("declares all sixteen states", () => {
    expect(TRANSACTION_STATES).toEqual([
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
    ]);
  });

  it("recognises valid states", () => {
    expect(isTransactionState("ACTIVE")).toBe(true);
    expect(isTransactionState("BOGUS")).toBe(false);
    expect(isTransactionState(42)).toBe(false);
  });
});

describe("legal transitions", () => {
  const legalPairs: ReadonlyArray<readonly [string, string]> = [
    ["CREATED", "AUTHORIZED"],
    ["CREATED", "REJECTED"],
    ["CREATED", "EXPIRED"],
    ["CREATED", "CANCELLED"],
    ["AUTHORIZED", "ACTIVE"],
    ["AUTHORIZED", "REJECTED"],
    ["AUTHORIZED", "EXPIRED"],
    ["AUTHORIZED", "CANCELLED"],
    ["ACTIVE", "COMPLETED"],
    ["ACTIVE", "VERIFICATION_PENDING"],
    ["ACTIVE", "DISPUTED"],
    ["ACTIVE", "EXPIRED"],
    ["ACTIVE", "CANCELLED"],
    ["COMPLETED", "VERIFICATION_PENDING"],
    ["COMPLETED", "SETTLEMENT_PENDING"],
    ["COMPLETED", "DISPUTED"],
    ["VERIFICATION_PENDING", "SETTLEMENT_PENDING"],
    ["VERIFICATION_PENDING", "VERIFICATION_FAILED"],
    ["VERIFICATION_PENDING", "DISPUTED"],
    ["VERIFICATION_PENDING", "EXPIRED"],
    ["VERIFICATION_PENDING", "CANCELLED"],
    ["VERIFICATION_FAILED", "REFUND_PENDING"],
    ["VERIFICATION_FAILED", "REJECTED"],
    ["VERIFICATION_FAILED", "DISPUTED"],
    ["SETTLEMENT_PENDING", "SETTLED"],
    ["SETTLEMENT_PENDING", "SETTLEMENT_FAILED"],
    ["SETTLEMENT_PENDING", "DISPUTED"],
    ["SETTLEMENT_FAILED", "REFUND_PENDING"],
    ["SETTLEMENT_FAILED", "REJECTED"],
    ["SETTLEMENT_FAILED", "DISPUTED"],
    ["SETTLEMENT_FAILED", "SETTLEMENT_PENDING"],
    ["DISPUTED", "REFUND_PENDING"],
    ["DISPUTED", "SETTLEMENT_PENDING"],
    ["DISPUTED", "VERIFICATION_PENDING"],
    ["DISPUTED", "CANCELLED"],
    ["DISPUTED", "REJECTED"],
    ["REFUND_PENDING", "REFUNDED"],
    ["REFUND_PENDING", "REFUND_FAILED"],
    ["REFUND_PENDING", "DISPUTED"],
    ["REFUND_FAILED", "REFUND_PENDING"],
    ["REFUND_FAILED", "DISPUTED"],
  ];

  it.each(legalPairs)("%s -> %s does not throw", (from, to) => {
    expect(() => machine.transition(from, to)).not.toThrow();
  });

  it("transition returns the destination state on success", () => {
    expect(machine.transition("CREATED", "AUTHORIZED")).toBe("AUTHORIZED");
    expect(machine.transition("REFUND_PENDING", "REFUND_FAILED")).toBe("REFUND_FAILED");
    expect(machine.transition("REFUND_FAILED", "REFUND_PENDING")).toBe("REFUND_PENDING");
  });

  it("REFUND_FAILED is a recoverable, non-terminal state", () => {
    expect(machine.can("REFUND_FAILED", "REFUND_PENDING")).toBe(true);
    expect(machine.can("REFUND_FAILED", "DISPUTED")).toBe(true);
    expect(machine.can("REFUND_FAILED", "SETTLED")).toBe(false);
    expect(machine.can("REFUND_FAILED", "REFUNDED")).toBe(false);
  });

  it("every declared legal destination is reachable", () => {
    const machineUnderTest = new BaseTransactionMachine();
    for (const from of TRANSACTION_STATES) {
      const destinations = new Set(machineUnderTest.legalDestinations(from));
      for (const to of destinations) {
        expect(machineUnderTest.can(from, to)).toBe(true);
      }
    }
  });
});

describe("illegal transitions", () => {
  it("rejects SETTLED -> ACTIVE", () => {
    expect(() => machine.transition("SETTLED", "ACTIVE")).toThrow(IllegalTransitionError);
  });

  it("rejects backwards moves from terminal states", () => {
    for (const terminal of ["SETTLED", "REFUNDED", "REJECTED", "EXPIRED", "CANCELLED"]) {
      for (const anyState of TRANSACTION_STATES) {
        if (terminal === anyState) {
          continue;
        }
        expect(
          () => machine.transition(terminal, anyState),
          `${terminal} -> ${anyState} should be illegal`,
        ).toThrow(IllegalTransitionError);
      }
    }
  });

  it("rejects skipping straight to settlement from CREATED", () => {
    expect(() => machine.transition("CREATED", "SETTLED")).toThrow(IllegalTransitionError);
  });

  it("rejects settling before verification", () => {
    expect(() => machine.transition("ACTIVE", "SETTLED")).toThrow(IllegalTransitionError);
  });

  it("rejects refund without a pending state", () => {
    expect(() => machine.transition("CREATED", "REFUND_PENDING")).toThrow(IllegalTransitionError);
  });

  it("rejects an unknown state", () => {
    expect(() => machine.transition("NOPE" as never, "ACTIVE")).toThrow(IllegalTransitionError);
    expect(() => machine.transition("ACTIVE", "NOPE" as never)).toThrow(IllegalTransitionError);
  });

  it("reports from/to in the error", () => {
    try {
      machine.transition("SETTLED", "ACTIVE");
      expect.unreachable("should have thrown");
    } catch (error) {
      expect(error).toBeInstanceOf(IllegalTransitionError);
      const e = error as IllegalTransitionError;
      expect(e.from).toBe("SETTLED");
      expect(e.to).toBe("ACTIVE");
      expect(e.message).toContain("SETTLED");
      expect(e.message).toContain("ACTIVE");
    }
  });
});

describe("extensibility", () => {
  it("can be extended with extra transitions on top of the base", () => {
    const base = new BaseTransactionMachine();
    const extended = base.withTransitions({ SETTLED: ["CANCELLED"] });

    expect(base.can("SETTLED", "CANCELLED")).toBe(false);
    expect(extended.can("SETTLED", "CANCELLED")).toBe(true);
    expect(extended.can("CREATED", "AUTHORIZED")).toBe(true);
  });

  it("supports fully custom state sets for streaming/escrow machines", () => {
    type DoorState = "OPEN" | "CLOSED";
    const door = new StateMachine<DoorState>({
      OPEN: new Set(["CLOSED"]),
      CLOSED: new Set(["OPEN"]),
    });

    expect(door.can("OPEN", "CLOSED")).toBe(true);
    expect(door.can("CLOSED", "OPEN")).toBe(true);
    expect(door.can("OPEN", "OPEN")).toBe(false);
    expect(() => door.assertLegal("OPEN", "OPEN")).toThrow(IllegalTransitionError);
  });
});