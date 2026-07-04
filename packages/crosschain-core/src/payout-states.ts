/**
 * Merchant payout-chain (OUT hop) state machine. SEPARATE from CROSSCHAIN_STATES
 * (the IN hop) so adding OUT-hop transitions never perturbs the IN-hop SQL enum.
 * Mirrors states.ts's transition-table shape.
 *
 * Flow per payout row (Arc → the merchant's chosen chain via CCTP):
 *   pending        ──▶ claim() escrow into the relayer sweep address (Arc)
 *   claimed        ──▶ depositForBurn on Arc's TokenMessenger
 *   burn_submitted ──▶ poll IRIS for the attestation
 *   attesting      ──▶ (attestation ready) prepare receiveMessage
 *   receiving      ──▶ receiveMessage on the target chain (mints USDC)
 *   paid_out       ── terminal (merchant's external address funded)
 *
 * Any in-flight state may fail to `payout_failed` (operator path; the OUT hop
 * holds USDC custody only during [claim → burn], so a failure after the burn is
 * still recoverable by the merchant's pinned mintRecipient).
 */
export const PAYOUT_STATES = [
  "pending",
  "claimed",
  "burn_submitted",
  "attesting",
  "receiving",
  "paid_out",
  "payout_failed",
] as const;

export type PayoutState = typeof PAYOUT_STATES[number];

// The relayer's payout-claim SQL (run.ts, Phase 5) enumerates the processable
// (non-terminal, worker-driven) states — keep it in sync when adding
// transitions here.
const allowed: Record<PayoutState, readonly PayoutState[]> = {
  pending: ["claimed", "payout_failed"],
  claimed: ["burn_submitted", "payout_failed"],
  burn_submitted: ["attesting", "payout_failed"],
  attesting: ["receiving", "payout_failed"],
  receiving: ["paid_out", "payout_failed"],
  paid_out: [],
  payout_failed: [],
};

export function assertPayoutTransition(from: PayoutState, to: PayoutState): void {
  if (!allowed[from].includes(to)) {
    throw new Error(`invalid payout transition: ${from} -> ${to}`);
  }
}

export function isPayoutTerminal(state: PayoutState): boolean {
  return allowed[state].length === 0;
}

/** Non-terminal: the worker still has an action to take on this row. */
export function isPayoutProcessable(state: PayoutState): boolean {
  return !isPayoutTerminal(state);
}

/**
 * The single happy-path successor (the non-failure transition), or null for a
 * terminal state. Failure (`payout_failed`) is a branch, never the "next" step.
 */
export function nextPayoutState(state: PayoutState): PayoutState | null {
  const next = allowed[state].find((s) => s !== "payout_failed");
  return next ?? null;
}
