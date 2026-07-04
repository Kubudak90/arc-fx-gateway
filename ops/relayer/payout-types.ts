import type { PayoutState } from "@arcora/crosschain-core";

/**
 * A merchant payout (OUT-hop) row, as claimed from `crosschain_payouts`
 * (select *). Mirrors CrosschainPaymentRow's checkpoint fields so the pure
 * decision fn can resume a crashed payout from any persisted checkpoint.
 */
export interface CrosschainPayoutRow {
  id: string;
  global_id: string;
  invoice_id: string;
  merchant_id: string;
  payout_chain_id: number;
  payout_chain_address: string;
  amount_bridged: string | null;
  status: PayoutState;
  /** Arc claim() that swept escrow into the relayer sweep address. */
  claim_tx: string | null;
  /** CCTP burn on Arc's TokenMessenger (persist-before-wait checkpoint). */
  burn_tx_hash: string | null;
  /** When the burn was submitted — wall-clock anchor for the attestation
   *  deadline (mirror of CrosschainPaymentRow.burn_submitted_at). */
  burn_submitted_at: Date | string | null;
  cctp_message: string | null;
  cctp_attestation: string | null;
  /** receiveMessage on the target chain that minted USDC to the merchant. */
  receive_tx_hash: string | null;
  attempts: number;
  last_error: string | null;
  created_at?: Date | string | null;
  updated_at?: Date | string | null;
}

/** Result of polling IRIS for the burn's attestation (null = not ready). */
export interface PayoutIrisResult {
  message: string;
  attestation: string;
}

/**
 * The next action the worker loop should take for a payout row, decided
 * PURELY from the row's persisted checkpoints + the injected on-chain/IRIS
 * results. No live I/O happens in the decision fn — run.ts (Phase 5) maps each
 * action to the real claim()/depositForBurn/IRIS/receiveMessage calls.
 */
export type PayoutAction =
  | "claim" // pending: sweep escrow on Arc into the relayer sweep address
  | "burn" // claimed: depositForBurn the swept USDC on Arc's TokenMessenger
  | "await_attestation" // burn_submitted/attesting: IRIS hasn't attested yet — re-poll later
  | "receive" // attesting (attestation ready) / receiving: receiveMessage on the target chain
  | "done" // paid_out: terminal, nothing to do
  | "fail"; // give up — operator path (deadline, retry budget, or terminal-failed row)

export interface PayoutDecisionInputs {
  /** Wall-clock now (ms). Injected so the decision fn is deterministic. */
  now: number;
  /** IRIS poll result for this row's burn, if the worker fetched one. */
  irisResult?: PayoutIrisResult | null;
  /** Wall-clock bound on attestation polling, measured from
   *  burn_submitted_at. Defaults to 2 hours when absent (mirror of the IN
   *  hop's DEFAULT_ATTESTATION_DEADLINE_MS). */
  attestationDeadlineMs?: number;
  /** Retry budget for the claim/burn/receive on-chain steps. Defaults to 5. */
  maxAttempts?: number;
}
