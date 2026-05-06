"use client";

import { useEffect, useState } from "react";
import { InvoiceTable, type InvoiceRow } from "@/components/merchant/InvoiceTable";
import { CreateInvoiceDialog } from "@/components/merchant/CreateInvoiceDialog";
import { MerchantV9ActivationCard } from "@/components/merchant/MerchantV9ActivationCard";

interface DashboardData {
  merchant: { address: string; payoutToken: string; webhookUrl: string | null } | null;
  invoices: InvoiceRow[];
}

export default function DashboardPage() {
  const [data, setData] = useState<DashboardData>({ merchant: null, invoices: [] });

  async function refresh() {
    const res = await fetch("/api/merchant");
    const json = await res.json();
    setData({ merchant: json.merchant, invoices: json.invoices });
  }
  useEffect(() => { void refresh(); }, []);

  if (!data.merchant) {
    return (
      <main className="px-6 py-10 max-w-6xl mx-auto space-y-6">
        <h1 className="font-[family-name:var(--font-display)] text-[36px]">Welcome</h1>
        <p className="text-muted-foreground">
          You&apos;re signed in but no merchant profile yet — finish onboarding in <a href="/m/settings" className="text-arcora-link underline">Settings</a>.
        </p>
      </main>
    );
  }

  return (
    <main className="px-6 py-10 max-w-6xl mx-auto space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="font-[family-name:var(--font-display)] text-[36px]">Invoices</h1>
        <CreateInvoiceDialog apiKey={null} onCreated={refresh} />
      </div>
      <MerchantV9ActivationCard
        payoutAddress={data.merchant.address}
        payoutToken={data.merchant.payoutToken}
      />
      <InvoiceTable invoices={data.invoices} payoutToken={data.merchant.payoutToken} onChange={refresh} />
    </main>
  );
}
