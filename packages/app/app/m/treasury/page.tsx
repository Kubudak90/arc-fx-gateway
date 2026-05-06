"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Card, CardContent } from "@/components/ui/card";
import { formatCurrency, formatRelativeTime, symbolForAddress, abbreviateAddress } from "@/lib/ui/format";
import { ClaimAllButton } from "@/components/treasury/ClaimAllButton";

interface TokenTotals {
  token: string;
  received: string;
  grossVolume: string;
  refunded: string;
  feesPaid: string;
  paidCount: number;
  refundedCount: number;
}

interface ActivityRow {
  id: string;
  payoutToken: string;
  payInToken: string;
  amountOut: string;
  merchantPayout: string | null;
  status: "paid" | "refunded";
  eventAt: string | null;
  txHash: string | null;
}

interface DailyPoint {
  day: string;
  netPayout: string;
  paidCount: number;
  refundedCount: number;
}

interface TimeSeriesEntry {
  token: string;
  days: DailyPoint[];
}

interface TreasuryData {
  merchant: { address: string; payoutToken: string } | null;
  totals: TokenTotals[];
  activity: ActivityRow[];
  timeSeries?: TimeSeriesEntry[];
}

interface EscrowRow {
  id: string;
  status: string;
  claimableAt: string | null;
}

interface EscrowData {
  pending: EscrowRow[];
  matured: EscrowRow[];
  claimed: EscrowRow[];
  counts: { pending: number; matured: number; claimed: number };
}

const EMPTY_ESCROWS: EscrowData = { pending: [], matured: [], claimed: [], counts: { pending: 0, matured: 0, claimed: 0 } };

export default function TreasuryPage() {
  const [data, setData] = useState<TreasuryData>({ merchant: null, totals: [], activity: [] });
  const [escrows, setEscrows] = useState<EscrowData>(EMPTY_ESCROWS);
  const [loading, setLoading] = useState(true);

  async function refresh() {
    setLoading(true);
    try {
      const [treasuryRes, escrowRes] = await Promise.all([
        fetch("/api/merchant/treasury"),
        fetch("/api/merchant/escrows"),
      ]);
      const treasuryJson = await treasuryRes.json();
      setData(treasuryJson);
      if (escrowRes.ok) {
        const escrowJson = await escrowRes.json();
        setEscrows(escrowJson);
      }
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => { void refresh(); }, []);

  if (loading) {
    return (
      <main className="px-6 py-10 max-w-6xl mx-auto">
        <div className="h-8 w-40 rounded bg-arcora-gray animate-pulse" />
      </main>
    );
  }

  if (!data.merchant) {
    return (
      <main className="px-6 py-10 max-w-6xl mx-auto space-y-6">
        <h1 className="font-[family-name:var(--font-display)] text-[36px]">Treasury</h1>
        <p className="text-muted-foreground">
          Set up a merchant profile in <Link href="/m/settings" className="text-arcora-link underline">Settings</Link> to start tracking treasury activity.
        </p>
      </main>
    );
  }

  return (
    <main className="px-6 py-10 max-w-6xl mx-auto space-y-10">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="font-[family-name:var(--font-display)] text-[36px] text-arcora-slate">Treasury</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Cumulative settlement activity across all your invoices.
          </p>
        </div>
      </div>

      {data.totals.length === 0 ? (
        <Card className="rounded-2xl">
          <CardContent className="p-10 text-center text-muted-foreground">
            No paid invoices yet. <Link href="/m/dashboard" className="text-arcora-link underline">Create one</Link> to populate your treasury.
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-10">
          {data.totals.map(t => (
            <TokenSection
              key={t.token}
              t={t}
              series={data.timeSeries?.find(s => s.token === t.token)}
            />
          ))}
        </div>
      )}

      {/* V10 Claim section — escrows pending/matured */}
      <section>
        <h2 className="font-semibold text-arcora-slate mb-4">Claim escrows</h2>
        <Card className="rounded-2xl">
          <CardContent className="p-5 space-y-4">
            <div className="flex flex-wrap gap-6 text-sm text-muted-foreground">
              <span>
                <span className="font-semibold text-arcora-slate">{escrows.counts.pending}</span> pending
                {escrows.counts.pending > 0 && " (within 7-day refund window)"}
              </span>
              <span>
                <span className="font-semibold text-arcora-slate">{escrows.counts.matured}</span> matured
                {escrows.counts.matured > 0 && " (ready to claim)"}
              </span>
              <span>
                <span className="font-semibold text-arcora-slate">{escrows.counts.claimed}</span> claimed
              </span>
            </div>
            <ClaimAllButton globalIds={escrows.matured.map(e => e.id as `0x${string}`)} />
          </CardContent>
        </Card>
      </section>

      <section>
        <h2 className="font-semibold text-arcora-slate mb-4">Recent activity</h2>
        <Card className="rounded-2xl">
          <CardContent className="p-0">
            {data.activity.length === 0 ? (
              <div className="p-10 text-center text-muted-foreground">No settlement activity yet.</div>
            ) : (
              <ul className="divide-y divide-arcora-border">
                {data.activity.map(a => <ActivityItem key={a.id} a={a} />)}
              </ul>
            )}
          </CardContent>
        </Card>
      </section>
    </main>
  );
}

function TokenSection({ t, series }: { t: TokenTotals; series?: TimeSeriesEntry }) {
  const sym = symbolForAddress(t.token);
  const isPositive = BigInt(t.received) >= 0n;
  return (
    <section className="space-y-3">
      <div className="flex items-baseline gap-3">
        <h2 className="font-semibold text-arcora-slate">{sym}</h2>
        <span className="text-xs text-muted-foreground">{t.paidCount} paid · {t.refundedCount} refunded</span>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <Kpi label="Net received" value={formatCurrency(t.received, t.token)} hint={isPositive ? "" : "negative — refunds exceed payouts"} />
        <Kpi label="Gross volume" value={formatCurrency(t.grossVolume, t.token)} />
        <Kpi label="Refunded" value={formatCurrency(t.refunded, t.token)} />
        <Kpi label="Fees paid to Arcora" value={formatCurrency(t.feesPaid, t.token)} />
      </div>
      {series && series.days.length > 0 && (
        <Card className="rounded-2xl">
          <CardContent className="p-5">
            <div className="flex items-baseline justify-between mb-3">
              <span className="font-[family-name:var(--font-mono)] text-[10px] tracking-[0.18em] uppercase text-muted-foreground">
                Daily net payout · last 30 days
              </span>
              <span className="font-[family-name:var(--font-mono)] text-[11px] text-muted-foreground tabular-nums">
                {sym}
              </span>
            </div>
            <DailyChart series={series} token={t.token} />
          </CardContent>
        </Card>
      )}
    </section>
  );
}

function DailyChart({ series, token }: { series: TimeSeriesEntry; token: string }) {
  const days = series.days;
  // Convert micro-units to display units; sign retained for refund-heavy days.
  const values = days.map(d => Number(BigInt(d.netPayout)) / 1_000_000);
  const max = Math.max(0, ...values);
  const min = Math.min(0, ...values);
  const range = max - min || 1;
  // "All zero" means no settled or refunded volume in the window. Refund-only
  // days produce min<0, max=0 — those still draw a downward line below the
  // baseline, so we don't fall into the empty-state copy when refunds happened.
  const allZero = max === 0 && min === 0;
  const hasRefundOnly = max === 0 && min < 0;

  const W = 600, H = 140, P = 6;
  const xFor = (i: number) => P + (i / (days.length - 1)) * (W - 2 * P);
  const yFor = (v: number) => H - P - ((v - min) / range) * (H - 2 * P);
  const zeroY = yFor(0);

  const points = values.map((v, i) => `${xFor(i)},${yFor(v)}`);
  const line   = "M " + points.join(" L ");
  const area   = `${line} L ${xFor(values.length - 1)},${zeroY} L ${xFor(0)},${zeroY} Z`;

  const last = values[values.length - 1] ?? 0;
  const lastIdx = values.length - 1;
  const lastNonZero = values.findLastIndex(v => v !== 0);
  const summary = lastNonZero >= 0
    ? `${days[lastNonZero]!.day} · ${last >= 0 ? "+" : ""}${formatCurrency(BigInt(Math.round(last * 1_000_000)).toString(), token)}`
    : "no activity yet";

  // Hover state: which day index the cursor is over (null = none).
  const [hoverIdx, setHoverIdx] = useState<number | null>(null);
  const svgRef = useRef<SVGSVGElement>(null);

  function handleMove(e: React.MouseEvent<SVGSVGElement>) {
    const svg = svgRef.current;
    if (!svg) return;
    const rect = svg.getBoundingClientRect();
    // Cursor x in viewBox space.
    const xVB = ((e.clientX - rect.left) / rect.width) * W;
    const span = (W - 2 * P) / (days.length - 1);
    const idx = Math.round((xVB - P) / span);
    if (idx >= 0 && idx < days.length) setHoverIdx(idx);
    else setHoverIdx(null);
  }

  const hover = hoverIdx !== null
    ? { idx: hoverIdx, day: days[hoverIdx]!, value: values[hoverIdx]! }
    : null;

  return (
    <div className="relative">
      <svg
        ref={svgRef}
        viewBox={`0 0 ${W} ${H}`}
        preserveAspectRatio="none"
        className="w-full h-[140px] cursor-crosshair"
        onMouseMove={handleMove}
        onMouseLeave={() => setHoverIdx(null)}
      >
        <defs>
          <linearGradient id={`treasury-area-${series.token}`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%"   stopColor="#00c2a8" stopOpacity="0.32" />
            <stop offset="100%" stopColor="#00c2a8" stopOpacity="0" />
          </linearGradient>
        </defs>
        {/* zero baseline */}
        <line x1={P} y1={zeroY} x2={W - P} y2={zeroY}
              stroke="rgba(11,20,38,0.06)" strokeWidth="0.5" strokeDasharray="2 4" />
        {!allZero && (
          <>
            {max > 0 && <path d={area} fill={`url(#treasury-area-${series.token})`} />}
            <path d={line} fill="none" stroke={hasRefundOnly ? "#0284c7" : "#00c2a8"} strokeWidth="1.5"
                  strokeLinecap="round" strokeLinejoin="round" />
            <circle cx={xFor(lastIdx)} cy={yFor(last)} r="3" fill={hasRefundOnly ? "#0284c7" : "#00c2a8"} />
            {hover && (
              <>
                <line x1={xFor(hover.idx)} y1={P} x2={xFor(hover.idx)} y2={H - P}
                      stroke="#00c2a8" strokeOpacity="0.4" strokeWidth="1" strokeDasharray="2 3" />
                <circle cx={xFor(hover.idx)} cy={yFor(hover.value)} r="4"
                        fill="#00c2a8" stroke="#fff" strokeWidth="1.5" />
              </>
            )}
          </>
        )}
        {allZero && (
          <text x={W / 2} y={H / 2 + 4} textAnchor="middle"
                fontFamily="var(--font-mono)" fontSize="10" fill="#5b6478">
            no settlement activity in the last 30 days
          </text>
        )}
      </svg>

      {/* Tooltip — positioned in DOM space rather than SVG so the type rendering
          stays sharp and we don't have to fight viewBox scaling. */}
      {hover && !allZero && (
        <div
          className="absolute pointer-events-none z-10 -translate-x-1/2 -translate-y-full"
          style={{
            left: `${(xFor(hover.idx) / W) * 100}%`,
            top:  `${(yFor(hover.value) / H) * 100}%`,
            marginTop: "-12px",
          }}
        >
          <div className="bg-arcora-slate text-white rounded-lg px-3 py-2 shadow-lg whitespace-nowrap">
            <div className="font-[family-name:var(--font-mono)] text-[10px] tracking-wider text-white/60 uppercase">
              {hover.day.day}
            </div>
            <div className="font-[family-name:var(--font-mono)] text-sm tabular-nums mt-0.5">
              {hover.value >= 0 ? "+" : ""}
              {formatCurrency(BigInt(Math.round(hover.value * 1_000_000)).toString(), token)}
            </div>
            <div className="font-[family-name:var(--font-mono)] text-[10px] text-white/60 mt-0.5">
              {hover.day.paidCount} paid
              {hover.day.refundedCount > 0 && ` · ${hover.day.refundedCount} refunded`}
            </div>
          </div>
        </div>
      )}

      <div className="flex items-center justify-between mt-2 font-[family-name:var(--font-mono)] text-[11px] text-muted-foreground tabular-nums">
        <span>{days[0]!.day}</span>
        <span>{summary}</span>
        <span>{days[days.length - 1]!.day}</span>
      </div>
    </div>
  );
}

function Kpi({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <Card className="rounded-2xl">
      <CardContent className="p-5">
        <div className="text-xs uppercase tracking-wider font-semibold text-muted-foreground">{label}</div>
        <div className="font-[family-name:var(--font-display)] text-2xl mt-2 text-arcora-slate">{value}</div>
        {hint && <div className="text-xs text-amber-600 mt-1">{hint}</div>}
      </CardContent>
    </Card>
  );
}

function ActivityItem({ a }: { a: ActivityRow }) {
  const isRefund = a.status === "refunded";
  const amount = a.merchantPayout ?? a.amountOut;
  const sign = isRefund ? "−" : "+";
  const color = isRefund ? "text-sky-700" : "text-emerald-700";
  return (
    <li className="px-5 py-4 flex items-center gap-4 hover:bg-arcora-gray/40 transition-colors">
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 text-sm">
          <span className={`font-semibold ${isRefund ? "text-sky-700" : "text-emerald-700"}`}>
            {isRefund ? "Refund" : "Payment"}
          </span>
          <span className="text-muted-foreground">·</span>
          <span className="text-muted-foreground">{symbolForAddress(a.payInToken)} → {symbolForAddress(a.payoutToken)}</span>
        </div>
        <div className="font-mono text-xs text-muted-foreground mt-1">
          {abbreviateAddress(a.id)}
        </div>
      </div>
      <div className="text-right shrink-0">
        <div className={`font-[family-name:var(--font-display)] text-lg ${color}`}>
          {sign}{formatCurrency(amount, a.payoutToken)}
        </div>
        <div className="text-xs text-muted-foreground">
          {a.eventAt ? formatRelativeTime(a.eventAt) : ""}
          {a.txHash && (
            <> · <a href={`https://testnet.arcscan.app/tx/${a.txHash}`} target="_blank" rel="noopener noreferrer" className="text-arcora-link hover:underline">tx</a></>
          )}
        </div>
      </div>
    </li>
  );
}
