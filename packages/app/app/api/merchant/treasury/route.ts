import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth/session";
import { db } from "@/lib/db/client";
import { merchants, invoices } from "@/lib/db/schema";
import { and, eq, desc, inArray } from "drizzle-orm";
import { sql } from "drizzle-orm";

const USDC = (process.env.USDC_ADDRESS ?? "").toLowerCase();
const EURC = (process.env.EURC_ADDRESS ?? "").toLowerCase();

export async function GET() {
  const session = await getSession();
  if (!session.merchantAddress) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const merchantRow = (
    await db.select().from(merchants).where(eq(merchants.address, session.merchantAddress)).limit(1)
  )[0];
  if (!merchantRow) {
    return NextResponse.json({ merchant: null, totals: [], activity: [] });
  }

  // Per-stable aggregate: sum payouts + fees, partitioned by status (paid vs refunded).
  const aggregates = await db
    .select({
      payoutToken: invoices.payoutToken,
      status:      invoices.status,
      payoutSum:   sql<string>`coalesce(sum(${invoices.merchantPayout}::numeric), 0)::text`,
      feeSum:      sql<string>`coalesce(sum(${invoices.protocolFee}::numeric), 0)::text`,
      count:       sql<number>`count(*)::int`,
    })
    .from(invoices)
    .where(
      and(
        eq(invoices.merchantId, merchantRow.id),
        inArray(invoices.status, ["paid", "refunded"]),
      ),
    )
    .groupBy(invoices.payoutToken, invoices.status);

  // Reshape into per-token rollup.
  type Rollup = {
    token: string;
    received: string;        // paid - refunded, the merchant's actual current holdings credited from Arcora
    grossVolume: string;     // paid + refunded, total settled volume
    refunded: string;
    feesPaid: string;        // protocol fees from this merchant's paid invoices (irrespective of refund)
    paidCount: number;
    refundedCount: number;
  };
  const byToken = new Map<string, Rollup>();
  for (const row of aggregates) {
    const tk = row.payoutToken;
    if (!byToken.has(tk)) {
      byToken.set(tk, {
        token: tk,
        received: "0",
        grossVolume: "0",
        refunded: "0",
        feesPaid: "0",
        paidCount: 0,
        refundedCount: 0,
      });
    }
    const r = byToken.get(tk)!;
    if (row.status === "paid") {
      r.received    = (BigInt(r.received)    + BigInt(row.payoutSum)).toString();
      r.grossVolume = (BigInt(r.grossVolume) + BigInt(row.payoutSum)).toString();
      r.feesPaid    = (BigInt(r.feesPaid)    + BigInt(row.feeSum)).toString();
      r.paidCount   = row.count;
    } else if (row.status === "refunded") {
      r.refunded    = (BigInt(r.refunded)    + BigInt(row.payoutSum)).toString();
      r.grossVolume = (BigInt(r.grossVolume) + BigInt(row.payoutSum)).toString();
      r.feesPaid    = (BigInt(r.feesPaid)    + BigInt(row.feeSum)).toString();
      // Refunded invoices: merchant's holdings DROP by payoutSum (they paid the customer back).
      r.received    = (BigInt(r.received)    - BigInt(row.payoutSum)).toString();
      r.refundedCount = row.count;
    }
  }

  // Recent activity: last 20 paid or refunded invoices, newest first.
  const activity = await db
    .select({
      id:         invoices.id,
      payoutToken: invoices.payoutToken,
      payInToken:  invoices.payInToken,
      amountOut:   invoices.amountOut,
      merchantPayout: invoices.merchantPayout,
      status:     invoices.status,
      paidAt:     invoices.paidAt,
      paidTx:     invoices.paidTx,
      refundedAt: invoices.refundedAt,
      refundTx:   invoices.refundTx,
    })
    .from(invoices)
    .where(
      and(
        eq(invoices.merchantId, merchantRow.id),
        inArray(invoices.status, ["paid", "refunded"]),
      ),
    )
    .orderBy(desc(invoices.paidAt))
    .limit(20);

  return NextResponse.json({
    merchant: {
      address: merchantRow.address,
      payoutToken: merchantRow.payoutToken,
    },
    knownTokens: { USDC, EURC },
    totals: Array.from(byToken.values()),
    activity: activity.map(a => ({
      id: a.id,
      payoutToken: a.payoutToken,
      payInToken:  a.payInToken,
      amountOut:   a.amountOut,
      merchantPayout: a.merchantPayout,
      status: a.status,
      eventAt: (a.refundedAt ?? a.paidAt)?.toISOString() ?? null,
      txHash:  a.refundTx ?? a.paidTx,
    })),
  });
}
