"use client";

import { useEffect, useState } from "react";
import { ConnectButton } from "thirdweb/react";
import { createThirdwebClient } from "thirdweb";
import { QuoteDisplay } from "@/components/checkout/QuoteDisplay";
import { QuoteDisplayV8 } from "@/components/checkout/QuoteDisplayV8";
import { PayButton } from "@/components/checkout/PayButton";
import { PayButtonV8 } from "@/components/checkout/PayButtonV8";
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
  /** v6 = legacy on-chain swap path; v8 = relayer-driven Permit2 path. */
  engine: "v6" | "v8";
}

export default function CheckoutClient(props: CheckoutClientProps) {
  const [status, setStatus] = useState(props.initialStatus);
  // v6 needs the inverse-quote payIn (USDC required to deliver amountOut).
  // v8 quotes the forward direction: customer commits to a payIn upfront,
  // the relayer's kit.swap converts it; merchant gets >= amountOut or revert.
  const [amountIn, setAmountIn] = useState<bigint | null>(null);
  const [v8Stale, setV8Stale]   = useState(false);
  const [showQR, setShowQR]     = useState(false);

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

  if (status === "paid") return <SuccessScreen successUrl={props.successUrl} />;
  if (status === "expired" || status === "failed") return <ExpiredScreen cancelUrl={props.cancelUrl} />;

  if (showQR) {
    return <MobileWalletQR url={typeof window !== "undefined" ? window.location.href : ""} onBack={() => setShowQR(false)} />;
  }

  // v8 sizing is computed inside QuoteDisplayV8 via the targetOutput mode
  // of /api/checkout/quote (probe the rate, divide, add slippage cushion).
  // The component returns the resolved `payInAmount` through onQuote.

  return (
    <div className="space-y-4">
      {props.engine === "v8" ? (
        <QuoteDisplayV8
          payInTokenAddress={props.payInTokenAddress}
          payoutTokenAddress={props.payoutTokenAddress}
          amountOut={props.amountOut}
          onQuote={(_out, payIn) => { setAmountIn(payIn); setV8Stale(false); }}
          onStale={() => setV8Stale(true)}
        />
      ) : (
        <QuoteDisplay
          payInTokenAddress={props.payInTokenAddress}
          payoutTokenAddress={props.payoutTokenAddress}
          amountOut={props.amountOut}
          onQuote={setAmountIn}
        />
      )}

      <div className="space-y-3">
        <ConnectButton
          client={thirdwebClient}
          connectButton={{ label: "Connect wallet", className: "btn-arcora-pill w-full" }}
          theme="light"
        />

        {props.engine === "v8" ? (
          <PayButtonV8
            invoiceId={props.invoiceId}
            payInTokenAddress={props.payInTokenAddress as Address}
            payInAmount={amountIn}
            quoteStale={v8Stale}
            onPaid={() => setStatus("paid")}
            onFailed={() => setStatus("failed")}
          />
        ) : (
          <PayButton
            invoiceId={props.invoiceId}
            payInTokenAddress={props.payInTokenAddress as Address}
            amountIn={amountIn}
            onPaid={() => setStatus("paid")}
          />
        )}

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
