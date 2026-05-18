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
    <main className="min-h-screen bg-[#f4f4f4] py-0">
      {/* Topbar */}
      <header className="h-14 px-6 flex items-center justify-between bg-white border-b border-arcora-border">
        <div className="flex items-center gap-2 font-semibold text-[15px] tracking-tight text-arcora-slate">
          <span className="font-[family-name:var(--font-display)]">Arcora</span>
        </div>
        <div className="hidden sm:flex items-center gap-3 font-[family-name:var(--font-mono)] text-[11px] text-arcora-muted-fg tracking-[0.1em] uppercase">
          <span className="inline-block size-[5px] rounded-full bg-emerald-500 shadow-[0_0_0_3px_rgba(16,185,129,0.18)]" />
          <span>Secure checkout</span>
          <span className="opacity-40">·</span>
          <span>Permit2 / EIP-712</span>
        </div>
        <div className="text-[13px] text-arcora-muted-fg">Need help?</div>
      </header>

      {/* Two-column grid */}
      <div className="max-w-5xl mx-auto grid md:grid-cols-2 min-h-[calc(100vh-56px)]">
        {/* Left column — invoice summary */}
        <div className="bg-white border-r border-arcora-border p-10 md:p-14 flex flex-col gap-8">
          <InvoiceCard
            amountOut={inv.amountOut}
            payoutTokenAddress={inv.payoutToken}
            payInTokenAddress={inv.payInToken}
            status={initialStatus as "created" | "paid" | "expired" | "failed"}
            invoiceId={inv.id}
            expiresAt={inv.expiresAt}
            merchantAddress={inv.merchantAddress}
            metadata={inv.metadata}
          />
        </div>

        {/* Right column — quote + sign */}
        <div className="bg-[#f4f4f4] p-10 md:p-14 flex flex-col gap-6">
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
      </div>
    </main>
  );
}
