/**
 * Money as integer micro-dollars (1 USD = 1_000_000 micro-dollars).
 *
 * All arithmetic is performed on safe integers only. Parsing uses BigInt so
 * that no IEEE-754 floating point ever touches a monetary value.
 *
 * A `Money` value is a `number` carrying a unique brand; the brand exists only
 * at compile time so the compiler can stop accidental mixing of money and
 * arbitrary numbers.
 */
export type Money = number & { readonly __microDollars: unique symbol };

export const MICRO_PER_DOLLAR = 1_000_000;
export const MAX_SAFE_INTEGER_MICRO = Number.MAX_SAFE_INTEGER;
export const ZERO: Money = 0 as Money;

const FRACTION_DIGITS = 6;
const DECIMAL_STRING = /^\d+(?:\.\d{1,6})?$/;

function assertSafeInteger(value: number, label: string): asserts value is Money {
  if (!Number.isSafeInteger(value)) {
    throw new RangeError(`${label} must be a safe integer, got ${value}`);
  }
}

function assertNonNegativeSafeInteger(value: number, label: string): void {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new RangeError(`${label} must be a non-negative safe integer, got ${value}`);
  }
}

/**
 * Parse a decimal dollar string ("0.0002", "25.00", "9007199254.740991")
 * into micro-dollars. No floats are involved.
 *
 * Rejects: empty strings, whitespace, negative numbers, scientific notation,
 * non-numeric input, values with more than 6 fractional digits, and values
 * whose micro-dollar representation exceeds Number.MAX_SAFE_INTEGER.
 */
export function fromDollars(input: string): Money {
  if (typeof input !== "string") {
    throw new TypeError("fromDollars expects a string, got " + typeof input);
  }
  if (!DECIMAL_STRING.test(input)) {
    throw new SyntaxError(`not a valid non-negative dollar amount: "${input}"`);
  }

  const dot = input.indexOf(".");
  const intPart = dot === -1 ? input : input.slice(0, dot);
  const fracPart = dot === -1 ? "" : input.slice(dot + 1);

  const intBig = BigInt(intPart);
  const fracBig = BigInt(fracPart.padEnd(FRACTION_DIGITS, "0"));
  const microBig = intBig * BigInt(MICRO_PER_DOLLAR) + fracBig;

  if (microBig > BigInt(MAX_SAFE_INTEGER_MICRO)) {
    throw new RangeError(`amount ${input} exceeds the maximum safe integer in micro-dollars`);
  }

  return Number(microBig) as Money;
}

/**
 * Construct a Money value from an already-safe non-negative integer number of
 * micro-dollars (e.g. a value read back from the database).
 */
export function fromMicro(micro: number): Money {
  assertNonNegativeSafeInteger(micro, "micro-dollars");
  return micro as Money;
}

/** Add two non-negative money values. Throws on overflow beyond MAX_SAFE_INTEGER. */
export function add(a: Money, b: Money): Money {
  const sum = a + b;
  assertSafeInteger(sum, "addition result");
  return sum as Money;
}

/** Subtract b from a. Throws if the result would be negative. */
export function sub(a: Money, b: Money): Money {
  if (b > a) {
    throw new RangeError(`cannot subtract ${b} from ${a}: result would be negative`);
  }
  return (a - b) as Money;
}

/**
 * Multiply a money value by a non-negative integer quantity (a count of units).
 * Throws on overflow beyond MAX_SAFE_INTEGER or a non-integer / negative quantity.
 */
export function mul(a: Money, quantity: number): Money {
  assertNonNegativeSafeInteger(quantity, "quantity");
  const product = a * quantity;
  assertSafeInteger(product, "multiplication result");
  return product as Money;
}

/** Compare two money values: -1 if a < b, 0 if equal, 1 if a > b. */
export function compare(a: Money, b: Money): -1 | 0 | 1 {
  if (a < b) return -1;
  if (a > b) return 1;
  return 0;
}

/**
 * Format micro-dollars as a canonical decimal string. Minimum two fractional
 * digits (cents), up to six (micro), with trailing fractional zeros trimmed.
 * Uses BigInt so the conversion is exact for all safe integer inputs.
 */
export function format(micro: Money): string {
  const big = BigInt(micro);
  const whole = (big / BigInt(MICRO_PER_DOLLAR)).toString();
  let frac = (big % BigInt(MICRO_PER_DOLLAR)).toString().padStart(FRACTION_DIGITS, "0");
  while (frac.length > 2 && frac.endsWith("0")) {
    frac = frac.slice(0, -1);
  }
  return `${whole}.${frac}`;
}