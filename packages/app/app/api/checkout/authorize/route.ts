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

/**
 * Compute the floor amountIn the customer must commit. Used by both the
 * normal allow path and the fail-open path so a fail-open cross-token
 * invoice doesn't store inv.amountOut as the floor (in payoutToken units)
 * which is unreachable from a payInToken commit and would force submit to
 * always reject with amount_below_floor. Audit residual P2 (2026-05-05).
 *
 * Throws on unknown token or quote failure — caller decides whether to
 * fail closed (normal path: 503) or fall through to a degraded reject
 * (fail-open path: same 503 — there's no safe default for "compliance
 * provider down AND quote provider down").
 */
async function calculateMinAmountIn(inv: { payInToken: string; payoutToken: string; amountOut: string }): Promise<bigint> {
  if (inv.payInToken.toLowerCase() === inv.payoutToken.toLowerCase()) {
    return BigInt(inv.amountOut);
  }
  const inSym  = tokenSymbol(inv.payInToken);
  const outSym = tokenSymbol(inv.payoutToken);
  if (!inSym || !outSym) {
    throw new Error("unknown_token");
  }
  const q = await estimateSwapForTarget({
    payInToken:  inSym,
    payoutToken: outSym,
    targetOutputBaseUnits: BigInt(inv.amountOut),
  });
  return q.recommendedPayInBaseUnits;
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
      // Audit residual P2 (2026-05-05): fail-open path computes the SAME
      // minAmountIn as the normal allow path — for cross-token, that means
      // hitting the App Kit estimator. If the quote also fails, we can't
      // return a usable allow (submit would reject every commit with
      // amount_below_floor); fall through to the same 503 reject the
      // normal compliance-only failure produces.
      let minAmountIn: bigint;
      try {
        minAmountIn = await calculateMinAmountIn(inv);
      } catch {
        return NextResponse.json({
          decision: "reject",
          code: "PROVIDER_UNAVAILABLE",
          reason: "Compliance and quote providers are currently unavailable. Please try again shortly.",
        }, { status: 503 });
      }
      const expiresAt = new Date(Date.now() + AUTH_TTL_MINUTES * 60_000);
      try {
        await db.insert(checkoutAuthorizations).values({
          invoiceId,
          payer:        address.toLowerCase(),
          payInToken:   inv.payInToken.toLowerCase(),
          minAmountIn:  minAmountIn.toString(),
          expiresAt,
        });
      } catch {
        // Persist failed too — fail-open without a queueable authorization
        // is a soft-deny anyway. Surface as reject so the frontend doesn't
        // start a sign flow that submit would only reject.
        return NextResponse.json({
          decision: "reject",
          code: "PROVIDER_UNAVAILABLE",
          reason: "Authorization could not be persisted. Please try again shortly.",
        }, { status: 503 });
      }
      return NextResponse.json({
        decision: "allow",
        providerDegraded: true,
        screenedAt: new Date().toISOString(),
        ttlSeconds: 0,
        minAmountIn: minAmountIn.toString(),
        authorizationExpiresAt: expiresAt.toISOString(),
      }, { status: 200 });
    }
    return NextResponse.json({
      decision: "reject",
      code: "PROVIDER_UNAVAILABLE",
      reason: "Compliance provider is currently unavailable. Please try again shortly.",
    }, { status: 503 });
  }

  if (result.decision === "allow") {
    // Compute floor via the shared helper — same logic the fail-open path
    // uses. Audit residual: previously the two paths diverged (fail-open
    // used inv.amountOut for cross-token, which is the merchant floor in
    // the wrong token).
    let minAmountIn: bigint;
    try {
      minAmountIn = await calculateMinAmountIn(inv);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (msg === "unknown_token") {
        return NextResponse.json({ error: "unknown_token", payInToken: inv.payInToken }, { status: 503 });
      }
      return NextResponse.json({
        error: "quote_unavailable",
        message: msg,
      }, { status: 502 });
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
        // `eventType` is required (audit H5, 2026-05-05) and pairs with
        // invoiceId in a unique index. compliance.review_queued is one-shot
        // per (invoice, payer) decision, so a duplicate is a no-op.
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
          eventType: "compliance.review_queued",
        }).onConflictDoNothing({
          target: [webhookAttempts.invoiceId, webhookAttempts.eventType],
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
