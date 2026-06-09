import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { and, eq } from "drizzle-orm";
import type { Address, Hex } from "viem";
import { db } from "@/lib/db/client";
import { crosschainPayments } from "@/lib/db/schema";
import { verifySourceBurnTx } from "@/lib/crosschain/receipt";
import { recordCheckoutEvent } from "@/lib/crosschain/telemetry";
import { takeToken } from "@/lib/rate/limiter";
import { clientIp } from "@/lib/rate/clientIp";

// Per-IP rate limit, mirroring /api/checkout/crosschain/prepare. Each submit
// hits the DB and fans out two source-chain RPC reads for burn verification.
// 30/60s is generous for a real checkout while capping abuse. Fail-open on
// limiter outage.
const SUBMIT_LIMIT = 30;
const SUBMIT_WINDOW_SECONDS = 60;

const Body = z.object({
  intentId: z.string().uuid(),
  burnTxHash: z.string().regex(/^0x[0-9a-fA-F]{64}$/),
});

export async function POST(req: NextRequest) {
  const ip = clientIp(req);
  let allowed = true;
  try {
    allowed = await takeToken(`cc-submit:${ip}`, SUBMIT_LIMIT, SUBMIT_WINDOW_SECONDS);
  } catch {
    allowed = true; // fail-open: limiter outage must not block checkout
  }
  if (!allowed) {
    return NextResponse.json(
      { error: "rate_limited", retryAfterSeconds: SUBMIT_WINDOW_SECONDS },
      { status: 429, headers: { "retry-after": String(SUBMIT_WINDOW_SECONDS) } },
    );
  }

  const body = await req.json().catch(() => null);
  const parsed = Body.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "bad_params", details: parsed.error.issues }, { status: 400 });
  }

  const { intentId, burnTxHash } = parsed.data;
  const payment = (await db
    .select()
    .from(crosschainPayments)
    .where(eq(crosschainPayments.id, intentId))
    .limit(1))[0];

  if (!payment) return NextResponse.json({ error: "intent_not_found" }, { status: 404 });
  if (payment.status !== "authorized") {
    return NextResponse.json({ error: "intent_not_submittable", status: payment.status }, { status: 409 });
  }

  try {
    await verifySourceBurnTx({
      sourceChainId: payment.sourceChainId,
      burnTxHash: burnTxHash as Hex,
      expectedPayer: payment.payer,
      expectedAmount: BigInt(payment.sourceAmount),
      expectedDestinationDomain: payment.destinationDomain,
      expectedMintRecipient: payment.mintRecipient as Hex,
      expectedBurnToken: payment.sourceToken as Address,
    });
  } catch (e) {
    // A failed verification leaves the row "authorized" so the customer can
    // retry with the correct transaction hash.
    const error = e instanceof Error ? e.message : String(e);
    recordCheckoutEvent({
      invoiceId: payment.invoiceId,
      crosschainPaymentId: intentId,
      eventType: "crosschain_burn_rejected",
      sourceChainId: payment.sourceChainId,
      errorCode: error,
    }).catch((err) => console.error("crosschain_submit telemetry write failed", err));
    return NextResponse.json({ error }, { status: 400 });
  }

  const updated = await db.update(crosschainPayments)
    .set({
      status: "bridge_pending",
      burnTxHash,
      burnSubmittedAt: new Date(),
      updatedAt: new Date(),
    })
    // Status race guard: two concurrent submits must not both transition the
    // row or overwrite burnTxHash. Only the one that finds the row still
    // "authorized" wins; the loser gets a 409 like any late submit.
    .where(and(eq(crosschainPayments.id, intentId), eq(crosschainPayments.status, "authorized")))
    .returning({ id: crosschainPayments.id });
  if (!updated[0]) {
    return NextResponse.json({ error: "intent_not_submittable" }, { status: 409 });
  }

  recordCheckoutEvent({
    invoiceId: payment.invoiceId,
    crosschainPaymentId: intentId,
    eventType: "crosschain_burn_submitted",
    sourceChainId: payment.sourceChainId,
  }).catch((err) => console.error("crosschain_submit telemetry write failed", err));

  return NextResponse.json({
    intentId,
    invoiceId: payment.invoiceId,
    status: "bridge_pending",
    statusUrl: `/api/checkout/crosschain/status/${intentId}`,
  }, { status: 202 });
}
