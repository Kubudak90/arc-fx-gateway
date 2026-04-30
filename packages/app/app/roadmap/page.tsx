import Link from "next/link";
import { ArcoraLogo } from "@/components/brand/Logo";
import { CrosschainRouteDiagram } from "@/components/landing/CrosschainRouteDiagram";

type Phase = "shipped" | "next" | "later";
const ITEMS: Array<{ tag: string; phase: Phase; title: string; body: string }> = [
  {
    tag: "v1.0",
    phase: "shipped",
    title: "Arc-only USDC ⇄ EURC checkout",
    body: "Hosted checkout, merchant dashboard, SIWE auth, refunds, treasury view, npm SDK. Live now on Arc testnet.",
  },
  {
    tag: "v1.x",
    phase: "next",
    title: "Any stablecoin on Arc",
    body: "USDT, PYUSD, DAI and regional fiat-pegged tokens behind a generic single-pool AMM and token registry. Architecture spec drafted.",
  },
  {
    tag: "v2.0",
    phase: "next",
    title: "Crosschain checkout via CCTP",
    body: "Customer pays USDC from any CCTP-supported EVM chain — Ethereum, Arbitrum, Base, Optimism, Polygon, Avalanche, Linea, Codex.",
  },
  {
    tag: "v2.1",
    phase: "later",
    title: "Pay with any token",
    body: "Source-side DEX aggregator (Odos / 1inch) so the customer can pay in native ETH or any ERC-20 — Arcora handles the swap before bridging.",
  },
  {
    tag: "v2.2",
    phase: "later",
    title: "Solana, Sui, beyond EVM",
    body: "Same checkout shape, non-EVM wallet stack — Phantom, Jupiter, native bridges.",
  },
  {
    tag: "v3.0",
    phase: "later",
    title: "One-signature intents",
    body: "User signs a single intent; an Arcora solver executes the full route. The Stripe-like UX endgame.",
  },
];

export default function RoadmapPage() {
  return (
    <main className="min-h-screen flex flex-col">
      <header className="px-6 py-5 flex items-center justify-between border-b border-arcora-border">
        <Link href="/" className="flex items-center">
          <ArcoraLogo size={28} />
        </Link>
        <nav className="flex items-center gap-4 text-sm">
          <Link href="/" className="text-muted-foreground hover:text-foreground">Home</Link>
          <Link href="/#how-it-works" className="text-muted-foreground hover:text-foreground">How it works</Link>
          <a href="/m/login" className="text-arcora-link hover:underline">Merchants</a>
          <a href="https://github.com/Kubudak90/arc-fx-gateway" className="text-muted-foreground hover:text-foreground">GitHub</a>
        </nav>
      </header>

      {/* Page hero */}
      <section className="px-6 pt-16 pb-10">
        <div className="max-w-5xl mx-auto">
          <p className="text-sm tracking-[0.2em] uppercase text-arcora-teal font-semibold">Roadmap</p>
          <h1 className="mt-3 font-[family-name:var(--font-display)] text-[48px] leading-[1.05] tracking-tight text-arcora-slate max-w-3xl">
            Outward, signature by signature.
          </h1>
          <p className="mt-5 text-lg text-muted-foreground max-w-2xl">
            v1 settles USDC and EURC on Arc today. Each subsequent release moves the customer-side
            surface outward — more stables, more chains, fewer signatures — without rewriting the
            stack underneath.
          </p>
        </div>
      </section>

      {/* Roadmap rows */}
      <section className="px-6 pb-12">
        <div className="max-w-5xl mx-auto border-t border-arcora-border">
          {ITEMS.map(item => (
            <div
              key={item.tag}
              className="grid grid-cols-1 md:grid-cols-[120px_120px_1fr] gap-4 md:gap-8 py-7 border-b border-arcora-border items-baseline"
            >
              <span className="font-[family-name:var(--font-mono)] text-arcora-slate text-lg tabular-nums">
                {item.tag}
              </span>
              <span>
                <PhaseBadge phase={item.phase} />
              </span>
              <div>
                <h3 className="font-[family-name:var(--font-display)] text-xl font-semibold text-arcora-slate tracking-tight">
                  {item.title}
                </h3>
                <p className="mt-1.5 text-muted-foreground max-w-2xl leading-relaxed">
                  {item.body}
                </p>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* v2.0 deep-dive: crosschain diagram */}
      <section className="px-6 pb-20 pt-8 bg-arcora-gray/30 border-y border-arcora-border">
        <div className="max-w-5xl mx-auto py-14">
          <div className="flex items-baseline gap-3 mb-6">
            <span className="font-[family-name:var(--font-mono)] text-arcora-slate text-base tabular-nums">v2.0</span>
            <PhaseBadge phase="next" />
            <span className="font-[family-name:var(--font-mono)] text-[10px] tracking-[0.18em] uppercase text-muted-foreground ml-auto">
              In design · No code yet
            </span>
          </div>
          <h2 className="font-[family-name:var(--font-display)] text-[36px] leading-tight tracking-tight text-arcora-slate max-w-2xl">
            Customer pays from anywhere. Merchant settles on Arc.
          </h2>
          <p className="mt-4 text-muted-foreground max-w-2xl">
            v2.0 wires CCTP into the gateway: a customer with USDC on Ethereum, Arbitrum, Base,
            Optimism, Polygon, or any other CCTP-supported chain pays as if they were already on
            Arc. Arcora burns on the source, mints on Arc, runs the merchant&apos;s preferred swap,
            and emits the same <code className="font-[family-name:var(--font-mono)] text-arcora-slate">InvoicePaid</code> event the v1 indexer already understands.
          </p>

          <div className="mt-10 rounded-[20px] border border-arcora-border bg-white p-8">
            <div className="flex items-center justify-between mb-3">
              <span className="font-[family-name:var(--font-mono)] text-[11px] tracking-[0.18em] uppercase text-muted-foreground">
                Source chain · Customer wallet
              </span>
              <span className="font-[family-name:var(--font-mono)] text-[11px] tracking-[0.18em] uppercase text-muted-foreground">
                Settlement on Arc
              </span>
            </div>
            <CrosschainRouteDiagram />
          </div>

          <ul className="mt-10 grid md:grid-cols-3 gap-4">
            <DetailCard
              eyebrow="Bridge"
              title="CCTP V2"
              body="Native USDC across the Circle bridge — no synthetic, no wrapped. Fast Transfer where the source chain supports it (~13s)."
            />
            <DetailCard
              eyebrow="Swap"
              title="Arc-side AMM"
              body="Once USDC lands on Arc, the same OracleAMM that powers v1 swaps to the merchant's preferred stable."
            />
            <DetailCard
              eyebrow="Relayer"
              title="Arcora pays Arc gas"
              body="Customer signs only on the source chain. Arc settlement is sponsored by an Arcora relayer; gas is folded into the route quote."
            />
          </ul>
        </div>
      </section>

      {/* v1.x — any stablecoin */}
      <section className="px-6 py-16 border-b border-arcora-border">
        <div className="max-w-5xl mx-auto grid md:grid-cols-[1fr_1.2fr] gap-12 items-start">
          <div>
            <div className="flex items-baseline gap-3 mb-4">
              <span className="font-[family-name:var(--font-mono)] text-arcora-slate text-base tabular-nums">v1.x</span>
              <PhaseBadge phase="next" />
            </div>
            <h2 className="font-[family-name:var(--font-display)] text-[32px] leading-tight tracking-tight text-arcora-slate">
              Any stablecoin on Arc.
            </h2>
            <p className="mt-3 text-muted-foreground">
              USDC and EURC ship today. v1.x is the architectural step that opens the gateway to
              USDT, PYUSD, DAI, and regional fiat-pegged tokens — a single registry-driven AMM,
              one entry per stablecoin, no per-pair contract redeploy.
            </p>
          </div>
          <div className="rounded-2xl border border-arcora-border bg-white p-6">
            <div className="font-[family-name:var(--font-mono)] text-[10px] tracking-[0.18em] uppercase text-muted-foreground mb-3">
              Token registry shape
            </div>
            <ul className="space-y-2 font-[family-name:var(--font-mono)] text-[13px]">
              {[
                { sym: "USDC",  rate: "1.0000", state: "live" },
                { sym: "EURC",  rate: "1.0863", state: "live" },
                { sym: "USDT",  rate: "1.0001", state: "v1.x" },
                { sym: "PYUSD", rate: "1.0000", state: "v1.x" },
                { sym: "DAI",   rate: "1.0003", state: "v1.x" },
                { sym: "TRYC",  rate: "0.0291", state: "later" },
              ].map(t => (
                <li key={t.sym} className="flex items-center justify-between border-b border-arcora-border/60 pb-1.5 last:border-b-0 last:pb-0">
                  <span className="text-arcora-slate font-semibold">{t.sym}</span>
                  <span className="text-muted-foreground tabular-nums">{t.rate}<span className="text-[10px] tracking-wider ml-1.5 text-muted-foreground">/USD</span></span>
                  <span className={`text-[10px] uppercase tracking-[0.14em] px-2 py-0.5 rounded-full font-semibold ${
                    t.state === "live"
                      ? "bg-emerald-50 text-emerald-700 border border-emerald-200"
                      : t.state === "v1.x"
                        ? "bg-arcora-blue/10 text-arcora-blue border border-arcora-blue/30"
                        : "bg-arcora-gray text-muted-foreground border border-arcora-border"
                  }`}>{t.state}</span>
                </li>
              ))}
            </ul>
            <p className="mt-4 text-[11px] text-muted-foreground font-[family-name:var(--font-mono)] tracking-wider">
              Rates shown are illustrative — only USDC and EURC have live oracles today.
            </p>
          </div>
        </div>
      </section>

      {/* v3.0 — intents */}
      <section className="px-6 py-16 bg-arcora-slate text-white">
        <div className="max-w-5xl mx-auto">
          <div className="flex items-baseline gap-3 mb-4">
            <span className="font-[family-name:var(--font-mono)] text-white/70 text-base tabular-nums">v3.0</span>
            <span className="text-[10px] uppercase tracking-[0.14em] px-2 py-0.5 rounded-full font-semibold bg-white/10 text-white/70 border border-white/20">
              Endgame
            </span>
          </div>
          <h2 className="font-[family-name:var(--font-display)] text-[36px] leading-tight tracking-tight text-white max-w-2xl">
            One signature. Full route.
          </h2>
          <p className="mt-4 text-white/70 max-w-2xl">
            The customer signs once. An Arcora solver executes the swap on the source chain, the
            CCTP burn, the Arc mint, the destination swap, and the merchant settlement —
            atomically, off the user&apos;s critical path. The Stripe-like UX, on stablecoin rails.
          </p>
          <div className="mt-8 rounded-2xl bg-white/5 border border-white/10 p-6 max-w-2xl font-[family-name:var(--font-mono)] text-sm space-y-1">
            <div className="text-white/50">User signs:</div>
            <div className="text-white">  intent · maxIn · deadline · recipient</div>
            <div className="text-white/50 mt-3">Arcora solver runs:</div>
            <div className="text-white">  swap → bridge → swap → settle</div>
            <div className="text-white/50 mt-3">Merchant receives:</div>
            <div className="text-arcora-teal">  preferred-stablecoin on Arc · single InvoicePaid event</div>
          </div>
        </div>
      </section>

      {/* CTA */}
      <section className="px-6 py-16">
        <div className="max-w-5xl mx-auto rounded-[24px] border border-arcora-border p-10 md:p-14 bg-gradient-to-br from-arcora-blue/[0.06] via-white to-arcora-teal/[0.05] flex flex-col md:flex-row items-start md:items-center justify-between gap-6">
          <div>
            <h3 className="font-[family-name:var(--font-display)] text-[28px] leading-tight tracking-tight text-arcora-slate max-w-xl">
              Ship a checkout this afternoon. Settle by morning.
            </h3>
            <p className="mt-2 text-muted-foreground">Arc testnet is open. v1 is live; v2 is in design.</p>
          </div>
          <div className="flex gap-3 shrink-0">
            <a href="https://arc-fx-demo.vercel.app" target="_blank" rel="noopener noreferrer" className="btn-arcora-pill">
              Try the demo
            </a>
            <a href="https://github.com/Kubudak90/arc-fx-gateway" target="_blank" rel="noopener noreferrer" className="btn-arcora-pill-light">
              GitHub
            </a>
          </div>
        </div>
      </section>

      <footer className="border-t border-arcora-border px-6 py-6 text-xs text-muted-foreground flex items-center justify-between">
        <Link href="/"><ArcoraLogo size={20} /></Link>
        <span>Arcora · Arc testnet · Roadmap</span>
      </footer>
    </main>
  );
}

function PhaseBadge({ phase }: { phase: Phase }) {
  const map: Record<Phase, { label: string; className: string }> = {
    shipped: { label: "Live",    className: "bg-emerald-50 text-emerald-700 border-emerald-200" },
    next:    { label: "Next",    className: "bg-arcora-blue/10 text-arcora-blue border-arcora-blue/30" },
    later:   { label: "Planned", className: "bg-arcora-gray text-muted-foreground border-arcora-border" },
  };
  const { label, className } = map[phase];
  return (
    <span className={`text-[10px] font-semibold tracking-[0.14em] uppercase border px-2 py-0.5 rounded-full inline-block ${className}`}>
      {label}
    </span>
  );
}

function DetailCard({ eyebrow, title, body }: { eyebrow: string; title: string; body: string }) {
  return (
    <li className="rounded-2xl border border-arcora-border bg-white p-5">
      <div className="font-[family-name:var(--font-mono)] text-[10px] tracking-[0.18em] uppercase text-arcora-teal font-semibold">
        {eyebrow}
      </div>
      <h4 className="mt-2 font-[family-name:var(--font-display)] text-lg font-semibold text-arcora-slate">{title}</h4>
      <p className="mt-2 text-sm text-muted-foreground leading-relaxed">{body}</p>
    </li>
  );
}
