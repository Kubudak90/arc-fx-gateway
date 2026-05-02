import { NextResponse } from "next/server";
import { and, desc, eq } from "drizzle-orm";
import { getSession } from "@/lib/auth/session";
import { db } from "@/lib/db/client";
import { merchants, invoices, complianceScreenings } from "@/lib/db/schema";

/**
 * Merchant-facing compliance summary:
 *   - their own latest payout-address screen (for onboarding visibility)
 *   - any customer screens for their invoices that came back as `review`
 *
 * No override capability — the merchant can see what was held and why-the-API-said-so,
 * but rejects flow through ops escalation only (resolved 2026-05-02).
 */
export async function GET() {
  const session = await getSession();
  if (!session.merchantAddress) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const merchantRow = (await db
    .select()
    .from(merchants)
    .where(eq(merchants.address, session.merchantAddress))
    .limit(1))[0];

  if (!merchantRow) {
    return NextResponse.json({ merchant: null, ownScreen: null, reviewQueue: [] });
  }

  const ownScreen = (await db
    .select()
    .from(complianceScreenings)
    .where(and(
      eq(complianceScreenings.merchantId, merchantRow.id),
      eq(complianceScreenings.flow, "merchant_payout"),
    ))
    .orderBy(desc(complianceScreenings.createdAt))
    .limit(1))[0] ?? null;

  // Customer reviews scoped to this merchant's invoices.
  const reviewQueue = await db
    .select({
      id: complianceScreenings.id,
      address: complianceScreenings.address,
      invoiceId: complianceScreenings.invoiceId,
      ticketId: complianceScreenings.ticketId,
      risk: complianceScreenings.risk,
      decision: complianceScreenings.decision,
      createdAt: complianceScreenings.createdAt,
      invoiceAmountOut: invoices.amountOut,
      invoicePayoutToken: invoices.payoutToken,
      invoiceStatus: invoices.status,
    })
    .from(complianceScreenings)
    .innerJoin(invoices, eq(complianceScreenings.invoiceId, invoices.id))
    .where(and(
      eq(invoices.merchantId, merchantRow.id),
      eq(complianceScreenings.flow, "customer_pay"),
      eq(complianceScreenings.decision, "review"),
    ))
    .orderBy(desc(complianceScreenings.createdAt))
    .limit(50);

  return NextResponse.json({
    merchant: { address: merchantRow.address, payoutToken: merchantRow.payoutToken },
    ownScreen: ownScreen
      ? {
          risk: ownScreen.risk,
          decision: ownScreen.decision,
          provider: ownScreen.provider,
          createdAt: ownScreen.createdAt,
        }
      : null,
    reviewQueue,
  });
}
