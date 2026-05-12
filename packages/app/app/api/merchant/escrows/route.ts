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
 *   claimed  — already claimed
 *
 * All three buckets cap at PAGE_SIZE rows. When a bucket has more, the
 * response includes `truncated.<bucket> = true` so the UI can render a
 * "200+ — narrow filters or contact support" hint and the edge function
 * doesn't get DoS'd by a merchant with tens of thousands of invoices.
 *
 * Auth: iron-session cookie (same as /api/merchant/treasury).
 */
const PAGE_SIZE = 200;

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
      counts:    { pending: 0,     matured: 0,     claimed: 0     },
      truncated: { pending: false, matured: false, claimed: false },
    });
  }

  const now = new Date();

  // Fetch PAGE_SIZE + 1 so we can detect truncation without a second count query.
  const probeLimit = PAGE_SIZE + 1;
  const [pendingRows, maturedRows, claimedRows] = await Promise.all([
    db.select().from(invoices).where(and(
      eq(invoices.merchantId, merchantRow.id),
      eq(invoices.status, "paid"),
      gt(invoices.claimableAt, now),
    )).limit(probeLimit),
    db.select().from(invoices).where(and(
      eq(invoices.merchantId, merchantRow.id),
      eq(invoices.status, "paid"),
      lte(invoices.claimableAt, now),
    )).limit(probeLimit),
    db.select().from(invoices).where(and(
      eq(invoices.merchantId, merchantRow.id),
      eq(invoices.status, "claimed"),
    )).limit(probeLimit),
  ]);

  const cap = <T>(rows: T[]) => ({
    rows:       rows.slice(0, PAGE_SIZE),
    truncated:  rows.length > PAGE_SIZE,
  });
  const pending = cap(pendingRows);
  const matured = cap(maturedRows);
  const claimed = cap(claimedRows);

  return NextResponse.json({
    pending: pending.rows,
    matured: matured.rows,
    claimed: claimed.rows,
    counts: {
      pending: pending.rows.length,
      matured: matured.rows.length,
      claimed: claimed.rows.length,
    },
    truncated: {
      pending: pending.truncated,
      matured: matured.truncated,
      claimed: claimed.truncated,
    },
  });
}
