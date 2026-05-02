"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Card, CardContent } from "@/components/ui/card";
import { abbreviateAddress, formatRelativeTime } from "@/lib/ui/format";

interface OwnScreen {
  risk: "low" | "medium" | "high" | "sanctions";
  decision: "allow" | "review" | "reject";
  provider: string;
  createdAt: string;
}

interface ReviewRow {
  id: string;
  address: string;
  invoiceId: string;
  ticketId: string | null;
  risk: "medium" | "high" | "low" | "sanctions";
  decision: "review";
  createdAt: string;
  invoiceAmountOut: string;
  invoicePayoutToken: string;
  invoiceStatus: string;
}

interface ComplianceData {
  merchant: { address: string; payoutToken: string } | null;
  ownScreen: OwnScreen | null;
  reviewQueue: ReviewRow[];
}

export default function CompliancePage() {
  const [data, setData] = useState<ComplianceData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch("/api/merchant/compliance")
      .then((r) => r.json())
      .then(setData)
      .finally(() => setLoading(false));
  }, []);

  if (loading) {
    return (
      <main className="px-6 py-10 max-w-5xl mx-auto">
        <div className="h-8 w-40 rounded bg-arcora-gray animate-pulse" />
      </main>
    );
  }

  if (!data?.merchant) {
    return (
      <main className="px-6 py-10 max-w-5xl mx-auto space-y-6">
        <h1 className="font-[family-name:var(--font-display)] text-[36px]">Compliance</h1>
        <p className="text-muted-foreground">
          Set up a merchant profile in <Link href="/m/settings" className="text-arcora-link underline">Settings</Link> first.
        </p>
      </main>
    );
  }

  const own = data.ownScreen;
  const queue = data.reviewQueue;

  return (
    <main className="px-6 py-10 max-w-5xl mx-auto space-y-8">
      <div>
        <h1 className="font-[family-name:var(--font-display)] text-[36px]">Compliance</h1>
        <p className="text-muted-foreground mt-1 text-sm">
          Wallet screening status for your account and any held customer payments. Rejects flow through Arcora support — no self-service override.
        </p>
      </div>

      <section className="space-y-2">
        <h2 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">Your account</h2>
        <Card>
          <CardContent className="py-5 flex items-center justify-between">
            <div>
              <div className="text-xs text-muted-foreground">Payout address</div>
              <div className="font-mono text-sm">{abbreviateAddress(data.merchant.address)}</div>
            </div>
            <div className="text-right">
              {own ? (
                <>
                  <RiskPill risk={own.risk} />
                  <div className="text-[11px] text-muted-foreground mt-1">
                    {own.provider} · {formatRelativeTime(own.createdAt)}
                  </div>
                </>
              ) : (
                <span className="text-xs text-muted-foreground">Not yet screened</span>
              )}
            </div>
          </CardContent>
        </Card>
        {own?.decision === "reject" && (
          <p className="text-xs text-red-700">
            Your payout address has been blocked. Contact <a className="underline" href="mailto:compliance@arcora.dev">compliance@arcora.dev</a> to resolve.
          </p>
        )}
      </section>

      <section className="space-y-2">
        <h2 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">
          Customer reviews ({queue.length})
        </h2>
        {queue.length === 0 ? (
          <p className="text-sm text-muted-foreground">No customer payments are currently held for review.</p>
        ) : (
          <Card>
            <CardContent className="py-0">
              <table className="w-full text-sm">
                <thead className="text-[11px] uppercase tracking-wider text-muted-foreground border-b border-arcora-border">
                  <tr>
                    <th className="text-left py-3 px-4">Wallet</th>
                    <th className="text-left py-3 px-4">Invoice</th>
                    <th className="text-left py-3 px-4">Ticket</th>
                    <th className="text-left py-3 px-4">Held</th>
                  </tr>
                </thead>
                <tbody>
                  {queue.map((row) => (
                    <tr key={row.id} className="border-b border-arcora-border last:border-0">
                      <td className="py-3 px-4 font-mono">{abbreviateAddress(row.address)}</td>
                      <td className="py-3 px-4 font-mono text-xs">
                        <Link href={`/i/${row.invoiceId}` as any} className="text-arcora-link hover:underline">
                          {row.invoiceId.slice(0, 10)}…
                        </Link>
                      </td>
                      <td className="py-3 px-4 font-mono text-xs">{row.ticketId ?? "—"}</td>
                      <td className="py-3 px-4 text-xs text-muted-foreground">
                        {formatRelativeTime(row.createdAt)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </CardContent>
          </Card>
        )}
      </section>
    </main>
  );
}

function RiskPill({ risk }: { risk: OwnScreen["risk"] }) {
  const cls =
    risk === "low" ? "bg-emerald-50 text-emerald-700 border-emerald-200"
    : risk === "medium" ? "bg-amber-50 text-amber-800 border-amber-200"
    : "bg-red-50 text-red-700 border-red-200";
  return (
    <span className={`inline-block px-2 py-0.5 rounded-full border text-[10px] uppercase tracking-wider font-semibold ${cls}`}>
      {risk}
    </span>
  );
}
