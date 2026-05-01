import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db/client";
import { invoices, relayerQueue } from "@/lib/db/schema";
import { eq } from "drizzle-orm";

/**
 * v0.8 customer-side submit. The customer signs a Permit2 EIP-712 message
 * in their wallet (gas-less); the SDK POSTs it here. We validate, persist
 * to relayer_queue, and the daemon picks it up on its next tick.
 *
 * The signature is NOT validated on-chain at this point — that happens
 * later when Permit2.permitWitnessTransferFrom executes. We do shape and
 * deadline checks so obviously-bad payloads don't waste a queue slot.
 */

const HEX = /^0x[0-9a-fA-F]+$/;
const ADDR = z.string().regex(/^0x[0-9a-fA-F]{40}$/, "must be a 0x-prefixed address");
const HEX32 = z.string().regex(/^0x[0-9a-fA-F]{64}$/, "must be 32 bytes hex");

const SubmitBody = z.object({
  invoiceId:        HEX32,
  payer:            ADDR,
  payInToken:       ADDR,
  amountIn:         z.string().regex(/^\d+$/, "amountIn must be a base-units integer string"),
  permit2Data: z.object({
    nonce:             z.string().regex(/^\d+$/),
    deadline:          z.string().regex(/^\d+$/),
    witness:           HEX32,
    witnessTypeString: z.string().min(1),
  }),
  permit2Signature: z.string().regex(HEX, "must be hex"),
});

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  const parsed = SubmitBody.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "bad_params", details: parsed.error.issues }, { status: 400 });
  }
  const { invoiceId, payer, payInToken, amountIn, permit2Data, permit2Signature } = parsed.data;

  // Reject obviously-stale signatures.
  const deadlineMs = Number(permit2Data.deadline) * 1000;
  if (deadlineMs < Date.now()) {
    return NextResponse.json({ error: "permit_expired" }, { status: 400 });
  }

  // Invoice must exist and be in `created` state. Anything else means
  // either someone replayed an old invoice id or the indexer already moved
  // it to paid/expired/refunded; either way we don't queue.
  const invRows = await db.select().from(invoices).where(eq(invoices.id, invoiceId)).limit(1);
  const inv = invRows[0];
  if (!inv) {
    return NextResponse.json({ error: "invoice_not_found" }, { status: 404 });
  }
  if (inv.status !== "created") {
    return NextResponse.json({ error: "invoice_not_payable", status: inv.status }, { status: 409 });
  }
  if (inv.expiresAt.getTime() < Date.now()) {
    return NextResponse.json({ error: "invoice_expired" }, { status: 410 });
  }

  // Insert the queue row. The relayer daemon claims it on its next tick
  // (≤ RELAYER_TICK_MS, default 5s).
  const inserted = await db.insert(relayerQueue).values({
    invoiceId,
    payer:            payer.toLowerCase(),
    payInToken:       payInToken.toLowerCase(),
    amountIn,
    payoutToken:      inv.payoutToken,
    amountOutMin:     inv.amountOut,
    permit2Data,
    permit2Signature,
  }).returning({ id: relayerQueue.id });

  return NextResponse.json({
    submissionId: inserted[0]!.id,
    invoiceId,
    statusUrl:    `/api/checkout/status/${inserted[0]!.id}`,
  }, { status: 202 });
}
