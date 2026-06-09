import { describe, expect, it } from "vitest";
import { formatBaseUnits, parseBaseUnits } from "../src/amounts";

describe("amount helpers", () => {
  it("parses 6-decimal USDC strings into base units", () => {
    expect(parseBaseUnits("1", 6)).toBe(1_000_000n);
    expect(parseBaseUnits("1.23", 6)).toBe(1_230_000n);
    expect(parseBaseUnits("0.000001", 6)).toBe(1n);
  });

  it("rejects over-precision instead of truncating money", () => {
    expect(() => parseBaseUnits("1.0000001", 6)).toThrow(/too many decimal places/);
  });

  it("formats base units without losing precision", () => {
    expect(formatBaseUnits(1_230_000n, 6)).toBe("1.23");
    expect(formatBaseUnits(1n, 6)).toBe("0.000001");
    expect(formatBaseUnits(1_000_000n, 6)).toBe("1");
  });
});
