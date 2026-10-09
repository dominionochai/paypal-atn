import { describe, expect, it } from "vitest";
import {
  add,
  compare,
  format,
  fromDollars,
  fromMicro,
  mul,
  sub,
  type Money,
} from "../src/domain/money.js";

describe("fromDollars", () => {
  it("parses $0.0002 as 200 micro-dollars", () => {
    expect(fromDollars("0.0002")).toBe(200);
  });

  it("parses $0.10 as 100_000 micro-dollars", () => {
    expect(fromDollars("0.10")).toBe(100_000);
  });

  it("parses whole dollars", () => {
    expect(fromDollars("1")).toBe(1_000_000);
    expect(fromDollars("25.00")).toBe(25_000_000);
    expect(fromDollars("0")).toBe(0);
  });

  it("parses exactly at the safe-integer boundary", () => {
    expect(fromDollars("9007199254.740991")).toBe(Number.MAX_SAFE_INTEGER);
  });

  it("rejects overflow beyond Number.MAX_SAFE_INTEGER", () => {
    expect(() => fromDollars("9007199254.740992")).toThrow(RangeError);
    expect(() => fromDollars("99999999999999999999")).toThrow(RangeError);
  });

  it("rejects negative amounts", () => {
    expect(() => fromDollars("-1")).toThrow(SyntaxError);
    expect(() => fromDollars("-0")).toThrow(SyntaxError);
  });

  it("rejects non-numeric input", () => {
    for (const bad of ["", "abc", "NaN", "Infinity", "1e3", "1.2.3", "+1", ".5", "0.0000001"]) {
      expect(() => fromDollars(bad), `expected ${JSON.stringify(bad)} to be rejected`).toThrow();
    }
  });

  it("rejects whitespace", () => {
    expect(() => fromDollars(" 0.10")).toThrow(SyntaxError);
    expect(() => fromDollars("0.10 ")).toThrow(SyntaxError);
  });

  it("rejects more than six fractional digits", () => {
    expect(() => fromDollars("0.0000001")).toThrow(SyntaxError);
    expect(() => fromDollars("1.1234567")).toThrow(SyntaxError);
  });

  it("rejects non-string input", () => {
    expect(() => fromDollars(5 as unknown as string)).toThrow(TypeError);
  });
});

describe("fromMicro", () => {
  it("wraps a safe non-negative integer", () => {
    expect(fromMicro(200)).toBe(200);
  });

  it("rejects negatives, fractions, and unsafe integers", () => {
    expect(() => fromMicro(-1)).toThrow(RangeError);
    expect(() => fromMicro(1.5)).toThrow(RangeError);
    expect(() => fromMicro(Number.MAX_SAFE_INTEGER + 1)).toThrow(RangeError);
  });
});

describe("add", () => {
  it("adds micro-dollars exactly", () => {
    expect(add(fromDollars("0.0002"), fromDollars("0.0002"))).toBe(400);
  });

  it("rejects overflow", () => {
    const max = fromDollars("9007199254.740991");
    expect(() => add(max, fromDollars("0.000001"))).toThrow(RangeError);
  });
});

describe("sub", () => {
  it("subtracts micro-dollars exactly", () => {
    expect(sub(fromDollars("0.10"), fromDollars("0.0002"))).toBe(99_800);
  });

  it("rejects a negative result", () => {
    expect(() => sub(fromDollars("0.0002"), fromDollars("0.10"))).toThrow(RangeError);
  });

  it("allows an exact zero result", () => {
    expect(sub(fromDollars("0.10"), fromDollars("0.10"))).toBe(0);
  });
});

describe("mul", () => {
  it("computes 500 x $0.0002 == $0.10 exactly", () => {
    const unit = fromDollars("0.0002");
    const total = mul(unit, 500);
    expect(total).toBe(100_000);
    expect(format(total)).toBe("0.10");
  });

  it("multiplies by zero", () => {
    expect(mul(fromDollars("0.0002"), 0)).toBe(0);
  });

  it("rejects fractional quantities", () => {
    expect(() => mul(fromDollars("0.0002"), 0.5)).toThrow(RangeError);
  });

  it("rejects negative quantities", () => {
    expect(() => mul(fromDollars("0.0002"), -1)).toThrow(RangeError);
  });

  it("rejects overflow", () => {
    const max = fromDollars("9007199254.740991");
    expect(() => mul(max, 2)).toThrow(RangeError);
  });
});

describe("compare", () => {
  it("orders amounts", () => {
    const small: Money = fromDollars("0.0002");
    const big: Money = fromDollars("0.10");
    expect(compare(small, big)).toBe(-1);
    expect(compare(big, small)).toBe(1);
    expect(compare(small, fromDollars("0.0002"))).toBe(0);
  });
});

describe("format", () => {
  it("formats cents with two digits", () => {
    expect(format(fromDollars("0.10"))).toBe("0.10");
    expect(format(fromDollars("25.00"))).toBe("25.00");
  });

  it("formats sub-cent values fully", () => {
    expect(format(fromDollars("0.0002"))).toBe("0.0002");
    expect(format(fromDollars("0.0001"))).toBe("0.0001");
  });

  it("formats zero", () => {
    expect(format(fromDollars("0"))).toBe("0.00");
  });

  it("round-trips the safe-integer boundary", () => {
    const max = fromDollars("9007199254.740991");
    expect(format(max)).toBe("9007199254.740991");
    expect(fromDollars(format(max))).toBe(Number.MAX_SAFE_INTEGER);
  });
});