import Link from "next/link";
import type { Route } from "next";
import { ArcoraLogo } from "@/components/brand/Logo";
import { LiveSettlement } from "@/components/landing/LiveSettlement";
import { DashboardPreview } from "@/components/landing/DashboardPreview";
import { SDKBlock } from "@/components/landing/SDKBlock";
import { CrosschainRouteDiagram } from "@/components/landing/CrosschainRouteDiagram";
import { SiteFooter } from "@/components/landing/SiteFooter";

const PILLARS = [
  { label: "SECURE", body: "Settlement runs through audited Arc primitives. No custody, no off-chain credit; funds either land in the merchant's wallet or refund to the payer." },
  { label: "FAST",   body: "One signature, no transaction for the customer. Live FX from Arc's App Kit Swap — Circle's RFQ-backed maker network — settles sub-30s." },
  { label: "GLOBAL", body: "Stablecoin-native rails. Accept USDC or EURC anywhere, settle in the stablecoin you choose. Crosschain reach via App Kit Bridge on the roadmap." },
] as const;

const STEPS = [
  {
    n: "01",
    title: "Merchant creates an invoice",
    body: "Three-line SDK call or one click in the dashboard. Set the amount, the stablecoin you want to receive, and the success URL — Arcora returns a hosted checkout link.",
    code: `await Arcora.createInvoice({\n  amountUsdc: 49.99,\n  payInToken: "EURC",\n  successUrl: "...",\n});`,
  },
  {
    n: "02",
    title: "Customer signs once",
    body: "The customer opens the link, connects their wallet, sees a live FX quote, and signs a single Permit2 EIP-712 message. No gas, no on-chain transaction on their side.",
    code: `wallet.signTypedData(permit2Msg);`,
  },
  {
    n: "03",
    title: "Arcora settles in seconds",
    body: "Arcora's relayer pulls the funds via Permit2, runs the FX swap on Arc's App Kit, and delivers the merchant's preferred stablecoin — minus the protocol fee. Webhook fires once the indexer sees InvoicePaid.",
    code: `→ kit.swap(USDC → EURC)\n→ gateway.settleInvoice\n→ webhook invoice.paid`,
  },
] as const;

type Phase = "shipped" | "next" | "later";

const ROADMAP_ITEMS: Array<{ tag: string; phase: Phase; title: string; body: string }> = [
  {
    tag: "v0.8",
    phase: "shipped",
    title: "Permit2 + App Kit Swap",
    body: "Customer-side gas-less Permit2 signature; Arcora relayer drives Circle's App Kit Swap on Arc; deterministic merchant payout. Live on Arc testnet.",
  },
  {
    tag: "v1.0",
    phase: "shipped",
    title: "Hosted checkout & merchant dashboard",
    body: "Invoice creation, hosted checkout page, SIWE auth, refunds, treasury view with 30-day charts, npm SDK, WooCommerce plugin.",
  },
  {
    tag: "v1.x",
    phase: "next",
    title: "Compliance hooks (Elliptic / TRM)",
    body: "Native screening adapters for sanctioned-wallet detection — pre-mainnet bar. Adapter pattern spec'd; rollout staged behind a config flip.",
  },
  {
    tag: "v2.0",
    phase: "next",
    title: "Crosschain checkout via App Kit Bridge",
    body: "Customer pays USDC from any chain App Kit supports — Ethereum, Arbitrum, Base, Optimism, Polygon, Avalanche, Linea — bridged through CCTPv2 to Arc settlement.",
  },
  {
    tag: "v2.1",
    phase: "later",
    title: "Pay with any token",
    body: "Source-side DEX aggregation so customers pay in native ETH or any ERC-20 — Arcora handles the conversion before bridging.",
  },
  {
    tag: "v2.2",
    phase: "later",
    title: "Solana, beyond EVM",
    body: "Same checkout shape, non-EVM wallet stack — App Kit's Solana adapter, Phantom, native CCTP routes.",
  },
  {
    tag: "v3.0",
    phase: "later",
    title: "One-signature intents",
    body: "User signs a single intent; an Arcora solver executes the full route. The Stripe-like UX endgame.",
  },
];

export default function Home() {
  return (
    <main className="min-h-screen flex flex-col">
      <header className="sticky top-0 z-50 backdrop-blur-md bg-white/80 px-4 sm:px-6 py-4 flex items-center justify-between gap-3 border-b border-arcora-border">
        <ArcoraLogo size={28} />
        <nav className="flex items-center gap-3 sm:gap-4 text-sm">
          <a href="#how-it-works" className="hidden md:inline text-muted-foreground hover:text-foreground">How it works</a>
          <a href="#dashboard"    className="hidden lg:inline text-muted-foreground hover:text-foreground">Dashboard</a>
          <a href="#developers"   className="hidden lg:inline text-muted-foreground hover:text-foreground">Developers</a>
          <a href="#roadmap"      className="hidden md:inline text-muted-foreground hover:text-foreground">Roadmap</a>
          <Link href={"/quickstart" as Route} className="hidden md:inline text-muted-foreground hover:text-foreground">Quickstart</Link>
          <a href="/m/login" className="text-arcora-link hover:underline whitespace-nowrap">Merchants</a>
          <a href="https://github.com/Kubudak90/arc-fx-gateway" className="text-muted-foreground hover:text-foreground">GitHub</a>
        </nav>
      </header>

      {/* ── Hero ─────────────────────────────────────────────────────────── */}
      <section className="px-4 sm:px-6 pt-12 sm:pt-20 pb-12">
        <div className="max-w-3xl mx-auto text-center">
          <ArcoraLogo size={72} className="justify-center mb-8" />
          <p className="text-xs sm:text-sm tracking-[0.2em] uppercase text-muted-foreground">
            Stablecoin Checkout &amp; Settlement
          </p>
          <h1 className="mt-6 font-[family-name:var(--font-display)] text-[34px] sm:text-[44px] md:text-[56px] leading-[1.08] tracking-tight text-arcora-slate text-balance">
            Accept, move, and settle stablecoin payments with confidence.
          </h1>
          <p className="mt-6 text-base sm:text-lg text-muted-foreground max-w-2xl mx-auto">
            Arcora gives global businesses a checkout that quotes live FX, settles on-chain in seconds,
            and pays out in the stablecoin you choose. Secure. Compliant. Built for scale.
          </p>
          <div className="mt-10 flex flex-wrap justify-center gap-3">
            <Link href={"/quickstart" as Route} className="btn-arcora-pill">Test in 10 min</Link>
            <a href="/m/login" className="btn-arcora-pill-light">Sign in as merchant</a>
            <a href="https://github.com/Kubudak90/arc-fx-gateway" className="btn-arcora-pill-light">View on GitHub</a>
          </div>
        </div>
      </section>

      {/* ── Live settlement simulator ────────────────────────────────────── */}
      <section className="px-4 sm:px-6 pb-20">
        <div className="max-w-5xl mx-auto">
          <LiveSettlement />
          <p className="mt-4 text-center text-[11px] sm:text-xs text-muted-foreground font-[family-name:var(--font-mono)] tracking-wider px-2">
            Replay of the v0.8 pay-flow on Arc Testnet — quote from Circle&apos;s App Kit Swap, deterministic merchant payout from the deployed gateway. No fictional volumes.
          </p>
        </div>
      </section>

      {/* ── Pillars ──────────────────────────────────────────────────────── */}
      <section className="px-4 sm:px-6 pb-24">
        <div className="max-w-5xl mx-auto grid gap-8 md:grid-cols-3">
          {PILLARS.map(p => (
            <div key={p.label} className="rounded-2xl border border-arcora-border p-6">
              <div className="text-xs font-semibold tracking-[0.18em] text-arcora-teal">{p.label}</div>
              <p className="mt-3 text-arcora-slate leading-relaxed">{p.body}</p>
            </div>
          ))}
        </div>
      </section>

      {/* ── How it works ─────────────────────────────────────────────────── */}
      <section id="how-it-works" className="px-4 sm:px-6 pb-24 scroll-mt-20">
        <div className="max-w-5xl mx-auto">
          <div className="text-center mb-12">
            <p className="text-xs sm:text-sm tracking-[0.2em] uppercase text-arcora-teal font-semibold">How it works</p>
            <h2 className="mt-3 font-[family-name:var(--font-display)] text-[26px] sm:text-[32px] md:text-[36px] leading-tight tracking-tight text-arcora-slate text-balance">
              Three steps from invoice to settlement.
            </h2>
          </div>
          <ol className="grid gap-6 md:grid-cols-3">
            {STEPS.map(step => (
              <li key={step.n} className="rounded-2xl border border-arcora-border p-6 bg-white flex flex-col">
                <div className="font-[family-name:var(--font-mono)] text-xs font-semibold tracking-[0.15em] text-arcora-teal">
                  STEP {step.n}
                </div>
                <h3 className="mt-3 font-semibold text-arcora-slate text-lg">{step.title}</h3>
                <p className="mt-3 text-sm text-muted-foreground leading-relaxed">{step.body}</p>
                <pre className="mt-5 bg-arcora-slate text-arcora-gray rounded-xl px-4 py-3 text-[11px] leading-relaxed overflow-x-auto font-[family-name:var(--font-mono)]">
                  <code>{step.code}</code>
                </pre>
              </li>
            ))}
          </ol>
          <div className="mt-10 flex flex-wrap justify-center gap-3 text-sm">
            <Link href="/checkout-demo" className="btn-arcora-pill">
              Try the checkout demo →
            </Link>
            <a href="https://arc-fx-demo.vercel.app" target="_blank" rel="noopener noreferrer" className="btn-arcora-pill-light">
              Live merchant demo
            </a>
          </div>
          <p className="mt-3 text-center text-xs text-muted-foreground">
            Checkout demo opens in a separate page so you can step through the flow without leaving the marketing context.
          </p>
        </div>
      </section>

      {/* ── Dashboard preview ────────────────────────────────────────────── */}
      <section id="dashboard" className="px-4 sm:px-6 pb-24 scroll-mt-20">
        <div className="max-w-5xl mx-auto">
          <div className="flex items-end justify-between gap-6 flex-wrap mb-8">
            <div className="max-w-xl">
              <p className="font-[family-name:var(--font-mono)] text-[11px] tracking-[0.18em] uppercase text-muted-foreground">Merchant dashboard</p>
              <h2 className="mt-3 font-[family-name:var(--font-display)] text-[28px] sm:text-[34px] md:text-[40px] leading-[1.05] tracking-tight text-arcora-slate text-balance">
                Treasury that reads like a P&amp;L.
              </h2>
              <p className="mt-4 text-muted-foreground leading-relaxed">
                Every payment, every refund, every payout — reconciled to the second.
                Filter by currency, chain, or merchant of record.
              </p>
            </div>
            <a href="/m/dashboard" className="btn-arcora-pill-light">Open dashboard →</a>
          </div>
          <DashboardPreview />
          <p className="mt-3 text-right text-[11px] text-muted-foreground font-[family-name:var(--font-mono)] tracking-wider">
            Illustrative · numbers above are sample shapes. Your real treasury sits at <Link href="/m/treasury" className="text-arcora-link hover:underline">/m/treasury</Link>.
          </p>
        </div>
      </section>

      {/* ── Developer SDK ────────────────────────────────────────────────── */}
      <section id="developers" className="px-4 sm:px-6 pb-24 scroll-mt-20">
        <div className="max-w-5xl mx-auto">
          <SDKBlock />
        </div>
      </section>

      {/* ── Roadmap ──────────────────────────────────────────────────────── */}
      <section id="roadmap" className="px-4 sm:px-6 pb-12 pt-16 bg-arcora-gray/30 border-y border-arcora-border scroll-mt-20">
        <div className="max-w-5xl mx-auto">
          <p className="text-xs sm:text-sm tracking-[0.2em] uppercase text-arcora-teal font-semibold">Roadmap</p>
          <h2 className="mt-3 font-[family-name:var(--font-display)] text-[30px] sm:text-[36px] md:text-[44px] leading-[1.05] tracking-tight text-arcora-slate max-w-3xl text-balance">
            Outward, signature by signature.
          </h2>
          <p className="mt-4 text-muted-foreground max-w-2xl">
            v1 settles USDC and EURC on Arc today. Each subsequent release moves the customer-side
            surface outward — more stables, more chains, fewer signatures — without rewriting the
            stack underneath.
          </p>

          <div className="mt-10 border-t border-arcora-border">
            {ROADMAP_ITEMS.map(item => (
              <div key={item.tag}
                className="grid grid-cols-1 md:grid-cols-[120px_120px_1fr] gap-3 md:gap-8 py-6 md:py-7 border-b border-arcora-border md:items-baseline">
                <div className="flex items-center gap-3 md:contents">
                  <span className="font-[family-name:var(--font-mono)] text-arcora-slate text-base md:text-lg tabular-nums">
                    {item.tag}
                  </span>
                  <span><PhaseBadge phase={item.phase} /></span>
                </div>
                <div>
                  <h3 className="font-[family-name:var(--font-display)] text-lg md:text-xl font-semibold text-arcora-slate tracking-tight">
                    {item.title}
                  </h3>
                  <p className="mt-1.5 text-sm md:text-base text-muted-foreground max-w-2xl leading-relaxed">{item.body}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── v2.0 deep-dive: crosschain diagram ───────────────────────────── */}
      <section className="px-4 sm:px-6 py-16 bg-arcora-gray/30 border-b border-arcora-border">
        <div className="max-w-5xl mx-auto">
          <div className="flex items-baseline gap-3 mb-6 flex-wrap">
            <span className="font-[family-name:var(--font-mono)] text-arcora-slate text-base tabular-nums">v2.0</span>
            <PhaseBadge phase="next" />
            <span className="font-[family-name:var(--font-mono)] text-[10px] tracking-[0.18em] uppercase text-muted-foreground ml-auto">
              In design · No code yet
            </span>
          </div>
          <h3 className="font-[family-name:var(--font-display)] text-[24px] sm:text-[28px] md:text-[32px] leading-tight tracking-tight text-arcora-slate max-w-2xl text-balance">
            Customer pays from anywhere. Merchant settles on Arc.
          </h3>
          <p className="mt-4 text-muted-foreground max-w-2xl">
            v2.0 wires CCTP into the gateway: a customer with USDC on Ethereum, Arbitrum, Base,
            Optimism, Polygon, or any other CCTP-supported chain pays as if they were already on
            Arc. Arcora burns on the source, mints on Arc, runs the merchant&apos;s preferred swap,
            and emits the same <code className="font-[family-name:var(--font-mono)] text-arcora-slate text-[13px]">InvoicePaid</code> event the v1 indexer already understands.
          </p>

          <div className="mt-8 rounded-[20px] border border-arcora-border bg-white p-8">
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
        </div>
      </section>

      {/* ── v1.x token registry ──────────────────────────────────────────── */}
      <section className="px-4 sm:px-6 py-16 border-b border-arcora-border">
        <div className="max-w-5xl mx-auto grid md:grid-cols-[1fr_1.2fr] gap-8 md:gap-12 items-start">
          <div>
            <div className="flex items-baseline gap-3 mb-4">
              <span className="font-[family-name:var(--font-mono)] text-arcora-slate text-base tabular-nums">v1.x</span>
              <PhaseBadge phase="next" />
            </div>
            <h3 className="font-[family-name:var(--font-display)] text-[22px] sm:text-[26px] md:text-[28px] leading-tight tracking-tight text-arcora-slate text-balance">
              Any stablecoin App Kit supports.
            </h3>
            <p className="mt-3 text-muted-foreground">
              USDC and EURC ship today. App Kit Swap on Arc already supports USDT, USDe, DAI,
              and PYUSD; turning each one on inside Arcora is a token-whitelist call on the
              gateway. No per-pair contract redeploy, no AMM to seed — the FX layer is Arc-native.
            </p>
          </div>
          <div className="rounded-2xl border border-arcora-border bg-white p-6">
            <div className="font-[family-name:var(--font-mono)] text-[10px] tracking-[0.18em] uppercase text-muted-foreground mb-3">
              Tokens on Arc
            </div>
            <ul className="space-y-2 font-[family-name:var(--font-mono)] text-[13px]">
              {[
                { sym: "USDC",  rate: "1.0000", state: "live"  },
                { sym: "EURC",  rate: "1.0863", state: "live"  },
                { sym: "USDT",  rate: "1.0001", state: "v1.x"  },
                { sym: "PYUSD", rate: "1.0000", state: "v1.x"  },
                { sym: "DAI",   rate: "1.0003", state: "v1.x"  },
                { sym: "TRYC",  rate: "0.0291", state: "later" },
              ].map(t => (
                <li key={t.sym} className="flex items-center justify-between border-b border-arcora-border/60 pb-1.5 last:border-b-0 last:pb-0">
                  <span className="text-arcora-slate font-semibold">{t.sym}</span>
                  <span className="text-muted-foreground tabular-nums">
                    {t.rate}<span className="text-[10px] tracking-wider ml-1.5 text-muted-foreground">/USD</span>
                  </span>
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

      {/* ── v3.0 endgame ─────────────────────────────────────────────────── */}
      <section className="px-4 sm:px-6 py-16 bg-arcora-slate text-white">
        <div className="max-w-5xl mx-auto">
          <div className="flex items-baseline gap-3 mb-4">
            <span className="font-[family-name:var(--font-mono)] text-white/70 text-base tabular-nums">v3.0</span>
            <span className="text-[10px] uppercase tracking-[0.14em] px-2 py-0.5 rounded-full font-semibold bg-white/10 text-white/70 border border-white/20">
              Endgame
            </span>
          </div>
          <h3 className="font-[family-name:var(--font-display)] text-[24px] sm:text-[28px] md:text-[32px] leading-tight tracking-tight text-white max-w-2xl text-balance">
            One signature. Full route.
          </h3>
          <p className="mt-4 text-white/70 max-w-2xl">
            The customer signs once. An Arcora solver executes the source-chain swap, the
            App Kit Bridge route to Arc, the destination swap, and the merchant settlement —
            off the user&apos;s critical path. The Stripe-like UX, on stablecoin rails.
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

      {/* ── CTA ──────────────────────────────────────────────────────────── */}
      <section className="px-4 sm:px-6 py-16">
        <div className="max-w-5xl mx-auto rounded-[24px] border border-arcora-border p-6 sm:p-10 md:p-14 bg-gradient-to-br from-arcora-blue/[0.06] via-white to-arcora-teal/[0.05] flex flex-col md:flex-row items-start md:items-center justify-between gap-6">
          <div>
            <h3 className="font-[family-name:var(--font-display)] text-[22px] sm:text-[26px] md:text-[28px] leading-tight tracking-tight text-arcora-slate max-w-xl text-balance">
              Ship a checkout this afternoon. Settle by morning.
            </h3>
            <p className="mt-2 text-muted-foreground">Arc testnet is open. v1 is live; v2 is in design.</p>
          </div>
          <div className="flex gap-3 shrink-0 flex-wrap">
            <Link href="/checkout-demo" className="btn-arcora-pill">Try the checkout</Link>
            <a href="https://github.com/Kubudak90/arc-fx-gateway" target="_blank" rel="noopener noreferrer" className="btn-arcora-pill-light">GitHub</a>
          </div>
        </div>
      </section>

      <SiteFooter />
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
