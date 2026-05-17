"use client";

import { useEffect, useState } from "react";
import { ConnectButton } from "thirdweb/react";
import { createThirdwebClient } from "thirdweb";
import { QuoteDisplay } from "@/components/checkout/QuoteDisplay";
import { PayButton } from "@/components/checkout/PayButton";
import { SuccessScreen, ExpiredScreen } from "@/components/checkout/StatusScreens";
import { MobileWalletQR } from "@/components/checkout/MobileWalletQR";
import { Smartphone } from "lucide-react";
import type { Address } from "viem";

const thirdwebClient = createThirdwebClient({
  clientId: process.env.NEXT_PUBLIC_THIRDWEB_CLIENT_ID ?? "",
});

interface CheckoutClientProps {
  invoiceId: string;
  initialStatus: "created" | "paid" | "expired" | "failed";
  payInTokenAddress: string;
  payoutTokenAddress: string;
  amountOut: string;
  successUrl: string;
  cancelUrl?: string;
  /** Merchant-declared allowlist of origins that may receive customers post-
   *  payment. Defense-in-depth in the browser; server already enforces the
   *  same list at invoice-create. Audit H1 (2026-05-05). */
  allowedOrigins: readonly string[];
}

export default function CheckoutClient(props: CheckoutClientProps) {
  const [status, setStatus] = useState(props.initialStatus);
  // QuoteDisplay quotes the forward direction: the customer commits to a
  // payIn upfront and the relayer's kit.swap converts it; the merchant gets
  // >= amountOut or the settle reverts. The custody-escrow gateway (V11 today,
  // V10 during the in-flight cutover window) is selected server-side from the
  // invoice's stored gateway address — the checkout UI is gateway-agnostic.
  const [amountIn, setAmountIn]     = useState<bigint | null>(null);
  const [quoteStale, setQuoteStale] = useState(false);
  const [showQR, setShowQR]         = useState(false);

  useEffect(() => {
    if (status !== "created") return;
    const t = setInterval(async () => {
      const res = await fetch(`/api/invoices/${props.invoiceId}`);
      const data = await res.json();
      if (data.status === "paid") setStatus("paid");
      else if (data.status === "expired") setStatus("expired");
      else if (data.status === "failed") setStatus("failed");
    }, 3000);
    return () => clearInterval(t);
  }, [status, props.invoiceId]);

  if (status === "paid") return <SuccessScreen successUrl={props.successUrl} allowedOrigins={props.allowedOrigins} />;
  if (status === "expired" || status === "failed") return <ExpiredScreen cancelUrl={props.cancelUrl} allowedOrigins={props.allowedOrigins} />;

  if (showQR) {
    return <MobileWalletQR url={typeof window !== "undefined" ? window.location.href : ""} onBack={() => setShowQR(false)} />;
  }

  return (
    <div className="space-y-4">
      <QuoteDisplay
        payInTokenAddress={props.payInTokenAddress}
        payoutTokenAddress={props.payoutTokenAddress}
        amountOut={props.amountOut}
        onQuote={(_out, payIn) => { setAmountIn(payIn); setQuoteStale(false); }}
        onStale={() => setQuoteStale(true)}
      />

      <div className="space-y-3">
        <ConnectButton
          client={thirdwebClient}
          connectButton={{ label: "Connect wallet", className: "btn-arcora-pill w-full" }}
          theme="light"
        />

        <PayButton
          invoiceId={props.invoiceId}
          payInTokenAddress={props.payInTokenAddress as Address}
          payInAmount={amountIn}
          quoteStale={quoteStale}
          onPaid={() => setStatus("paid")}
          onFailed={() => setStatus("failed")}
        />

        <button
          type="button"
          onClick={() => setShowQR(true)}
          className="w-full inline-flex items-center justify-center gap-2 text-sm text-arcora-link hover:underline py-2"
        >
          <Smartphone className="size-4" /> Pay with mobile wallet
        </button>
      </div>

      {props.cancelUrl && (() => {
        // Audit H1 (2026-05-05): only render the cancel link when the merchant's
        // allowlist still contains its origin. Stale invoices keep the original
        // cancelUrl, so a merchant who later removes that origin shouldn't see
        // it remain clickable from the live checkout.
        try {
          const origin = new URL(props.cancelUrl).origin;
          if (!props.allowedOrigins.includes(origin)) return null;
        } catch { return null; }
        return (
          <div className="text-center pt-2">
            <a href={props.cancelUrl} className="text-sm text-muted-foreground hover:underline">Cancel</a>
          </div>
        );
      })()}
    </div>
  );
}
