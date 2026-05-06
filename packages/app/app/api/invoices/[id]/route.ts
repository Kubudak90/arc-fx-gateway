import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db/client";
import { invoices, merchants } from "@/lib/db/schema";
import { eq } from "drizzle-orm";

export async function GET(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  // Audit H1 (2026-05-05): expose merchant's allowed_origins so the checkout
  // client can do a defense-in-depth check before redirecting after pay
  // (server enforces it at create-time; this guards stale/cached invoices).
  const rows = await db
    .select({
      id: invoices.id,
      status: invoices.status,
      payInToken: invoices.payInToken,
      amountOut: invoices.amountOut,
      expiresAt: invoices.expiresAt,
      paidBy: invoices.paidBy,
      paidTx: invoices.paidTx,
      paidAt: invoices.paidAt,
      metadata: invoices.metadata,
      allowedOrigins: merchants.allowedOrigins,
    })
    .from(invoices)
    .innerJoin(merchants, eq(merchants.id, invoices.merchantId))
    .where(eq(invoices.id, id))
    .limit(1);
  if (rows.length === 0) return NextResponse.json({ error: "not_found" }, { status: 404 });
  const inv = rows[0]!;
  return NextResponse.json({
    id: inv.id,
    status: inv.status,
    payInToken: inv.payInToken,
    amountOut: inv.amountOut,
    expiresAt: inv.expiresAt.toISOString(),
    paidBy: inv.paidBy,
    paidTx: inv.paidTx,
    paidAt: inv.paidAt?.toISOString() ?? null,
    metadata: inv.metadata,
    allowedOrigins: inv.allowedOrigins ?? [],
  });
}
