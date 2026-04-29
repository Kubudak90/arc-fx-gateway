"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Card, CardContent } from "@/components/ui/card";
import { formatCurrency, formatRelativeTime, symbolForAddress, abbreviateAddress } from "@/lib/ui/format";

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

interface TreasuryData {
  merchant: { address: string; payoutToken: string } | null;
  totals: TokenTotals[];
  activity: ActivityRow[];
}

export default function TreasuryPage() {
  const [data, setData] = useState<TreasuryData>({ merchant: null, totals: [], activity: [] });
  const [loading, setLoading] = useState(true);

  async function refresh() {
    setLoading(true);
    try {
      const res = await fetch("/api/merchant/treasury");
      const json = await res.json();
      setData(json);
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
          {data.totals.map(t => <TokenSection key={t.token} t={t} />)}
        </div>
      )}

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

function TokenSection({ t }: { t: TokenTotals }) {
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
    </section>
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
