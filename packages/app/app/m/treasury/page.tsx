"use client";

import { useEffect, useRef, useState } from "react";
import { useTheme } from "next-themes";
import Link from "next/link";
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
  status: "paid" | "refunded" | "claimed" | "recovered";
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
  const [fetchError, setFetchError] = useState<string | null>(null);

  async function refresh() {
    setLoading(true);
    setFetchError(null);
    try {
      const [treasuryRes, escrowRes] = await Promise.all([
        fetch("/api/merchant/treasury"),
        fetch("/api/merchant/escrows"),
      ]);
      if (!treasuryRes.ok) {
        setFetchError(treasuryRes.status === 401 ? "auth_expired" : `fetch_failed_${treasuryRes.status}`);
        return;
      }
      const treasuryJson = await treasuryRes.json();
      setData(treasuryJson);
      if (escrowRes.ok) {
        const escrowJson = await escrowRes.json();
        setEscrows(escrowJson);
      }
    } catch {
      setFetchError("network");
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => { void refresh(); }, []);

  if (loading) {
    return (
      <main className="px-5 py-6 max-w-6xl mx-auto">
        <div className="h-6 w-32 rounded bg-[var(--line)] animate-pulse" />
      </main>
    );
  }

  if (fetchError) {
    return (
      <main className="px-5 py-6 max-w-6xl mx-auto space-y-5">
        <h1 className="font-[family-name:var(--font-display)] text-3xl text-[var(--ink)]">Treasury</h1>
        <div className="border border-amber-300 dark:border-amber-700 bg-amber-50 dark:bg-amber-950/40 p-4 text-sm text-amber-900 dark:text-amber-300">
          <div className="font-semibold mb-1">Couldn&apos;t load treasury</div>
          {fetchError === "auth_expired"
            ? <>Your session has expired. <a href="/m/login" className="underline">Sign in again</a>.</>
            : <>Network blip — retry, or check your connection.</>}
          {fetchError !== "auth_expired" && (
            <button
              type="button"
              onClick={() => void refresh()}
              className="mt-3 inline-flex px-3 py-1.5 border border-amber-400 dark:border-amber-600 bg-amber-100 dark:bg-amber-900/40 hover:bg-amber-200 dark:hover:bg-amber-900/70 font-semibold text-xs transition-colors"
            >
              Retry
            </button>
          )}
        </div>
      </main>
    );
  }

  if (!data.merchant) {
    return (
      <main className="px-5 py-6 max-w-6xl mx-auto space-y-5">
        <h1 className="font-[family-name:var(--font-display)] text-3xl text-[var(--ink)]">Treasury</h1>
        <p className="text-[var(--ink-3)]">
          Set up a merchant profile in <Link href="/m/settings" className="text-[var(--accent)] underline">Settings</Link> to start tracking treasury activity.
        </p>
      </main>
    );
  }

  return (
    <main className="px-5 py-6 max-w-6xl mx-auto space-y-8">
      {/* Page header — Direction B dense style */}
      <div className="flex items-end justify-between border-b border-[var(--line)] pb-4">
        <div>
          <div className="eyebrow mb-2">Treasury · merchant of record</div>
          <h1 className="font-[family-name:var(--font-display)] text-[28px] leading-[1.1] tracking-[-0.025em] text-[var(--ink)]">
            Treasury
          </h1>
          <p className="mono text-[10px] tracking-[0.06em] uppercase text-[var(--ink-3)] mt-1.5">
            Reconciled from on-chain · 30-day window
          </p>
        </div>
      </div>

      {data.totals.length === 0 ? (
        <div className="glass p-10 text-center text-[var(--ink-3)]">
          No paid invoices yet.{" "}
          <Link href="/m/dashboard" className="text-[var(--accent)] underline">Create one</Link>{" "}
          to populate your treasury.
        </div>
      ) : (
        <div className="space-y-8">
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
        <h2 className="eyebrow mb-3">Claim escrows</h2>
        <div className="glass p-4 space-y-4">
          <div className="flex flex-wrap gap-5 mono text-xs text-[var(--ink-3)]">
            <span>
              <span className="text-[var(--ink)] font-semibold">{escrows.counts.pending}</span>&nbsp;pending
              {escrows.counts.pending > 0 && " (within 7-day refund window)"}
            </span>
            <span>
              <span className="text-[var(--ink)] font-semibold">{escrows.counts.matured}</span>&nbsp;matured
              {escrows.counts.matured > 0 && " (ready to claim)"}
            </span>
            <span>
              <span className="text-[var(--ink)] font-semibold">{escrows.counts.claimed}</span>&nbsp;claimed
            </span>
          </div>
          <ClaimAllButton globalIds={escrows.matured.map(e => e.id as `0x${string}`)} />
        </div>
      </section>

      {/* Recent activity — Direction B live-feed style */}
      <section>
        <h2 className="eyebrow mb-3">Recent activity</h2>
        <div className="glass overflow-hidden">
          {data.activity.length === 0 ? (
            <div className="p-10 text-center text-[var(--ink-3)] mono text-xs">
              No settlement activity yet.
            </div>
          ) : (
            <ul>
              {data.activity.map(a => <ActivityItem key={a.id} a={a} />)}
            </ul>
          )}
        </div>
      </section>
    </main>
  );
}

function TokenSection({ t, series }: { t: TokenTotals; series?: TimeSeriesEntry }) {
  const sym = symbolForAddress(t.token);
  const isPositive = BigInt(t.received) >= 0n;
  return (
    <section className="space-y-3">
      {/* Token header */}
      <div className="flex items-center gap-3 border-b border-[var(--line)] pb-2">
        <h2 className="mono text-xs font-semibold tracking-[0.1em] uppercase text-[var(--ink)]">
          {sym}
        </h2>
        <span className="mono text-[10px] text-[var(--ink-3)]">
          {t.paidCount} paid · {t.refundedCount} refunded
        </span>
      </div>

      {/* KPI rail — Direction B grid layout */}
      <div className="grid grid-cols-2 md:grid-cols-4 border border-[var(--line)] divide-x divide-[var(--line)] divide-y md:divide-y-0 bg-[var(--bg-elev-2)]">
        <Kpi label="Net received" value={formatCurrency(t.received, t.token)} hint={isPositive ? "" : "negative — refunds exceed payouts"} />
        <Kpi label="Gross volume" value={formatCurrency(t.grossVolume, t.token)} />
        <Kpi label="Refunded" value={formatCurrency(t.refunded, t.token)} />
        <Kpi label="Fees paid to Arcora" value={formatCurrency(t.feesPaid, t.token)} />
      </div>

      {series && series.days.length > 0 && (
        <div className="glass overflow-hidden">
          <div className="flex items-center justify-between px-4 py-2.5 border-b border-[var(--line)]">
            <span className="eyebrow">Daily net payout · last 30 days</span>
            <span className="mono text-[10px] text-[var(--ink-3)] tabular-nums">
              {sym}
            </span>
          </div>
          <div className="p-4">
            <DailyChart series={series} token={t.token} />
          </div>
        </div>
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

  // Theme-awareness: read resolvedTheme; default to light until mounted to avoid
  // hydration mismatches (resolvedTheme is undefined on the server).
  const { resolvedTheme } = useTheme();
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  const isDark = mounted && resolvedTheme === "dark";

  // SVG color palette — branches on theme
  const accentColor    = "#00c2a8";                              // teal: legible on both
  // Intentional theme-branched value for the zero-baseline dashes
  const baselineStroke = isDark ? "rgba(255,255,255,0.08)" : "rgba(11,20,38,0.06)";
  // Mirror of --ink-3 (SVG attributes can't use CSS custom properties)
  const emptyFill      = isDark ? "#6f6f6f" : "#5b6478";
  // Mirror of --bg-elev-2
  const circleStroke   = isDark ? "#0e0e0e" : "#fff";
  // Intentional theme-branched value for refund-only lines
  const refundColor    = isDark ? "#38bdf8" : "#0284c7";

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
    ? { idx: hoverIdx, point: days[hoverIdx]!, value: values[hoverIdx]! }
    : null;

  return (
    <div className="relative">
      <svg
        ref={svgRef}
        viewBox={`0 0 ${W} ${H}`}
        preserveAspectRatio="none"
        className="w-full h-[140px] cursor-crosshair"
        role="img"
        aria-label={`Daily net payout, last 30 days, ${symbolForAddress(token)}`}
        onMouseMove={handleMove}
        onMouseLeave={() => setHoverIdx(null)}
      >
        <defs>
          <linearGradient id={`treasury-area-${series.token}`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%"   stopColor={accentColor} stopOpacity="0.32" />
            <stop offset="100%" stopColor={accentColor} stopOpacity="0" />
          </linearGradient>
        </defs>
        {/* zero baseline */}
        <line x1={P} y1={zeroY} x2={W - P} y2={zeroY}
              stroke={baselineStroke} strokeWidth="0.5" strokeDasharray="2 4" />
        {!allZero && (
          <>
            {max > 0 && <path d={area} fill={`url(#treasury-area-${series.token})`} />}
            <path d={line} fill="none" stroke={hasRefundOnly ? refundColor : accentColor} strokeWidth="1.5"
                  strokeLinecap="round" strokeLinejoin="round" />
            <circle cx={xFor(lastIdx)} cy={yFor(last)} r="3" fill={hasRefundOnly ? refundColor : accentColor} />
            {hover && (
              <>
                <line x1={xFor(hover.idx)} y1={P} x2={xFor(hover.idx)} y2={H - P}
                      stroke={accentColor} strokeOpacity="0.4" strokeWidth="1" strokeDasharray="2 3" />
                <circle cx={xFor(hover.idx)} cy={yFor(hover.value)} r="4"
                        fill={accentColor} stroke={circleStroke} strokeWidth="1.5" />
              </>
            )}
          </>
        )}
        {allZero && (
          <text x={W / 2} y={H / 2 + 4} textAnchor="middle"
                fontFamily="var(--font-mono)" fontSize="10" fill={emptyFill}>
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
          <div className="bg-[var(--bg-elev-2)] text-[var(--ink)] border border-[var(--line)] rounded px-3 py-2 shadow-lg whitespace-nowrap">
            <div className="mono text-[10px] tracking-wider text-[var(--ink-3)] uppercase">
              {hover.point.day}
            </div>
            <div className="mono text-sm tabular-nums mt-0.5">
              {hover.value >= 0 ? "+" : ""}
              {formatCurrency(BigInt(Math.round(hover.value * 1_000_000)).toString(), token)}
            </div>
            <div className="mono text-[10px] text-[var(--ink-3)] mt-0.5">
              {hover.point.paidCount} paid
              {hover.point.refundedCount > 0 && ` · ${hover.point.refundedCount} refunded`}
            </div>
          </div>
        </div>
      )}

      <div className="flex items-center justify-between mt-2 mono text-[10px] text-[var(--ink-3)] tabular-nums">
        <span>{days[0]!.day}</span>
        <span>{summary}</span>
        <span>{days[days.length - 1]!.day}</span>
      </div>
    </div>
  );
}

function Kpi({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="px-4 py-4 min-h-[88px] relative bg-[var(--bg-elev-2)]">
      <div className="mono text-[9px] tracking-[0.12em] uppercase text-[var(--ink-3)]">
        {label}
      </div>
      <div className="font-[family-name:var(--font-display)] text-[22px] leading-none mt-2 text-[var(--ink)] tracking-[-0.02em]">
        {value}
      </div>
      {hint && (
        <div className="mono text-[9px] text-amber-600 dark:text-amber-400 mt-1.5">
          {hint}
        </div>
      )}
    </div>
  );
}

const STATUS_LABEL: Record<ActivityRow["status"], string> = {
  paid:      "Payment",
  refunded:  "Refund",
  claimed:   "Claimed",
  recovered: "Recovered",
};
const STATUS_COLOR: Record<ActivityRow["status"], string> = {
  paid:      "text-emerald-700 dark:text-emerald-400",
  refunded:  "text-sky-700 dark:text-sky-400",
  claimed:   "text-violet-700 dark:text-violet-400",
  recovered: "text-orange-700 dark:text-orange-400",
};
const SIGN_FOR: Record<ActivityRow["status"], string> = {
  paid:      "+",
  refunded:  "−",
  claimed:   "+",
  recovered: "+",
};

function ActivityItem({ a }: { a: ActivityRow }) {
  const amount = a.merchantPayout ?? a.amountOut;
  const sign = SIGN_FOR[a.status] ?? "+";
  const color = STATUS_COLOR[a.status] ?? "text-emerald-700 dark:text-emerald-400";
  return (
    <li className="grid grid-cols-[72px_1fr_auto] items-center gap-3 px-4 py-2.5 border-b border-[var(--line)] last:border-b-0 hover:bg-[var(--bg-elev)] transition-colors mono text-xs">
      {/* Timestamp / relative time */}
      <span className="text-[var(--ink-3)] text-[10px] tracking-[0.04em] truncate">
        {a.eventAt ? formatRelativeTime(a.eventAt) : "—"}
      </span>

      {/* Description */}
      <div className="min-w-0">
        <div className="flex items-center gap-2">
          <span className={`font-semibold tracking-[0.06em] uppercase text-[9px] ${color}`}>
            {STATUS_LABEL[a.status] ?? a.status}
          </span>
          <span className="text-[var(--ink-3)]">·</span>
          <span className="text-[var(--ink-2)] text-[10px]">
            {symbolForAddress(a.payInToken)} → {symbolForAddress(a.payoutToken)}
          </span>
        </div>
        <div className="text-[var(--ink-3)] text-[10px] mt-0.5 tracking-[0.04em]">
          {abbreviateAddress(a.id)}
          {a.txHash && (
            <> · <a href={`https://testnet.arcscan.app/tx/${a.txHash}`} target="_blank" rel="noopener noreferrer" className="text-[var(--accent)] hover:underline">tx</a></>
          )}
        </div>
      </div>

      {/* Amount */}
      <div className={`text-right tabular-nums font-semibold text-[11px] tracking-[-0.01em] ${color}`}>
        {sign}{formatCurrency(amount, a.payoutToken)}
      </div>
    </li>
  );
}
