import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db/client";
import { invoices } from "@/lib/db/schema";
import { eq } from "drizzle-orm";

export async function GET(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const rows = await db.select().from(invoices).where(eq(invoices.id, id)).limit(1);
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
  });
}
