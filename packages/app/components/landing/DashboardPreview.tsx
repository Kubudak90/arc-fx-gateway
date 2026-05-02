"use client";

/**
 * Marketing-side preview of the merchant dashboard. The chart shape and the
 * activity rows are deliberate placeholders — Arc testnet's real numbers are
 * tiny, and showing $5 of lifetime volume next to "Treasury that reads like a
 * P&L" would undersell the product. The footer disclaimer makes the
 * illustrative status explicit and points the reader at the actual live
 * dashboard at /m/treasury.
 */

const CHART = [10, 18, 14, 22, 30, 26, 38, 34, 44, 52, 48, 60, 56, 68, 74, 70, 82, 88, 84, 96];

const SETTLEMENTS = [
  { id: "0xa9..3f1",  amt: "+$840.00",   ccy: "USDC", t: "14s" },
  { id: "0x47..b22",  amt: "+€1,240.50", ccy: "EURC", t: "1m"  },
  { id: "0xd0..7e8",  amt: "+$92.00",    ccy: "USDC", t: "3m"  },
  { id: "0x12..a90",  amt: "+$2,100.00", ccy: "USDC", t: "8m"  },
  { id: "0x88..c41",  amt: "−$48.00",    ccy: "USDC", t: "12m" },
  { id: "0x6b..029",  amt: "+€312.00",   ccy: "EURC", t: "21m" },
];

export function DashboardPreview() {
  const max = Math.max(...CHART);
  const points = CHART.map((p, i) => ({
    x: (i / (CHART.length - 1)) * 400,
    y: 160 - (p / max) * 140,
  }));
  const linePath = "M " + points.map(p => `${p.x},${p.y}`).join(" L ");
  const areaPath = `${linePath} L 400,160 L 0,160 Z`;
  const last = points[points.length - 1]!;

  return (
    <div className="rounded-[20px] border border-arcora-border bg-white shadow-[0_1px_0_rgba(255,255,255,0.6)_inset,0_20px_40px_-24px_rgba(11,20,38,0.12)] overflow-hidden">
      <div className="grid grid-cols-1 lg:grid-cols-[1.4fr_1fr] gap-0">
        {/* Chart */}
        <div className="p-5 sm:p-7 border-b lg:border-b-0 lg:border-r border-arcora-border">
          <div className="flex items-baseline justify-between gap-3 flex-wrap">
            <div>
              <div className="font-[family-name:var(--font-mono)] text-[10px] tracking-[0.18em] uppercase text-muted-foreground">
                Volume · last 30d
              </div>
              <div className="mt-2 font-[family-name:var(--font-display)] text-3xl sm:text-4xl font-semibold tabular-nums text-arcora-slate">
                $1,284,309<span className="text-muted-foreground text-lg sm:text-xl ml-0.5">.42</span>
              </div>
              <div className="mt-1 font-[family-name:var(--font-mono)] text-xs text-arcora-teal">
                +24.1% vs prev period
              </div>
            </div>
            <div className="flex gap-1 shrink-0">
              {["1d", "7d", "30d", "All"].map((p, i) => (
                <span
                  key={p}
                  className={`font-[family-name:var(--font-mono)] text-[11px] px-2 py-1 rounded-md border ${
                    i === 2
                      ? "bg-arcora-slate text-white border-arcora-slate"
                      : "bg-transparent text-muted-foreground border-arcora-border"
                  }`}
                >
                  {p}
                </span>
              ))}
            </div>
          </div>

          <svg viewBox="0 0 400 160" preserveAspectRatio="none" className="w-full h-[160px] mt-5">
            <defs>
              <linearGradient id="dash-area" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%"   stopColor="#00c2a8" stopOpacity="0.32" />
                <stop offset="100%" stopColor="#00c2a8" stopOpacity="0" />
              </linearGradient>
            </defs>
            {Array.from({ length: 4 }).map((_, i) => (
              <line key={i} x1="0" y1={40 * (i + 1)} x2="400" y2={40 * (i + 1)}
                stroke="rgba(11,20,38,0.06)" strokeWidth="0.5" />
            ))}
            <path d={areaPath}  fill="url(#dash-area)" />
            <path d={linePath}  fill="none" stroke="#00c2a8" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
            <circle cx={last.x} cy={last.y} r="4" fill="#00c2a8" />
            <circle cx={last.x} cy={last.y} r="8" fill="#00c2a8" opacity="0.25" />
          </svg>
        </div>

        {/* Mini ledger */}
        <div className="p-5 sm:p-7 flex flex-col">
          <div className="flex items-center justify-between mb-3">
            <span className="font-[family-name:var(--font-mono)] text-[10px] tracking-[0.18em] uppercase text-muted-foreground">
              Recent settlements
            </span>
            <span className="inline-flex items-center gap-1.5 font-[family-name:var(--font-mono)] text-[10px] tracking-wider uppercase text-muted-foreground">
              <span className="size-1.5 rounded-full bg-arcora-teal" />
              Live
            </span>
          </div>
          <ul className="space-y-1 flex-1">
            {SETTLEMENTS.map((s, i) => {
              const isNeg = s.amt.startsWith("−");
              return (
                <li
                  key={s.id}
                  className={`grid grid-cols-[1fr_auto_auto_auto] items-center gap-3 px-2.5 py-2 rounded-lg text-[13px] ${
                    i === 0 ? "bg-arcora-teal/10" : ""
                  }`}
                >
                  <span className="font-[family-name:var(--font-mono)] text-muted-foreground">{s.id}</span>
                  <span className={`font-[family-name:var(--font-mono)] tabular-nums text-right ${
                    isNeg ? "text-muted-foreground" : "text-arcora-slate"
                  }`}>
                    {s.amt}
                  </span>
                  <span className="text-[10px] tracking-wider px-1.5 py-0.5 rounded font-[family-name:var(--font-mono)] uppercase bg-arcora-gray text-muted-foreground">
                    {s.ccy}
                  </span>
                  <span className="font-[family-name:var(--font-mono)] text-[11px] text-muted-foreground tabular-nums">
                    {s.t} ago
                  </span>
                </li>
              );
            })}
          </ul>
        </div>
      </div>
    </div>
  );
}
