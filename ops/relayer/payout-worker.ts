/**
 * Merchant payout-chain (OUT-hop) worker — the mirror of crosschain-worker.ts,
 * but as the PURE "given a payout row + injected chain/IRIS state, what's the
 * next action" decision fn the plan calls for. No live I/O happens here: the
 * relayer loop (run.ts, Phase 5) maps each returned PayoutAction to the real
 * claim() / depositForBurn-on-Arc / IRIS poll / receiveMessage calls, and
 * persists the resulting checkpoints back onto the row.
 *
 * Flow per claimed payout row (Arc → the merchant's chosen chain via CCTP):
 *   pending        → claim   (sweep escrow on Arc into the relayer sweep addr)
 *   claimed        → burn    (depositForBurn the swept USDC on Arc)
 *   burn_submitted → await_attestation (IRIS not ready) | receive (ready)
 *   attesting      → receive (attestation ready) | await_attestation
 *   receiving      → receive (resume the mid-flight receiveMessage)
 *   paid_out       → done
 *   payout_failed  → fail
 *
 * Discipline mirrored from crosschain-worker.ts:
 *   • persist-before-wait — the loop persists burn_tx_hash before polling IRIS,
 *     so a crash inside the wait re-enters at burn_submitted/attesting and the
 *     decision fn resumes (CCTP replay protection guards a re-broadcast anyway).
 *   • resume via persisted attestation — once cctp_message/cctp_attestation are
 *     stored, `receive` is decided without a fresh IRIS poll.
 *   • wall-clock attestation deadline — a burn that has gone this long without
 *     an attestation goes terminal (`fail`) instead of polling forever; anchored
 *     on burn_submitted_at with a created_at/updated_at fallback (audit MED-3).
 *   • attestation waits never burn the on-chain retry budget — only the
 *     claim/burn/receive steps do.
 */
import type { CrosschainPayoutRow, PayoutAction, PayoutDecisionInputs } from "./payout-types";

/** Default wall-clock bound on attestation polling: 2 hours (mirror IN hop). */
const DEFAULT_ATTESTATION_DEADLINE_MS = 7_200_000;
/** Default retry budget for the claim/burn/receive on-chain steps. */
const DEFAULT_MAX_ATTEMPTS = 5;

function attestationAvailable(row: CrosschainPayoutRow, inputs: PayoutDecisionInputs): boolean {
  // Resume: a prior attempt already persisted the attestation.
  if (row.cctp_message && row.cctp_attestation) return true;
  // Fresh IRIS poll injected by the loop this pass.
  return Boolean(inputs.irisResult);
}

function attestationDeadlineExceeded(row: CrosschainPayoutRow, inputs: PayoutDecisionInputs): boolean {
  const deadlineMs = inputs.attestationDeadlineMs ?? DEFAULT_ATTESTATION_DEADLINE_MS;
  const anchor = row.burn_submitted_at ?? row.created_at ?? row.updated_at;
  if (anchor == null) return false;
  const anchorMs = new Date(anchor).getTime();
  return inputs.now - anchorMs > deadlineMs;
}

export function decidePayoutAction(
  row: CrosschainPayoutRow,
  inputs: PayoutDecisionInputs,
): PayoutAction {
  const maxAttempts = inputs.maxAttempts ?? DEFAULT_MAX_ATTEMPTS;

  switch (row.status) {
    case "paid_out":
      return "done";
    case "payout_failed":
      return "fail";

    case "pending":
      // First on-chain step (claim). Retry-budget guarded.
      if (row.attempts >= maxAttempts) return "fail";
      return "claim";

    case "claimed":
      // Next on-chain step (burn). Retry-budget guarded.
      if (row.attempts >= maxAttempts) return "fail";
      return "burn";

    case "burn_submitted":
    case "attesting":
      // The burn is on-chain; now we wait for IRIS. The wait is bounded by the
      // wall clock, NOT the retry budget (a poll loop is waiting, not failing).
      if (attestationAvailable(row, inputs)) return "receive";
      if (attestationDeadlineExceeded(row, inputs)) return "fail";
      return "await_attestation";

    case "receiving":
      // Mid-flight receiveMessage (the loop persisted `receiving` before the
      // mint receipt-await). Resume it — but a burnt retry budget is terminal.
      if (row.attempts >= maxAttempts) return "fail";
      return "receive";

    default: {
      // Exhaustive guard: an unknown status is an operator-path failure.
      const _exhaustive: never = row.status;
      void _exhaustive;
      return "fail";
    }
  }
}
