import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { and, eq, inArray } from "drizzle-orm";
import type { Address, Hex } from "viem";
import { db } from "@/lib/db/client";
import { invoices, relayerQueue } from "@/lib/db/schema";
import { expectedWitnessHash } from "@/lib/checkout/witness";

/**
 * v0.8 customer-side submit. The customer signs a Permit2 EIP-712 message
 * in their wallet (gas-less); the SDK POSTs it here. We validate, persist
 * to relayer_queue, and the daemon picks it up on its next tick.
 *
 * Hardening (audit P1, 2026-05-03):
 *  - Witness re-derivation: the witness hash sent in must equal the value we
 *    compute from (invoiceId, relayer). This locks the signed message to
 *    *our* relayer, so a griefer can't submit Permit2 messages signed for
 *    another spender against a public invoice id and waste relayer gas.
 *  - payInToken bind: must match the invoice's expected pay-in token.
 *  - amountIn bounds: positive, below a sanity cap, in base units.
 *  - Idempotency: reject if a queue row in pending/processing/settled state
 *    already exists for this invoice. Failed/refunded rows clear the lane.
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

const RELAYER_ADDRESS = (process.env.NEXT_PUBLIC_RELAYER_ADDRESS ?? "") as Address;
const MAX_AMOUNT_IN_BASE_UNITS = 10n ** 30n; // ~10^30, generous upper bound covers any sane stable transfer

const ACTIVE_QUEUE_STATUSES = ["pending", "processing", "settled"] as const satisfies readonly ("pending" | "processing" | "settled")[];

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

  // amountIn must be positive and within a sane bound. Zod regex `^\d+$`
  // allows zero — handle that here, and reject obviously-bogus huge values.
  let amountInBig: bigint;
  try {
    amountInBig = BigInt(amountIn);
  } catch {
    return NextResponse.json({ error: "bad_amount_in" }, { status: 400 });
  }
  if (amountInBig <= 0n || amountInBig > MAX_AMOUNT_IN_BASE_UNITS) {
    return NextResponse.json({ error: "amount_in_out_of_range" }, { status: 400 });
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

  // Bind payInToken to the invoice's expected pay-in token.
  if (inv.payInToken.toLowerCase() !== payInToken.toLowerCase()) {
    return NextResponse.json({ error: "pay_in_token_mismatch" }, { status: 400 });
  }

  // Bind witness to (invoiceId, our relayer). If RELAYER_ADDRESS isn't set
  // we can't validate — fail closed instead of accepting any witness.
  if (!RELAYER_ADDRESS || !RELAYER_ADDRESS.startsWith("0x")) {
    return NextResponse.json({ error: "relayer_unconfigured" }, { status: 503 });
  }
  const expected = expectedWitnessHash(invoiceId as Hex, RELAYER_ADDRESS);
  if (permit2Data.witness.toLowerCase() !== expected.toLowerCase()) {
    return NextResponse.json({ error: "witness_mismatch" }, { status: 400 });
  }

  // Idempotency: reject if a non-failed queue row already exists for this
  // invoice. Customer should not submit twice; relayer would either retry
  // their first attempt or settle from it. Failed/refunded rows clear the
  // lane (they didn't settle, retry is welcome).
  const existing = await db
    .select({ id: relayerQueue.id, status: relayerQueue.status })
    .from(relayerQueue)
    .where(and(
      eq(relayerQueue.invoiceId, invoiceId),
      inArray(relayerQueue.status, ACTIVE_QUEUE_STATUSES),
    ))
    .limit(1);
  if (existing[0]) {
    return NextResponse.json(
      { error: "duplicate_submission", existingStatus: existing[0].status },
      { status: 409 },
    );
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
