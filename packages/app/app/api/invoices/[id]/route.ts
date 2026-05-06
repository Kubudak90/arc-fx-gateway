import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db/client";
import { invoices, merchants } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { lookupMerchantByApiKey } from "@/lib/auth/apikey";

/**
 * Public GET — returns the minimal fields the checkout widget needs.
 * Audit L8 (2026-05-06): `metadata` is merchant-controlled JSONB and must
 * NOT be returned to anonymous callers (it may contain internal order refs,
 * PII-adjacent notes, or custom pricing data). Also drop `paidBy` / `paidTx`
 * from the public shape for the same reason (payer address leaks).
 *
 * Authenticated callers (merchant API key matching this invoice's merchant)
 * receive the full record including `metadata`, `paidBy`, and `paidTx`.
 */
export async function GET(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  // Audit H1 (2026-05-05): expose merchant's allowed_origins so the checkout
  // client can do a defense-in-depth check before redirecting after pay
  // (server enforces it at create-time; this guards stale/cached invoices).
  const rows = await db
    .select({
      id: invoices.id,
      status: invoices.status,
      payInToken: invoices.payInToken,
      payoutToken: invoices.payoutToken,
      amountOut: invoices.amountOut,
      expiresAt: invoices.expiresAt,
      paidBy: invoices.paidBy,
      paidTx: invoices.paidTx,
      paidAt: invoices.paidAt,
      metadata: invoices.metadata,
      merchantId: invoices.merchantId,
      allowedOrigins: merchants.allowedOrigins,
    })
    .from(invoices)
    .innerJoin(merchants, eq(merchants.id, invoices.merchantId))
    .where(eq(invoices.id, id))
    .limit(1);
  if (rows.length === 0) return NextResponse.json({ error: "not_found" }, { status: 404 });
  const inv = rows[0]!;

  // Determine if the caller is the owning merchant (authenticated).
  const apiKeyHeader = req.headers.get("x-api-key") ?? "";
  let isAuthed = false;
  if (apiKeyHeader) {
    try {
      const merchant = await lookupMerchantByApiKey(apiKeyHeader);
      if (merchant && merchant.id === inv.merchantId) {
        isAuthed = true;
      }
    } catch {
      // Lookup failure → treat as unauthenticated; safe default.
    }
  }

  const publicResponse = {
    id: inv.id,
    status: inv.status,
    payInToken: inv.payInToken,
    payoutToken: inv.payoutToken,
    amountOut: inv.amountOut,
    expiresAt: inv.expiresAt.toISOString(),
    allowedOrigins: inv.allowedOrigins ?? [],
  };

  if (!isAuthed) {
    return NextResponse.json(publicResponse);
  }

  // Authenticated merchant: return full record.
  return NextResponse.json({
    ...publicResponse,
    metadata: inv.metadata,
    paidBy: inv.paidBy,
    paidTx: inv.paidTx,
    paidAt: inv.paidAt?.toISOString() ?? null,
  });
}
