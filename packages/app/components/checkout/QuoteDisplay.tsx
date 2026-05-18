"use client";

import { useEffect, useRef, useState } from "react";
import { formatTokenAmount, symbolForAddress } from "@/lib/ui/format";
import { RefreshCw } from "lucide-react";

interface QuoteResponse {
  /** Recommended payIn (decimal string) — what the customer commits. */
  amountIn?:        string;
  /** Estimated payout (decimal string) — what the merchant receives. */
  estimatedOutput?: string;
  fees?:            { token: string; amount: string; type: string }[];
  ttlSeconds:       number;
  error?:           string;
}

interface QuoteDisplayProps {
  payInTokenAddress:  string;
  payoutTokenAddress: string;
  /** Invoice's amountOut, base units of payoutToken — the floor we settle to. */
  amountOut:          string;
  /** Both bigints in base units; PayButton needs payInAmount to sign. */
  onQuote:            (estimatedOut: bigint, payInAmount: bigint) => void;
  onStale:            () => void;
}

export function QuoteDisplay(props: QuoteDisplayProps) {
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
      // Audit #31: previously fell back to "EURC" for any unknown token,
      // which silently quoted the wrong asset. Reject explicitly so a
      // misconfigured env or a future third stable surfaces as an error
      // rather than a corrupted quote.
      const usdcAddr = (process.env.NEXT_PUBLIC_USDC_ADDRESS ?? "").toLowerCase();
      const eurcAddr = (process.env.NEXT_PUBLIC_EURC_ADDRESS ?? "").toLowerCase();
      const symbolFor = (a: string): "USDC" | "EURC" => {
        const low = a.toLowerCase();
        if (low === usdcAddr) return "USDC";
        if (low === eurcAddr) return "EURC";
        throw new Error(`unsupported token ${a}`);
      };
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
      const data: QuoteResponse = await res.json();
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
    <div className={`bg-white border ${stale ? "border-arcora-blue" : "border-arcora-border"}`}>
      {/* Quote card header */}
      <div className="flex items-center justify-between px-5 py-3.5 border-b border-arcora-border">
        <div className="flex items-center gap-2">
          <span className={`inline-block size-[6px] rounded-full ${stale ? "bg-amber-400" : "bg-emerald-500 shadow-[0_0_0_3px_rgba(16,185,129,0.18)]"}`} />
          <span className="text-[12px] font-medium text-arcora-slate">
            {sameToken ? "Direct payment" : "Live quote · App Kit Swap RFQ"}
          </span>
        </div>
        {sameToken && (
          <span className="font-[family-name:var(--font-mono)] text-[10px] font-semibold tracking-[0.08em] uppercase text-emerald-700 border border-emerald-200 bg-emerald-50 px-2 py-[2px]">
            No swap
          </span>
        )}
        {stale && (
          <button
            type="button"
            onClick={() => void fetchQuote()}
            disabled={loading}
            className="flex items-center gap-1.5 font-[family-name:var(--font-mono)] text-[11px] font-medium text-arcora-blue hover:underline disabled:opacity-50"
          >
            <RefreshCw className="size-3" /> Refresh
          </button>
        )}
      </div>

      {/* Quote body — two-column with arrow */}
      <div className="p-5">
        <div className="grid grid-cols-[1fr_32px_1fr] items-center gap-3">
          {/* You pay */}
          <div>
            <div className="eyebrow mb-2">You pay</div>
            {loading && !payInAmount ? (
              <div className="h-8 w-28 bg-arcora-gray animate-pulse" />
            ) : (
              <div className="font-[family-name:var(--font-display)] font-light text-[32px] leading-[1] tracking-[-0.02em] text-arcora-slate">
                {payInAmount ? formatTokenAmount(payInAmount) : "—"}
                <span className="text-[14px] text-arcora-muted-fg font-normal ml-1.5 tracking-[0.02em]">
                  {payInSym}
                </span>
              </div>
            )}
          </div>

          {/* Arrow */}
          <div className="flex items-center justify-center size-8 border border-arcora-border text-arcora-muted-fg text-[15px] self-end mb-1">
            →
          </div>

          {/* Merchant receives */}
          <div className="text-right">
            <div className="eyebrow mb-2">Merchant receives</div>
            {loading && !estimateOut ? (
              <div className="h-8 w-28 bg-arcora-gray animate-pulse ml-auto" />
            ) : error ? (
              <div className="text-[13px] text-red-600">{error}</div>
            ) : (
              <div className="font-[family-name:var(--font-display)] font-light text-[32px] leading-[1] tracking-[-0.02em] text-arcora-slate">
                {estimateOut ? formatTokenAmount(estimateOut) : "—"}
                <span className="text-[14px] text-arcora-muted-fg font-normal ml-1.5 tracking-[0.02em]">
                  {payoutSym}
                </span>
              </div>
            )}
          </div>
        </div>

        {/* Rate footer */}
        {!sameToken && !loading && !error && payInAmount && estimateOut && (
          <div className="flex items-center justify-between mt-4 pt-4 border-t border-arcora-border font-[family-name:var(--font-mono)] text-[11px] text-arcora-muted-fg">
            <span>
              Rate{" "}
              <span className="text-arcora-slate">
                1 {payInSym} = {(Number(estimateOut) / Number(payInAmount)).toFixed(4)} {payoutSym}
              </span>
            </span>
            {stale ? (
              <span className="text-amber-600 font-semibold tracking-[0.06em] uppercase">QUOTE STALE</span>
            ) : (
              <span className="bg-arcora-blue/10 text-arcora-blue font-semibold tracking-[0.04em] uppercase px-2 py-[2px]">
                FIXED
              </span>
            )}
          </div>
        )}
      </div>
    </div>
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
