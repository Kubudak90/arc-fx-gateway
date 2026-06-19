// Route selection — the pure decision at the heart of the chain-agnostic router
// (PLAN §2, §5.2). Given where the buyer locked USDC (`escrowDomain`), where the
// merchant wants paid (`payoutDomain`), and in what token, pick one of the four
// settlement paths. This function holds NO addresses and does NO I/O — it is a
// total function of three values, which is why it is exhaustively table-tested.

/** Payout tokens a merchant may choose at onboarding. Buyer ALWAYS locks USDC. */
export type PayoutToken = "USDC" | "EURC" | "USDT";

/**
 * Settlement paths (PLAN §2). REFUND is not a "route" — it is always
 * USDC-on-escrowChain regardless of payout config — so it is intentionally not
 * one of these values.
 *
 *  A — same chain        : escrow USDC → (transfer | same-chain Li.Fi swap) → merchant. No CCTP.
 *  B — cross chain, USDC : single atomic CCTP hop with payout hook.
 *  C — cross chain, token: CCTP lands USDC, then a deferred `settle()` swaps with a fresh quote.
 */
export type SettlementPath = "A" | "B" | "C";

export interface RouteInput {
  /** CCTP domain of the chain the buyer paid on (where USDC is locked). */
  escrowDomain: number;
  /** CCTP domain of the chain the merchant chose for payout. */
  payoutDomain: number;
  /** Token the merchant chose for payout. */
  payoutToken: PayoutToken;
}

// CCTP domains are uint32 on-chain. Reject anything that could not be a real
// domain so a malformed routing key fails here rather than producing a wrong
// (but plausible) path downstream.
function assertDomain(value: number, name: string): void {
  if (!Number.isInteger(value) || value < 0 || value > 0xffffffff) {
    throw new RangeError(`${name} must be a uint32 CCTP domain, got ${value}`);
  }
}

/**
 * Pick the settlement path. The order of the checks is the whole logic:
 *  1. Same domain   → A   (no bridge; swap, if any, happens inside the escrow)
 *  2. payout USDC   → B   (cross chain, one atomic CCTP hop)
 *  3. otherwise     → C   (cross chain, CCTP then deferred token swap)
 */
export function selectRoute(input: RouteInput): SettlementPath {
  const { escrowDomain, payoutDomain, payoutToken } = input;
  assertDomain(escrowDomain, "escrowDomain");
  assertDomain(payoutDomain, "payoutDomain");
  if (payoutDomain === escrowDomain) return "A";
  if (payoutToken === "USDC") return "B";
  return "C";
}
