"use client";

import { useEffect, useState } from "react";

/**
 * Loops a simulated, label-honest replay of the v0.8 pay flow on Arc Testnet.
 * Quote rate is illustrative (real testnet RFQ rates from App Kit Swap drift
 * 0.80–0.92 USD/EUR; the live demo /checkout-demo uses the actual quote
 * endpoint). Three scenarios cycle: same-token USDC→USDC, swap EURC→USDC,
 * swap USDC→EURC. Each walks Quote → Sign → Settled.
 */

type Phase = "quote" | "pay" | "settled";

interface Scenario {
  id: string;          // visible "merchantInvoiceId" — short
  payIn: "USDC" | "EURC";
  payout: "USDC" | "EURC";
  amountOutMicro: number; // 6-dec base units
}

const SCENARIOS: Scenario[] = [
  { id: "INV-1024", payIn: "USDC", payout: "USDC", amountOutMicro: 1_000_000 },
  { id: "INV-1025", payIn: "EURC", payout: "USDC", amountOutMicro: 1_000_000 },
  { id: "INV-1026", payIn: "USDC", payout: "EURC", amountOutMicro: 1_000_000 },
];

const ORACLE = 1.0863;        // illustrative EUR/USD rate; real swap quotes come from App Kit RFQ
const POOL_FEE_BPS = 2;       // App Kit provider fee on every swap (0.02%)
const PROTOCOL_FEE_BPS = 30;  // Arcora gateway fee (deducted from merchant payout)
const GATEWAY_ADDR = "0xdf6233…ea21"; // ArcFXGatewayV9 on Arc Testnet (Plan 9 — refund-source binding)

function calcAmountIn(s: Scenario): number {
  // Same-token: customer pays exactly amountOut (no swap).
  if (s.payIn === s.payout) return s.amountOutMicro;
  // EURC→USDC: customer needs (amountOut / rate) EURC, plus pool fee.
  if (s.payIn === "EURC" && s.payout === "USDC") {
    return Math.ceil((s.amountOutMicro / ORACLE) / (1 - POOL_FEE_BPS / 10_000));
  }
  // USDC→EURC: customer needs (amountOut * rate) USDC, plus pool fee.
  return Math.ceil((s.amountOutMicro * ORACLE) / (1 - POOL_FEE_BPS / 10_000));
}

function calcMerchantPayout(s: Scenario): number {
  return s.amountOutMicro - Math.floor((s.amountOutMicro * PROTOCOL_FEE_BPS) / 10_000);
}

function fmt(microUnits: number): string {
  return (microUnits / 1_000_000).toFixed(6).replace(/\.?0+$/, "");
}

export function LiveSettlement() {
  const [scenarioIdx, setScenarioIdx] = useState(0);
  const [phase, setPhase] = useState<Phase>("quote");
  const [tick, setTick] = useState(0);

  useEffect(() => {
    // Phase progression: quote(1.4s) → pay(1.4s) → settled(2.2s) → next scenario
    const sched: Array<[Phase, number]> = [
      ["quote",   1400],
      ["pay",     1400],
      ["settled", 2200],
    ];
    let cancelled = false;
    let i = 0;
    function step() {
      if (cancelled) return;
      const [p, ms] = sched[i]!;
      setPhase(p);
      setTick(t => t + 1);
      setTimeout(() => {
        i = (i + 1) % sched.length;
        if (i === 0) setScenarioIdx(s => (s + 1) % SCENARIOS.length);
        step();
      }, ms);
    }
    step();
    return () => { cancelled = true; };
  }, []);

  const s          = SCENARIOS[scenarioIdx]!;
  const sameToken  = s.payIn === s.payout;
  const amountIn   = calcAmountIn(s);
  const payout     = calcMerchantPayout(s);
  const fee        = s.amountOutMicro - payout;

  return (
    <div className="rounded-[20px] border border-arcora-border bg-white shadow-[0_1px_0_rgba(255,255,255,0.6)_inset,0_20px_40px_-24px_rgba(11,20,38,0.12)] overflow-hidden">
      {/* Header */}
      <div className="px-4 sm:px-6 py-3 sm:py-4 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-1.5 sm:gap-3 border-b border-arcora-border bg-arcora-gray/30">
        <div className="flex items-center gap-3 min-w-0">
          <span className="relative flex size-2 shrink-0">
            <span className="absolute inline-flex h-full w-full rounded-full bg-arcora-teal opacity-75 animate-ping" />
            <span className="relative inline-flex rounded-full size-2 bg-arcora-teal" />
          </span>
          <span className="font-[family-name:var(--font-mono)] text-[10px] sm:text-[11px] tracking-[0.18em] uppercase text-muted-foreground truncate">
            <span className="sm:hidden">Live · Arc testnet</span>
            <span className="hidden sm:inline">Live · Arc testnet · Gateway {GATEWAY_ADDR}</span>
          </span>
        </div>
        <span className="font-[family-name:var(--font-mono)] text-[10px] sm:text-[11px] text-muted-foreground tabular-nums whitespace-nowrap">
          oracle 1 EUR = {ORACLE.toFixed(4)} USD
        </span>
      </div>

      {/* Body */}
      <div className="grid grid-cols-1 md:grid-cols-[1fr_auto_1fr] items-stretch">
        {/* Customer side */}
        <Side
          role="CUSTOMER"
          token={s.payIn}
          amountMicro={amountIn}
          highlight={phase === "quote" || phase === "pay"}
          dim={phase === "settled"}
          subline={phase === "quote" ? "Quote ready" : phase === "pay" ? "Approving + paying…" : "Tx confirmed"}
        />

        {/* Middle column — gateway + flow */}
        <div className="flex flex-col items-center justify-between border-y md:border-y-0 md:border-x border-arcora-border bg-arcora-gray/20 py-6 md:py-7 px-5 gap-3 md:min-w-[260px]">
          <div className="text-center">
            <div className="font-[family-name:var(--font-mono)] text-[10px] tracking-[0.18em] uppercase text-muted-foreground">
              {sameToken ? "Same-token · No swap" : "Swap via App Kit · Permit2 settle"}
            </div>
            <div className="mt-1 font-[family-name:var(--font-display)] font-semibold text-arcora-slate text-lg">
              ArcFXGateway
            </div>
          </div>

          {/* Flow line with moving dot */}
          <div className="relative w-full h-[2px] bg-arcora-border my-2">
            <span
              key={`${scenarioIdx}-${phase}-${tick}`}
              className="absolute top-1/2 -translate-y-1/2 w-2 h-2 rounded-full bg-arcora-blue shadow-[0_0_10px_rgba(37,99,255,0.55)]"
              style={{
                animation: phase === "settled" ? "none" : "flow-dot 2.6s ease-in-out infinite",
                left: phase === "settled" ? "calc(100% - 4px)" : undefined,
              }}
            />
          </div>

          {/* Cost breakdown */}
          <div className="w-full text-[11px] font-[family-name:var(--font-mono)] tabular-nums text-muted-foreground space-y-1">
            <div className="flex justify-between">
              <span>amountIn</span>
              <span className="text-arcora-slate">{fmt(amountIn)} {s.payIn}</span>
            </div>
            {!sameToken && (
              <div className="flex justify-between">
                <span>swap fee · {POOL_FEE_BPS} bps</span>
                <span className="text-arcora-slate">— pool</span>
              </div>
            )}
            <div className="flex justify-between">
              <span>protocol fee · {PROTOCOL_FEE_BPS} bps</span>
              <span className="text-arcora-slate">{fmt(fee)} {s.payout}</span>
            </div>
          </div>
        </div>

        {/* Merchant side */}
        <Side
          role="MERCHANT"
          token={s.payout}
          amountMicro={payout}
          highlight={phase === "settled"}
          dim={phase !== "settled"}
          subline={phase === "settled" ? "✓ Settled · webhook fired" : phase === "pay" ? "Awaiting confirmation…" : "Pending"}
          align="right"
        />
      </div>

      {/* Footer scenario strip */}
      <div className="px-4 sm:px-6 py-3 border-t border-arcora-border flex items-center justify-between gap-3 bg-arcora-gray/20">
        <div className="flex items-center gap-2 sm:gap-3 min-w-0">
          <span className="font-[family-name:var(--font-mono)] text-[10px] sm:text-[11px] text-muted-foreground tracking-wider truncate">
            invoice <span className="text-arcora-slate">{s.id}</span>
          </span>
          <span className="text-arcora-border">·</span>
          <span className="font-[family-name:var(--font-mono)] text-[10px] sm:text-[11px] text-muted-foreground whitespace-nowrap">
            <span className="uppercase tracking-wider">{s.payIn} → {s.payout}</span>
          </span>
        </div>
        <div className="flex gap-1 shrink-0">
          {SCENARIOS.map((_, i) => (
            <span
              key={i}
              className={`w-6 h-[3px] rounded-full transition-colors ${
                i === scenarioIdx ? "bg-arcora-blue" : "bg-arcora-border"
              }`}
            />
          ))}
        </div>
      </div>

      <style>{`
        @keyframes flow-dot {
          0%   { left: 0;            opacity: 0; }
          20%  { opacity: 1; }
          80%  { opacity: 1; }
          100% { left: calc(100% - 4px); opacity: 0; }
        }
      `}</style>
    </div>
  );
}

function Side({
  role, token, amountMicro, highlight, dim, subline, align,
}: {
  role: "CUSTOMER" | "MERCHANT";
  token: "USDC" | "EURC";
  amountMicro: number;
  highlight: boolean;
  dim: boolean;
  subline: string;
  align?: "right";
}) {
  return (
    <div
      className={`px-5 sm:px-7 py-6 sm:py-7 flex flex-col gap-2 transition-opacity duration-500 ${
        dim ? "opacity-55" : "opacity-100"
      } ${align === "right" ? "md:items-end md:text-right" : ""}`}
    >
      <div className="font-[family-name:var(--font-mono)] text-[10px] tracking-[0.18em] uppercase text-muted-foreground">
        {role}
      </div>
      <div className="flex items-baseline gap-2 flex-wrap">
        <span className="font-[family-name:var(--font-display)] text-2xl sm:text-3xl font-semibold tabular-nums text-arcora-slate">
          {(amountMicro / 1_000_000).toFixed(6).replace(/\.?0+$/, "")}
        </span>
        <span
          className={`font-[family-name:var(--font-mono)] text-xs tracking-wider px-2 py-0.5 rounded-full ${
            highlight
              ? "bg-arcora-blue text-white"
              : "bg-arcora-gray text-arcora-slate"
          }`}
        >
          {token}
        </span>
      </div>
      <div className="text-xs text-muted-foreground">{subline}</div>
    </div>
  );
}
