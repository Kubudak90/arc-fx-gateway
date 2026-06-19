import { describe, it, expect } from "vitest";
import { parseUnits, formatUnits, parseAmount, money, STABLE_DECIMALS } from "../src/money";

describe("parseUnits", () => {
  it.each([
    ["0", 0n],
    ["1", 1_000_000n],
    ["1.5", 1_500_000n],
    ["1.23", 1_230_000n],
    ["0.000001", 1n],
    ["0.1", 100_000n],
    ["123456789.654321", 123_456_789_654_321n],
    ["007", 7_000_000n], // leading zeros are fine
    ["1.000000", 1_000_000n], // full-precision zeros
  ])("parses %s → %s", (input, expected) => {
    expect(parseUnits(input)).toBe(expected);
  });

  it.each([
    "1.5 ", // trimmed
    " 1.5",
  ])("trims surrounding whitespace: %j", (input) => {
    expect(parseUnits(input)).toBe(1_500_000n);
  });

  it.each([
    "",
    ".5", // bare fraction
    "1.", // trailing dot
    "-1", // sign
    "+1",
    "1e6", // exponent
    "1,000", // separator
    "0x10",
    "abc",
    "1.2.3",
    "Infinity",
    "NaN",
    "1.1234567", // 7 fractional digits > 6
  ])("rejects malformed amount %j", (bad) => {
    expect(() => parseUnits(bad)).toThrow();
  });

  it("honours a custom decimals", () => {
    expect(parseUnits("1.5", 2)).toBe(150n);
    expect(() => parseUnits("1.555", 2)).toThrow(/fractional digits/);
  });
});

describe("formatUnits", () => {
  it.each([
    [0n, "0"],
    [1_000_000n, "1"],
    [1_500_000n, "1.5"],
    [1_230_000n, "1.23"],
    [1n, "0.000001"],
    [100_000n, "0.1"],
    [123_456_789_654_321n, "123456789.654321"],
  ])("formats %s → %s", (input, expected) => {
    expect(formatUnits(input)).toBe(expected);
  });

  it("preserves a negative sign", () => {
    expect(formatUnits(-1_500_000n)).toBe("-1.5");
  });
});

describe("round-trip", () => {
  const samples = [0n, 1n, 999_999n, 1_000_000n, 1_500_000n, 7n, 123_456_789_654_321n];
  it.each(samples)("formatUnits∘parseUnits is identity for %s", (minor) => {
    expect(parseUnits(formatUnits(minor))).toBe(minor);
  });

  it.each(["0", "1", "1.5", "0.000001", "42.000042", "1000000.999999"])(
    "parseUnits∘formatUnits normalizes %s back to itself",
    (decimal) => {
      expect(formatUnits(parseUnits(decimal))).toBe(decimal);
    },
  );
});

describe("parseAmount", () => {
  it("accepts a positive amount", () => {
    expect(parseAmount("3")).toBe(3_000_000n);
  });
  it.each(["0", "0.0", "0.000000"])("rejects non-positive %j", (zero) => {
    expect(() => parseAmount(zero)).toThrow(/> 0/);
  });
});

describe("money()", () => {
  it("brands a bigint", () => {
    expect(money(5n)).toBe(5n);
  });
  it("rejects a non-bigint", () => {
    // @ts-expect-error — guarding the runtime path
    expect(() => money(5)).toThrow();
  });
});

it("STABLE_DECIMALS is 6", () => {
  expect(STABLE_DECIMALS).toBe(6);
});
