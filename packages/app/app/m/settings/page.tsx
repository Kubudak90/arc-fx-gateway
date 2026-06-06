"use client";

import { useEffect, useState } from "react";
import { ApiKeyCard } from "@/components/merchant/ApiKeyCard";
import { WebhookSettingsCard } from "@/components/merchant/WebhookSettingsCard";
import { AllowedOriginsCard } from "@/components/merchant/AllowedOriginsCard";
import { DelegateAuthCard } from "@/components/merchant/DelegateAuthCard";
import { PayoutTokenCard } from "@/components/merchant/PayoutTokenCard";

interface MerchantInfo {
  address: string;
  payoutToken: string;
  webhookUrl: string | null;
  allowedOrigins?: string[];
  publishableKey?: string;
}

export default function SettingsPage() {
  const [merchant, setMerchant] = useState<MerchantInfo | null>(null);
  const [serverWallet, setServerWallet] = useState<string | null>(null);
  const [fetchError, setFetchError] = useState<string | null>(null);

  async function refresh() {
    setFetchError(null);
    try {
      const res = await fetch("/api/merchant");
      if (!res.ok) {
        setFetchError(res.status === 401 ? "auth_expired" : `fetch_failed_${res.status}`);
        return;
      }
      const data = await res.json();
      setMerchant(data.merchant);
      setServerWallet(process.env.NEXT_PUBLIC_SERVER_WALLET_ADDRESS ?? null);
    } catch {
      setFetchError("network");
    }
  }
  useEffect(() => { void refresh(); }, []);

  return (
    <main className="px-6 py-10 max-w-3xl mx-auto space-y-6">
      <h1 className="font-[family-name:var(--font-display)] text-[36px]">Settings</h1>
      {fetchError && (
        <div className="rounded-lg border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900">
          <div className="font-semibold mb-1">Couldn&apos;t load your merchant profile</div>
          {fetchError === "auth_expired"
            ? <>Your session has expired. <a href="/m/login" className="underline">Sign in again</a>.</>
            : <>Network blip — retry, or check your connection.</>}
          {fetchError !== "auth_expired" && (
            <button
              type="button"
              onClick={() => void refresh()}
              className="mt-3 inline-flex px-3 py-1.5 rounded border border-amber-400 bg-amber-100 hover:bg-amber-200 font-semibold text-xs"
            >
              Retry
            </button>
          )}
        </div>
      )}
      <ApiKeyCard hasMerchant={!!merchant} publishableKey={merchant?.publishableKey} onBootstrap={refresh} />
      {merchant && (
        <PayoutTokenCard
          currentPayoutToken={merchant.payoutToken}
          onUpdated={refresh}
        />
      )}
      {merchant && <AllowedOriginsCard initialOrigins={merchant.allowedOrigins ?? []} />}
      {merchant && <WebhookSettingsCard initialUrl={merchant.webhookUrl} />}
      <DelegateAuthCard serverWalletAddress={serverWallet} />
    </main>
  );
}
