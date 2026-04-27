"use client";

import { useEffect, useRef, useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { formatTokenAmount, symbolForAddress } from "@/lib/ui/format";
import { RefreshCw } from "lucide-react";

interface QuoteResponse { amountOut: string; }

interface QuoteDisplayProps {
  payInTokenAddress: string;
  payoutTokenAddress: string;
  amountOut: string;
  onQuote: (amountIn: bigint) => void;
}

const STALE_MS = 30_000;
const TICK_MS = 5_000;

export function QuoteDisplay(props: QuoteDisplayProps) {
  const [amountIn, setAmountIn] = useState<bigint | null>(null);
  const [stale, setStale] = useState(false);
  const [loading, setLoading] = useState(true);
  const fetchedAt = useRef<number>(0);

  async function fetchQuote() {
    setLoading(true);
    try {
      const usdcAddr = (process.env.NEXT_PUBLIC_USDC_ADDRESS ?? "").toLowerCase();
      const fromSym = props.payoutTokenAddress.toLowerCase() === usdcAddr ? "USDC" : "EURC";
      const toSym   = props.payInTokenAddress.toLowerCase()  === usdcAddr ? "USDC" : "EURC";
      const url = `/api/quote?from=${fromSym}&to=${toSym}&amountIn=${props.amountOut}`;
      const res = await fetch(url);
      const data: QuoteResponse = await res.json();
      const inv = BigInt(data.amountOut);
      const cushioned = (inv * 101n) / 100n; // +1% safety cushion
      setAmountIn(cushioned);
      props.onQuote(cushioned);
      fetchedAt.current = Date.now();
      setStale(false);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void fetchQuote();
    const t = setInterval(() => {
      if (Date.now() - fetchedAt.current > STALE_MS) setStale(true);
    }, TICK_MS);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const sym = symbolForAddress(props.payInTokenAddress);
  return (
    <Card className={`rounded-2xl ${stale ? "border-cb-blue" : "border-cb-muted-blue"}`}>
      <CardContent className="p-6 space-y-3">
        <div className="text-xs uppercase tracking-wider font-semibold text-muted-foreground">You pay</div>
        {loading && !amountIn ? (
          <div className="h-8 w-32 rounded bg-cb-cool-gray animate-pulse" />
        ) : (
          <div className="font-[family-name:var(--font-display)] text-3xl">
            {amountIn ? formatTokenAmount(amountIn) : "—"} {sym}
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
