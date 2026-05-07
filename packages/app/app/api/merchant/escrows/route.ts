import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth/session";
import { db } from "@/lib/db/client";
import { merchants, invoices } from "@/lib/db/schema";
import { and, eq, gt, lte } from "drizzle-orm";

/**
 * GET /api/merchant/escrows
 *
 * Returns V10 escrow state grouped into three buckets:
 *   pending  — paid, claimableAt in the future (still within 7-day refund window)
 *   matured  — paid, claimableAt ≤ now (window elapsed, ready to claim)
 *   claimed  — already claimed (last 50 rows)
 *
 * Auth: iron-session cookie (same as /api/merchant/treasury).
 */
export async function GET() {
  const session = await getSession();
  if (!session.merchantAddress) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const merchantRow = (
    await db.select().from(merchants).where(eq(merchants.address, session.merchantAddress)).limit(1)
  )[0];
  if (!merchantRow) {
    return NextResponse.json({
      pending: [],
      matured: [],
      claimed: [],
      counts: { pending: 0, matured: 0, claimed: 0 },
    });
  }

  const now = new Date();

  const [pending, matured, claimed] = await Promise.all([
    db.select().from(invoices).where(and(
      eq(invoices.merchantId, merchantRow.id),
      eq(invoices.status, "paid"),
      gt(invoices.claimableAt, now),
    )),
    db.select().from(invoices).where(and(
      eq(invoices.merchantId, merchantRow.id),
      eq(invoices.status, "paid"),
      lte(invoices.claimableAt, now),
    )),
    db.select().from(invoices).where(and(
      eq(invoices.merchantId, merchantRow.id),
      eq(invoices.status, "claimed"),
    )).limit(50),
  ]);

  return NextResponse.json({
    pending,
    matured,
    claimed,
    counts: { pending: pending.length, matured: matured.length, claimed: claimed.length },
  });
}
