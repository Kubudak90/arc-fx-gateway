import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { eq } from "drizzle-orm";
import type { Address } from "viem";
import { chainById, parseChainRegistryJson } from "@arcora/crosschain-core";
import { db } from "@/lib/db/client";
import { invoices, crosschainPayments } from "@/lib/db/schema";
import { resolveComplianceProvider } from "@/lib/compliance/factory";
import { screenWithAudit } from "@/lib/compliance/screen";
import { buildCrosschainIntent } from "@/lib/crosschain/intent";
import { recordCheckoutEvent } from "@/lib/crosschain/telemetry";
import { estimateSwapForTarget } from "@/lib/checkout/quote-server";
import { takeToken } from "@/lib/rate/limiter";
import { clientIp } from "@/lib/rate/clientIp";

// Per-IP rate limit, mirroring /api/checkout/authorize. Each prepare call
// hits the DB, the compliance provider on a cache miss, and (for EURC
// payouts) the App Kit estimator. 30/60s is generous for a real checkout
// while capping abuse. Fail-open on limiter outage.
const PREPARE_LIMIT = 30;
const PREPARE_WINDOW_SECONDS = 60;

const HEX32 = z.string().regex(/^0x[0-9a-fA-F]{64}$/);
const ADDR = z.string().regex(/^0x[0-9a-fA-F]{40}$/);

const Body = z.object({
  invoiceId: HEX32,
  payer: ADDR,
  sourceChainId: z.number().int().positive(),
});

export async function POST(req: NextRequest) {
  const ip = clientIp(req);
  let allowed = true;
  try {
    allowed = await takeToken(`cc-prepare:${ip}`, PREPARE_LIMIT, PREPARE_WINDOW_SECONDS);
  } catch {
    allowed = true; // fail-open: limiter outage must not block checkout
  }
  if (!allowed) {
    return NextResponse.json(
      { error: "rate_limited", retryAfterSeconds: PREPARE_WINDOW_SECONDS },
      { status: 429, headers: { "retry-after": String(PREPARE_WINDOW_SECONDS) } },
    );
  }

  const body = await req.json().catch(() => null);
  const parsed = Body.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "bad_params", details: parsed.error.issues }, { status: 400 });
  }

  const { invoiceId, payer, sourceChainId } = parsed.data;
  const inv = (await db.select().from(invoices).where(eq(invoices.id, invoiceId)).limit(1))[0];
  if (!inv) return NextResponse.json({ error: "invoice_not_found" }, { status: 404 });
  if (inv.status !== "created") return NextResponse.json({ error: "invoice_not_payable", status: inv.status }, { status: 409 });
  if (inv.expiresAt.getTime() < Date.now()) return NextResponse.json({ error: "invoice_expired" }, { status: 410 });

  const provider = resolveComplianceProvider();
  const screen = await screenWithAudit({
    db,
    provider,
    address: payer,
    context: { flow: "customer_pay", invoiceId },
  });
  if (screen.decision !== "allow") {
    await recordCheckoutEvent({
      invoiceId,
      eventType: "crosschain_prepare_blocked",
      sourceChainId,
      errorCode: screen.decision,
    });
    return NextResponse.json({
      decision: screen.decision,
      ticketId: screen.ticketId,
    }, { status: screen.decision === "review" ? 202 : 403 });
  }

  const relayer = process.env.NEXT_PUBLIC_RELAYER_ADDRESS as Address | undefined;
  if (!relayer) return NextResponse.json({ error: "relayer_unconfigured" }, { status: 503 });

  let intent;
  try {
    const registryJson = process.env.CROSSCHAIN_CHAIN_CONFIG_JSON;
    if (!registryJson) throw new Error("CROSSCHAIN_CHAIN_CONFIG_JSON missing");
    const arc = chainById(parseChainRegistryJson(registryJson), 5_042_002);
    if (inv.payInToken.toLowerCase() !== arc.tokens.USDC.address.toLowerCase()) {
      return NextResponse.json({ error: "crosschain_requires_arc_usdc_payin" }, { status: 409 });
    }

    let sourceAmountBaseUnits = BigInt(inv.amountOut);
    if (inv.payoutToken.toLowerCase() !== arc.tokens.USDC.address.toLowerCase()) {
      if (!arc.tokens.EURC || inv.payoutToken.toLowerCase() !== arc.tokens.EURC.address.toLowerCase()) {
        return NextResponse.json({ error: "unsupported_payout_token" }, { status: 400 });
      }
      const quote = await estimateSwapForTarget({
        payInToken: "USDC",
        payoutToken: "EURC",
        targetOutputBaseUnits: BigInt(inv.amountOut),
      });
      sourceAmountBaseUnits = quote.recommendedPayInBaseUnits;
    }

    intent = buildCrosschainIntent({
      invoiceId,
      payer: payer as Address,
      sourceChainId,
      payoutToken: inv.payoutToken as Address,
      sourceAmountBaseUnits,
      relayerAddress: relayer,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    const error = /source chain disabled/.test(msg) ? "source_chain_disabled" : "route_unavailable";
    return NextResponse.json({ error, detail: msg }, { status: 400 });
  }

  const inserted = await db.insert(crosschainPayments).values({
    invoiceId,
    idempotencyKey: intent.idempotencyKey,
    payer: payer.toLowerCase(),
    sourceChainId,
    sourceDomain: intent.route.source.cctpDomain,
    sourceToken: intent.route.sourceToken.address.toLowerCase(),
    sourceAmount: intent.sourceAmountBaseUnits.toString(),
    destinationChainId: intent.destinationChainId,
    destinationDomain: intent.destinationDomain,
    destinationToken: intent.destinationToken.toLowerCase(),
    mintRecipient: intent.mintRecipient.toLowerCase(),
    payoutToken: inv.payoutToken.toLowerCase(),
    amountOutMin: inv.amountOut,
    routeVersion: intent.routeVersion,
    status: "authorized",
  }).onConflictDoUpdate({
    target: crosschainPayments.idempotencyKey,
    set: { updatedAt: new Date() },
  }).returning({ id: crosschainPayments.id });

  const intentId = inserted[0]!.id;
  await recordCheckoutEvent({
    invoiceId,
    crosschainPaymentId: intentId,
    eventType: "crosschain_prepare_created",
    sourceChainId,
    metadata: { routeVersion: intent.routeVersion },
  });

  return NextResponse.json({
    intentId,
    invoiceId,
    sourceChain: {
      chainId: intent.route.source.chainId,
      label: intent.route.source.label,
      cctpDomain: intent.route.source.cctpDomain,
    },
    destinationChain: {
      chainId: intent.route.destination.chainId,
      label: intent.route.destination.label,
      cctpDomain: intent.route.destination.cctpDomain,
    },
    depositForBurn: {
      amount: intent.sourceAmountBaseUnits.toString(),
      burnToken: intent.route.sourceToken.address,
      tokenMessenger: intent.route.source.tokenMessenger,
      destinationDomain: intent.destinationDomain,
      mintRecipient: intent.mintRecipient,
      maxFee: "0",
      finalityThreshold: 2000,
    },
    expiresAt: inv.expiresAt.toISOString(),
  }, { status: 201 });
}
