import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db/client";
import { relayerQueue } from "@/lib/db/schema";
import { eq } from "drizzle-orm";

/**
 * Polled by the SDK / hosted checkout while the customer waits for the
 * relayer to settle their submission. Status values:
 *
 *   pending     queued, waiting for the daemon to claim
 *   processing  daemon has started — Permit2 + swap + settle in flight
 *   settled     gateway emitted InvoicePaid; safe to redirect to successUrl
 *   refunded    swap failed and the relayer auto-refunded the customer
 *   failed      terminal — relayer couldn't settle and couldn't refund;
 *               operator intervention required
 */

export async function GET(
  _req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  const { id } = await ctx.params;
  const rows = await db
    .select({
      status:       relayerQueue.status,
      invoiceId:    relayerQueue.invoiceId,
      attempts:     relayerQueue.attempts,
      swapTxHash:   relayerQueue.swapTxHash,
      settleTxHash: relayerQueue.settleTxHash,
      refundTxHash: relayerQueue.refundTxHash,
      lastError:    relayerQueue.lastError,
      createdAt:    relayerQueue.createdAt,
      updatedAt:    relayerQueue.updatedAt,
    })
    .from(relayerQueue)
    .where(eq(relayerQueue.id, id))
    .limit(1);

  const row = rows[0];
  if (!row) return NextResponse.json({ error: "not_found" }, { status: 404 });

  return NextResponse.json({
    submissionId: id,
    invoiceId:    row.invoiceId,
    status:       row.status,
    attempts:     row.attempts,
    swapTxHash:   row.swapTxHash,
    settleTxHash: row.settleTxHash,
    refundTxHash: row.refundTxHash,
    // Only surface the error string if it's terminal. Mid-flight retry
    // errors are noise to the customer.
    error:        row.status === "failed" ? row.lastError : null,
    createdAt:    row.createdAt.toISOString(),
    updatedAt:    row.updatedAt.toISOString(),
  });
}
