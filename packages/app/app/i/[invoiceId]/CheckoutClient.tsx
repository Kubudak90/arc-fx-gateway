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
  initialStatus: "created" | "paid" | "expired";
  payInTokenAddress: string;
  payoutTokenAddress: string;
  amountOut: string;
  successUrl: string;
  cancelUrl?: string;
}

export default function CheckoutClient(props: CheckoutClientProps) {
  const [status, setStatus] = useState(props.initialStatus);
  const [amountIn, setAmountIn] = useState<bigint | null>(null);
  const [showQR, setShowQR] = useState(false);

  useEffect(() => {
    if (status !== "created") return;
    const t = setInterval(async () => {
      const res = await fetch(`/api/invoices/${props.invoiceId}`);
      const data = await res.json();
      if (data.status === "paid") setStatus("paid");
      else if (data.status === "expired") setStatus("expired");
    }, 3000);
    return () => clearInterval(t);
  }, [status, props.invoiceId]);

  if (status === "paid") return <SuccessScreen successUrl={props.successUrl} />;
  if (status === "expired") return <ExpiredScreen cancelUrl={props.cancelUrl} />;

  if (showQR) {
    return <MobileWalletQR url={typeof window !== "undefined" ? window.location.href : ""} onBack={() => setShowQR(false)} />;
  }

  return (
    <div className="space-y-4">
      <QuoteDisplay
        payInTokenAddress={props.payInTokenAddress}
        payoutTokenAddress={props.payoutTokenAddress}
        amountOut={props.amountOut}
        onQuote={setAmountIn}
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
          amountIn={amountIn}
          onPaid={() => setStatus("paid")}
        />

        <button
          onClick={() => setShowQR(true)}
          className="w-full inline-flex items-center justify-center gap-2 text-sm text-arcora-link hover:underline py-2"
        >
          <Smartphone className="size-4" /> Pay with mobile wallet
        </button>
      </div>

      {props.cancelUrl && (
        <div className="text-center pt-2">
          <a href={props.cancelUrl} className="text-sm text-muted-foreground hover:underline">Cancel</a>
        </div>
      )}
    </div>
  );
}
