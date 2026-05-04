"use client";

import { useEffect, useRef, useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { formatTokenAmount, symbolForAddress } from "@/lib/ui/format";
import { RefreshCw } from "lucide-react";

interface QuoteV8Response {
  /** Recommended payIn (decimal string) — what the customer commits. */
  amountIn?:        string;
  /** Estimated payout (decimal string) — what the merchant receives. */
  estimatedOutput?: string;
  fees?:            { token: string; amount: string; type: string }[];
  ttlSeconds:       number;
  error?:           string;
}

interface QuoteDisplayV8Props {
  payInTokenAddress:  string;
  payoutTokenAddress: string;
  /** Invoice's amountOut, base units of payoutToken — the floor we settle to. */
  amountOut:          string;
  /** Both bigints in base units; PayButtonV8 needs payInAmount to sign. */
  onQuote:            (estimatedOut: bigint, payInAmount: bigint) => void;
  onStale:            () => void;
}

export function QuoteDisplayV8(props: QuoteDisplayV8Props) {
  const sameToken = props.payInTokenAddress.toLowerCase() === props.payoutTokenAddress.toLowerCase();
  const exactOut  = BigInt(props.amountOut);

  const [estimateOut, setEstimateOut] = useState<bigint | null>(sameToken ? exactOut : null);
  const [payInAmount, setPayInAmount] = useState<bigint | null>(sameToken ? exactOut : null);
  const [stale,   setStale]           = useState(false);
  const [loading, setLoading]         = useState(!sameToken);
  const [error,   setError]           = useState<string | null>(null);
  const fetchedAt = useRef<number>(0);
  const ttlRef    = useRef<number>(30);

  async function fetchQuote() {
    setLoading(true);
    setError(null);
    try {
      const symbolFor = (a: string) =>
        a.toLowerCase() === (process.env.NEXT_PUBLIC_USDC_ADDRESS ?? "").toLowerCase() ? "USDC" : "EURC";
      // targetOutput mode — backend probes the rate, divides, adds slippage
      // buffer. Returns a recommended `amountIn` we lock in for signing.
      const body = {
        payInToken:   symbolFor(props.payInTokenAddress),
        payoutToken:  symbolFor(props.payoutTokenAddress),
        targetOutput: humanizeAmount(BigInt(props.amountOut), 6),
      };
      const res = await fetch("/api/checkout/quote", {
        method:  "POST",
        headers: { "content-type": "application/json" },
        body:    JSON.stringify(body),
      });
      const data: QuoteV8Response = await res.json();
      if (!res.ok || !data.estimatedOutput || !data.amountIn) {
        throw new Error(data.error ?? `quote failed: ${res.status}`);
      }
      const out = parseHumanAmount(data.estimatedOutput, 6);
      const inn = parseHumanAmount(data.amountIn, 6);
      setEstimateOut(out);
      setPayInAmount(inn);
      props.onQuote(out, inn);
      fetchedAt.current = Date.now();
      ttlRef.current = data.ttlSeconds;
      setStale(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : "quote unavailable");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (sameToken) {
      // Direct payment path — payInToken == payoutToken means no swap, no
      // App Kit RFQ. Customer commits exactly amountOut; the relayer's
      // settle path skips kit.swap on the same-token branch. Without this
      // bypass the quote endpoint returns same_token 400 and the UI gets
      // stuck with an estimated output of "same_token".
      props.onQuote(exactOut, exactOut);
      return;
    }
    void fetchQuote();
    const t = setInterval(() => {
      const ageS = (Date.now() - fetchedAt.current) / 1000;
      if (ageS > ttlRef.current && !stale) {
        setStale(true);
        props.onStale();
      }
    }, 1000);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const payInSym  = symbolForAddress(props.payInTokenAddress);
  const payoutSym = symbolForAddress(props.payoutTokenAddress);

  return (
    <Card className={`rounded-2xl ${stale ? "border-arcora-blue" : "border-arcora-border"}`}>
      <CardContent className="p-6 space-y-3">
        <div className="flex items-center justify-between">
          <div className="text-xs uppercase tracking-wider font-semibold text-muted-foreground">You pay</div>
          {sameToken && (
            <span className="text-[10px] uppercase tracking-wider font-semibold text-emerald-600 bg-emerald-50 px-2 py-0.5 rounded-full">
              No swap
            </span>
          )}
        </div>
        {loading && !payInAmount ? (
          <div className="h-8 w-32 rounded bg-arcora-gray animate-pulse" />
        ) : (
          <div className="font-[family-name:var(--font-display)] text-3xl">
            {payInAmount ? formatTokenAmount(payInAmount) : "—"} {payInSym}
          </div>
        )}

        <div className="text-xs uppercase tracking-wider font-semibold text-muted-foreground pt-2">
          Merchant receives (estimated)
        </div>
        {loading && !estimateOut ? (
          <div className="h-8 w-32 rounded bg-arcora-gray animate-pulse" />
        ) : error ? (
          <div className="text-sm text-red-600">{error}</div>
        ) : (
          <div className="font-[family-name:var(--font-display)] text-2xl">
            {estimateOut ? formatTokenAmount(estimateOut) : "—"} {payoutSym}
          </div>
        )}

        {stale && (
          <Button variant="ghost" size="sm" onClick={() => void fetchQuote()} disabled={loading}>
            <RefreshCw className="size-4 mr-2" /> Refresh quote
          </Button>
        )}
      </CardContent>
    </Card>
  );
}

function parseHumanAmount(amount: string, decimals: number): bigint {
  const [wholeStr = "0", fracStr = ""] = amount.split(".");
  const fracPadded = fracStr.padEnd(decimals, "0").slice(0, decimals);
  return BigInt(wholeStr) * 10n ** BigInt(decimals) + BigInt(fracPadded || "0");
}

function humanizeAmount(baseUnits: bigint, decimals: number): string {
  const scale = 10n ** BigInt(decimals);
  const whole = baseUnits / scale;
  const frac  = (baseUnits % scale).toString().padStart(decimals, "0").replace(/0+$/, "");
  return frac.length === 0 ? whole.toString() : `${whole}.${frac}`;
}
