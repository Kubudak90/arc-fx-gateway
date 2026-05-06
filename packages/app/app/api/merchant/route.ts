import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth/session";
import { db } from "@/lib/db/client";
import { merchants, invoices } from "@/lib/db/schema";
import { eq, desc } from "drizzle-orm";

export async function GET() {
  const session = await getSession();
  if (!session.merchantAddress) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const rows = await db.select().from(merchants).where(eq(merchants.address, session.merchantAddress)).limit(1);
  if (rows.length === 0) {
    return NextResponse.json({ merchant: null, invoices: [], apiKey: session.apiKey ?? null });
  }
  const m = rows[0]!;
  const invs = await db.select().from(invoices)
    .where(eq(invoices.merchantId, m.id))
    .orderBy(desc(invoices.createdAt))
    .limit(50);
  return NextResponse.json({
    merchant: {
      address: m.address,
      payoutToken: m.payoutToken,
      webhookUrl: m.webhookUrl,
      // Audit H1 (2026-05-05): exposed so AllowedOriginsCard can show /
      // edit the current list. Not a secret — it's an allowlist of
      // post-payment redirect targets.
      allowedOrigins: m.allowedOrigins ?? [],
    },
    invoices: invs.map(i => ({
      id: i.id,
      payInToken: i.payInToken,
      amountOut: i.amountOut,
      status: i.status,
      paidTx: i.paidTx,
      gatewayAddress: i.gatewayAddress,
      createdAt: i.createdAt.toISOString(),
    })),
    apiKey: session.apiKey ?? null,
  });
}
