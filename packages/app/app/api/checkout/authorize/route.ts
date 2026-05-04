import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { eq } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { db } from "@/lib/db/client";
import { invoices, merchants, webhookAttempts, checkoutAuthorizations } from "@/lib/db/schema";
import { resolveComplianceProvider } from "@/lib/compliance/factory";
import { screenWithAudit } from "@/lib/compliance/screen";
import { estimateSwapForTarget } from "@/lib/checkout/quote-server";

/**
 * Compliance gate fired by the hosted checkout after wallet connect, before
 * the customer signs the Permit2 message. Returns one of:
 *
 *   allow  → frontend enables the Pay button. Server has also persisted a
 *            `checkout_authorizations` row keyed by (invoice, payer); submit
 *            requires this row before queueing — closes the frontend bypass.
 *   review → Pay button stays disabled; surface the ticketId as "we'll get back"
 *   reject → Pay button stays disabled; neutral copy, no provider leak
 *
 * Provider failures fail-closed by default (better to lose a payment than
 * to settle a sanctioned wallet). Set COMPLIANCE_FAIL_OPEN_FOR_PAY=true to
 * downgrade outages to a soft-allow with a `providerDegraded` flag.
 *
 * Audit pass 1 hardening (2026-05-04):
 *   - On allow, we also issue a server-bound min_amount_in:
 *       same-token  → invoice.amountOut (exact)
 *       cross-token → server App Kit estimate × 0.97 (3% slack for retries)
 *     /api/checkout/submit later requires amountIn >= min_amount_in, so a
 *     direct submitter can't grief the relayer with a tiny-amount sig that
 *     would only fail at settle.
 */

const HEX32 = z.string().regex(/^0x[0-9a-fA-F]{64}$/);
const ADDR  = z.string().regex(/^0x[0-9a-fA-F]{40}$/);

const Body = z.object({ invoiceId: HEX32, address: ADDR });

const AUTH_TTL_MINUTES = 5;

function envFlag(name: string): boolean {
  const v = process.env[name];
  return v === "true" || v === "1";
}

function tokenSymbol(addr: string): "USDC" | "EURC" | null {
  const a = addr.toLowerCase();
  if (a === (process.env.NEXT_PUBLIC_USDC_ADDRESS ?? "").toLowerCase()) return "USDC";
  if (a === (process.env.NEXT_PUBLIC_EURC_ADDRESS ?? "").toLowerCase()) return "EURC";
  return null;
}

export async function POST(req: NextRequest) {
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "bad_params", details: parsed.error.issues }, { status: 400 });
  }
  const { invoiceId, address } = parsed.data;

  const rows = await db.select().from(invoices).where(eq(invoices.id, invoiceId)).limit(1);
  if (!rows[0]) return NextResponse.json({ error: "invoice_not_found" }, { status: 404 });
  const inv = rows[0];

  const provider = resolveComplianceProvider();

  let result;
  try {
    result = await screenWithAudit({
      db, provider, address,
      context: { flow: "customer_pay", invoiceId },
    });
  } catch {
    if (envFlag("COMPLIANCE_FAIL_OPEN_FOR_PAY")) {
      return NextResponse.json({
        decision: "allow",
        providerDegraded: true,
        screenedAt: new Date().toISOString(),
        ttlSeconds: 0,
      }, { status: 200 });
    }
    return NextResponse.json({
      decision: "reject",
      code: "PROVIDER_UNAVAILABLE",
      reason: "Compliance provider is currently unavailable. Please try again shortly.",
    }, { status: 503 });
  }

  if (result.decision === "allow") {
    // Compute min_amount_in. Same-token: customer commits exactly amountOut.
    // Cross-token: estimate server-side, take 97% as the floor (rates can
    // drift up between authorize and signing without exceeding 3% in
    // testnet windows; mainnet RFQ is tighter still).
    let minAmountIn: bigint;
    if (inv.payInToken.toLowerCase() === inv.payoutToken.toLowerCase()) {
      minAmountIn = BigInt(inv.amountOut);
    } else {
      const inSym  = tokenSymbol(inv.payInToken);
      const outSym = tokenSymbol(inv.payoutToken);
      if (!inSym || !outSym) {
        // Unknown token — can't quote. Fail closed; merchants on testnet
        // are USDC/EURC only.
        return NextResponse.json({ error: "unknown_token", payInToken: inv.payInToken }, { status: 503 });
      }
      try {
        const q = await estimateSwapForTarget({
          payInToken:  inSym,
          payoutToken: outSym,
          targetOutputBaseUnits: BigInt(inv.amountOut),
        });
        // 3% cushion below the recommended quote — absorbs rate drift
        // between this estimate and the customer's actual signing moment.
        minAmountIn = (q.recommendedPayInBaseUnits * 97n) / 100n;
      } catch (e) {
        return NextResponse.json({
          error: "quote_unavailable",
          message: e instanceof Error ? e.message : String(e),
        }, { status: 502 });
      }
    }

    const expiresAt = new Date(Date.now() + AUTH_TTL_MINUTES * 60_000);
    await db.insert(checkoutAuthorizations).values({
      invoiceId,
      payer:        address.toLowerCase(),
      payInToken:   inv.payInToken.toLowerCase(),
      minAmountIn:  minAmountIn.toString(),
      expiresAt,
    });

    return NextResponse.json({
      decision: "allow",
      screenedAt: result.cachedAt.toISOString(),
      ttlSeconds: result.ttlSeconds,
      // Inform the SDK what the binding is — useful for diagnostics and to
      // let the client display the locked floor before signing. Submit will
      // re-check this server-side regardless.
      minAmountIn: minAmountIn.toString(),
      authorizationExpiresAt: expiresAt.toISOString(),
    }, { status: 200 });
  }

  if (result.decision === "review") {
    // Notify the merchant out-of-band so they can contact the buyer if they
    // want to. Reuses the existing webhook_attempts dispatcher — payload
    // shape mirrors invoice.paid / invoice.refunded.
    try {
      const merchantRow = (await db
        .select({ webhookUrl: merchants.webhookUrl })
        .from(merchants)
        .where(eq(merchants.id, rows[0].merchantId))
        .limit(1))[0];
      if (merchantRow?.webhookUrl) {
        await db.insert(webhookAttempts).values({
          invoiceId,
          url: merchantRow.webhookUrl,
          payload: {
            event_id:  randomUUID(),
            type:      "compliance.review_queued",
            invoice_id: invoiceId,
            payer:     address.toLowerCase(),
            ticket_id: result.ticketId,
          },
          attempts: 0,
          nextAttempt: new Date(),
        });
      }
    } catch {
      // Webhook enqueue is best-effort; the screening row is already audit-logged.
    }
    return NextResponse.json({
      decision: "review",
      ticketId: result.ticketId,
      reason: "Compliance review required — we'll email the merchant within 24h.",
      supportContact: "compliance@arcorapay.xyz",
    }, { status: 200 });
  }

  // reject — sanctions or high. Neutral copy, no provider reasoning leak.
  return NextResponse.json({
    decision: "reject",
    code: result.risk === "sanctions" ? "SANCTIONED_WALLET" : "HIGH_RISK_WALLET",
    reason: "This wallet can't be used for this payment.",
  }, { status: 200 });
}
