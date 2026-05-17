import { notFound } from "next/navigation";
import { db } from "@/lib/db/client";
import { invoices, merchants } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { InvoiceCard } from "@/components/checkout/InvoiceCard";
import CheckoutClient from "./CheckoutClient";

export default async function CheckoutPage({ params }: { params: Promise<{ invoiceId: string }> }) {
  const { invoiceId } = await params;
  const rows = await db
    .select({
      id: invoices.id,
      status: invoices.status,
      payInToken: invoices.payInToken,
      amountOut: invoices.amountOut,
      expiresAt: invoices.expiresAt,
      successUrl: invoices.successUrl,
      cancelUrl: invoices.cancelUrl,
      paidBy: invoices.paidBy,
      paidTx: invoices.paidTx,
      payoutToken: invoices.payoutToken,
      metadata: invoices.metadata,
      merchantAddress: merchants.address,
      // Audit H1 (2026-05-05): server-rendered checkout passes the merchant's
      // current allowlist into the client so the SuccessScreen can re-check
      // before window.location.href = successUrl. The list is intentionally
      // not a secret — it's an allowlist of acceptable redirect targets.
      merchantAllowedOrigins: merchants.allowedOrigins,
    })
    .from(invoices)
    .innerJoin(merchants, eq(merchants.id, invoices.merchantId))
    .where(eq(invoices.id, invoiceId))
    .limit(1);

  if (rows.length === 0) notFound();
  const inv = rows[0]!;
  const expired = inv.expiresAt.getTime() < Date.now();
  const initialStatus = expired && inv.status === "created" ? "expired" : inv.status;

  return (
    <main className="min-h-screen grid place-items-center px-6 py-10">
      <div className="w-full max-w-md space-y-6">
        <InvoiceCard
          amountOut={inv.amountOut}
          payoutTokenAddress={inv.payoutToken}
          payInTokenAddress={inv.payInToken}
          status={initialStatus as "created" | "paid" | "expired" | "failed"}
        />
        <CheckoutClient
          invoiceId={inv.id}
          initialStatus={initialStatus as "created" | "paid" | "expired" | "failed"}
          payInTokenAddress={inv.payInToken}
          payoutTokenAddress={inv.payoutToken}
          amountOut={inv.amountOut}
          successUrl={inv.successUrl}
          cancelUrl={inv.cancelUrl ?? undefined}
          allowedOrigins={inv.merchantAllowedOrigins ?? []}
        />
      </div>
    </main>
  );
}
