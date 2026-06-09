/**
 * Cross-chain payment state machine (Q1 v2). Pure: every side effect goes
 * through the injected `CrosschainWorkerDeps`, so this module is unit-testable
 * without a chain, IRIS, or Postgres. run.ts wires the real implementations.
 *
 * Flow per claimed row:
 *   bridge_pending ──▶ fetchAttestation (IRIS)        ── not ready ─▶ re-mark bridge_pending + future next_attempt
 *                  ──▶ bridge_confirmed (att persisted)
 *                  ──▶ receiveMessage (Arc mint)      ──▶ settle_pending | arc_swap_pending
 *   arc_swap_pending ─▶ swapOnArc (USDC → payout)     ──▶ settle_pending
 *   settle_pending  ──▶ settleOnArc (gateway)         ──▶ paid
 *
 * Shortfall policy:
 *   • bridged USDC below the invoice floor → refund the payer on Arc (refunded).
 *   • post-swap shortfall → arc_swap_failed; NEVER auto-refund after a swap
 *     (the relayer holds payout token, not the bridged USDC — operator path).
 *
 * Errors funnel to deps.fail(id, failureState, msg) where failureState tracks
 * the stage we were in (bridge_failed / arc_swap_failed / settle_failed).
 */
import type { Hex } from "viem";
import type { CrosschainState } from "@arcora/crosschain-core";
import type { CrosschainPaymentRow, CrosschainWorkerDeps } from "./crosschain-types";

const ZERO_HASH = "0x0000000000000000000000000000000000000000000000000000000000000000" as Hex;

/** Default wall-clock bound on attestation polling: 2 hours. */
const DEFAULT_ATTESTATION_DEADLINE_MS = 7_200_000;

/** How a claimed row left the state machine — surfaced to the caller for
 *  structured logging. */
export type CrosschainDisposition =
  | "waiting_attestation"
  | "refunded"
  | "paid"
  | "failed"
  | "shortfall_failed";

function payoutIsBridgedUsdc(row: CrosschainPaymentRow): boolean {
  return row.payout_token.toLowerCase() === row.destination_token.toLowerCase();
}

export async function processCrosschainPayment(
  row: CrosschainPaymentRow,
  deps: CrosschainWorkerDeps,
): Promise<CrosschainDisposition> {
  let failureState: CrosschainState = "bridge_failed";
  try {
    let bridgeTx = row.bridge_receive_tx_hash as Hex | null;
    let bridgeAmountReceived = row.bridge_amount_received
      ? BigInt(row.bridge_amount_received)
      : null;
    if (!bridgeTx || bridgeAmountReceived === null) {
      const att = row.cctp_message && row.cctp_attestation
        ? { message: row.cctp_message as Hex, attestation: row.cctp_attestation as Hex }
        : await deps.fetchAttestation(row);

      if (!att) {
        // Wall-clock bound: a burn that has gone this long without an IRIS
        // attestation is not going to get one — go terminal instead of
        // polling forever. Only applies while waiting (an attestation that
        // does arrive after the deadline still processes normally).
        const deadlineMs = deps.attestationDeadlineMs ?? DEFAULT_ATTESTATION_DEADLINE_MS;
        if (
          row.burn_submitted_at != null
          && Date.now() - new Date(row.burn_submitted_at).getTime() > deadlineMs
        ) {
          await deps.fail(row.id, "bridge_failed", "attestation_deadline_exceeded");
          return "failed";
        }
        // Attestation not ready yet — IRIS typically takes a few blocks.
        // Keep the row claimable and come back shortly. attempts resets to 0
        // because poll loops are waiting, not failing — they must not consume
        // the retry budget (the wall-clock deadline above bounds the wait).
        await deps.mark(row.id, {
          status: "bridge_pending",
          attempts: 0,
          next_attempt: new Date(Date.now() + 15_000),
          updated_at: new Date(),
        });
        return "waiting_attestation";
      }

      await deps.mark(row.id, {
        cctp_message: att.message,
        cctp_attestation: att.attestation,
        status: "bridge_confirmed",
        updated_at: new Date(),
      });

      failureState = "bridge_failed";
      const received = await deps.receiveMessage(row, att, async (txHash) => {
        // Persist-before-wait: record the broadcast hash so a crash inside
        // the receipt-await window doesn't re-broadcast receiveMessage
        // (CCTP replay protection would revert the duplicate anyway, but
        // the original mint amount would be unrecoverable from here).
        bridgeTx = txHash;
        // Mid-flight persist: keep the lease so the row isn't reclaimable
        // while the receipt wait is still in progress.
        await deps.mark(row.id, {
          bridge_receive_tx_hash: txHash,
          updated_at: new Date(),
        }, { releaseLease: false });
      });
      bridgeTx = received.txHash;
      bridgeAmountReceived = received.amountReceived;
      await deps.mark(row.id, {
        bridge_receive_tx_hash: bridgeTx,
        bridge_amount_received: bridgeAmountReceived.toString(),
        bridge_confirmed_at: new Date(),
        status: payoutIsBridgedUsdc(row) ? "settle_pending" : "arc_swap_pending",
        updated_at: new Date(),
      });
    }

    if (bridgeAmountReceived === null) {
      throw new Error("bridge_amount_missing");
    }

    let grossPayout = bridgeAmountReceived;
    let swapTxHash = bridgeTx ?? ZERO_HASH;

    if (!payoutIsBridgedUsdc(row)) {
      failureState = "arc_swap_failed";
      if (row.arc_swap_tx_hash && row.arc_swap_amount_out) {
        // Restart idempotency: a prior attempt already swapped — reuse the
        // recorded result instead of swapping the (now spent) USDC again.
        grossPayout = BigInt(row.arc_swap_amount_out);
        swapTxHash = row.arc_swap_tx_hash as Hex;
      } else {
        const swap = await deps.swapOnArc(row);
        grossPayout = swap.amountOut;
        swapTxHash = swap.txHash;
        await deps.mark(row.id, {
          arc_swap_tx_hash: swap.txHash,
          arc_swap_amount_out: swap.amountOut.toString(),
          status: "settle_pending",
          updated_at: new Date(),
        });
      }
    }

    if (grossPayout < BigInt(row.amount_out_min)) {
      if (payoutIsBridgedUsdc(row)) {
        // Bridged USDC came in under the invoice floor (e.g. CCTP fast-burn
        // fee) — return what arrived to the payer rather than settling short.
        const refundTx = await deps.refundOnArc({
          row,
          token: row.destination_token,
          amount: grossPayout,
        });
        await deps.mark(row.id, {
          refund_tx_hash: refundTx,
          status: "refunded",
          last_error: `payout shortfall: ${grossPayout} < ${row.amount_out_min}`,
          updated_at: new Date(),
        });
        return "refunded";
      }
      // Post-swap shortfall: the relayer now holds payout token, not the
      // payer's bridged USDC — never auto-refund here. Operator path.
      await deps.fail(row.id, "arc_swap_failed", `payout shortfall: ${grossPayout} < ${row.amount_out_min}`);
      return "shortfall_failed";
    }

    failureState = "settle_failed";
    const settleTx = await deps.settleOnArc({ row, grossPayout, swapTxHash });
    await deps.mark(row.id, {
      settle_tx_hash: settleTx,
      status: "paid",
      updated_at: new Date(),
    });
    return "paid";
  } catch (e) {
    const error = e instanceof Error ? e.message : String(e);
    await deps.fail(row.id, failureState, error);
    return "failed";
  }
}
