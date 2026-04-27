"use client";

import { useEffect, useState } from "react";
import { ApiKeyCard } from "@/components/merchant/ApiKeyCard";
import { WebhookSettingsCard } from "@/components/merchant/WebhookSettingsCard";
import { DelegateAuthCard } from "@/components/merchant/DelegateAuthCard";

interface MerchantInfo { address: string; payoutToken: string; webhookUrl: string | null; }

export default function SettingsPage() {
  const [merchant, setMerchant] = useState<MerchantInfo | null>(null);
  const [serverWallet, setServerWallet] = useState<string | null>(null);

  async function refresh() {
    const res = await fetch("/api/merchant");
    const data = await res.json();
    setMerchant(data.merchant);
    setServerWallet(process.env.NEXT_PUBLIC_SERVER_WALLET_ADDRESS ?? null);
  }
  useEffect(() => { void refresh(); }, []);

  return (
    <main className="px-6 py-10 max-w-3xl mx-auto space-y-6">
      <h1 className="font-[family-name:var(--font-display)] text-[36px]">Settings</h1>
      <ApiKeyCard hasMerchant={!!merchant} onBootstrap={refresh} />
      {merchant && <WebhookSettingsCard initialUrl={merchant.webhookUrl} />}
      <DelegateAuthCard serverWalletAddress={serverWallet} />
    </main>
  );
}
