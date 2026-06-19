import { describe, it, expect } from "vitest";
import { selectRoute, type PayoutToken, type SettlementPath } from "../src/selectRoute";

// Domains used in the table (real CCTP domains: Ethereum 0, Arbitrum 3, Base 6).
const ETH = 0;
const ARB = 3;
const BASE = 6;

describe("selectRoute", () => {
  const cases: Array<{
    escrowDomain: number;
    payoutDomain: number;
    payoutToken: PayoutToken;
    expected: SettlementPath;
    why: string;
  }> = [
    // PATH A — same chain, any token (swap, if needed, happens inside the escrow)
    { escrowDomain: BASE, payoutDomain: BASE, payoutToken: "USDC", expected: "A", why: "same chain, USDC" },
    { escrowDomain: BASE, payoutDomain: BASE, payoutToken: "EURC", expected: "A", why: "same chain, EURC (in-escrow swap)" },
    { escrowDomain: BASE, payoutDomain: BASE, payoutToken: "USDT", expected: "A", why: "same chain, USDT (in-escrow swap)" },
    { escrowDomain: ETH, payoutDomain: ETH, payoutToken: "USDT", expected: "A", why: "same chain on a different domain" },

    // PATH B — cross chain, payout USDC (single atomic CCTP hop)
    { escrowDomain: BASE, payoutDomain: ARB, payoutToken: "USDC", expected: "B", why: "cross chain, USDC" },
    { escrowDomain: ETH, payoutDomain: BASE, payoutToken: "USDC", expected: "B", why: "cross chain, USDC, other direction" },

    // PATH C — cross chain, payout EURC/USDT (CCTP + deferred settle)
    { escrowDomain: BASE, payoutDomain: ARB, payoutToken: "EURC", expected: "C", why: "cross chain, EURC" },
    { escrowDomain: BASE, payoutDomain: ARB, payoutToken: "USDT", expected: "C", why: "cross chain, USDT" },
    { escrowDomain: ETH, payoutDomain: ARB, payoutToken: "EURC", expected: "C", why: "cross chain, EURC, other domains" },
  ];

  it.each(cases)("$why → $expected", ({ escrowDomain, payoutDomain, payoutToken, expected }) => {
    expect(selectRoute({ escrowDomain, payoutDomain, payoutToken })).toBe(expected);
  });

  it("same domain wins even when token is non-USDC (A, not C)", () => {
    expect(selectRoute({ escrowDomain: 7, payoutDomain: 7, payoutToken: "EURC" })).toBe("A");
  });

  it.each([
    [-1, 0],
    [0, 1.5],
    [0, 2 ** 32],
    [NaN, 0],
  ])("rejects non-uint32 domains (%s, %s)", (escrowDomain, payoutDomain) => {
    expect(() => selectRoute({ escrowDomain, payoutDomain, payoutToken: "USDC" })).toThrow();
  });
});
