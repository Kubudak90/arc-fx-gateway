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
    body: "User signs a single intent; an Arcora solver executes the full route. The one-signature endgame.",
  },
];

export default function Home() {
  return (
    <main className="min-h-screen flex flex-col bg-white">
      {/* ── Navigation ───────────────────────────────────────────────────── */}
      <header className="sticky top-0 z-50 bg-white/92 backdrop-saturate-[140%] backdrop-blur-md px-4 sm:px-8 py-0 flex items-center justify-between gap-3 border-b border-arcora-border" style={{ height: 56 }}>
        <ArcoraLogo size={26} />
        <nav className="flex items-center gap-6 text-[13px] text-arcora-muted-fg">
          <a href="#how-it-works" className="hidden md:inline hover:text-arcora-slate transition-colors">How it works</a>
          <a href="#dashboard"    className="hidden lg:inline hover:text-arcora-slate transition-colors">Dashboard</a>
          <a href="#developers"   className="hidden lg:inline hover:text-arcora-slate transition-colors">Developers</a>
          <a href="#roadmap"      className="hidden md:inline hover:text-arcora-slate transition-colors">Roadmap</a>
          <Link href={"/quickstart" as Route} className="hidden md:inline hover:text-arcora-slate transition-colors">Quickstart</Link>
          <Link href={"/docs" as Route} className="hidden md:inline hover:text-arcora-slate transition-colors">Docs</Link>
          <a href="/m/login" className="text-arcora-link hover:underline whitespace-nowrap">Merchants</a>
          <a href="https://github.com/Kubudak90/arc-fx-gateway" className="hover:text-arcora-slate transition-colors">GitHub</a>
        </nav>
      </header>

      {/* ── Hero ─────────────────────────────────────────────────────────── */}
      <section className="px-4 sm:px-8 pt-24 pb-16 border-b border-arcora-border">
        <div className="max-w-5xl mx-auto">
          <div className="flex items-center gap-3 mb-5">
            <span className="eyebrow">Stablecoin checkout · v1.2 live</span>
            <span className="tag">
              <span className="size-[5px] rounded-full bg-current mr-1 inline-block" />
              Arc testnet
            </span>
          </div>
          <h1 className="font-[family-name:var(--font-display)] font-light text-[52px] sm:text-[64px] md:text-[76px] leading-[1.04] tracking-[-0.025em] text-arcora-slate text-balance max-w-4xl">
            Accept, move, and settle stablecoin payments{" "}
            <em className="not-italic font-medium italic font-[family-name:var(--font-display)] text-arcora-blue">
              with confidence.
            </em>
          </h1>
          <p className="mt-7 text-[17px] text-arcora-muted-fg leading-[1.55] max-w-[480px]">
            Arcora gives global businesses a checkout that quotes live FX, settles on-chain in seconds,
            and pays out in the stablecoin you choose.
          </p>
          <div className="mt-9 flex flex-wrap gap-3">
            <Link href={"/quickstart" as Route} className="btn-arcora-pill">Test in 10 min</Link>
            <a href="/m/login" className="btn-arcora-pill-light">Sign in as merchant</a>
            <a href="https://github.com/Kubudak90/arc-fx-gateway" className="btn-arcora-pill-light">View on GitHub</a>
          </div>

          {/* Honest trust line — real test count, no fabricated logos */}
          <div className="mt-7 flex flex-wrap items-center gap-5 text-[12px] text-arcora-muted-fg font-[family-name:var(--font-mono)] tracking-wider">
            <span>
              <span className="inline-block size-[6px] rounded-full bg-emerald-500 mr-2 shadow-[0_0_0_3px_rgba(16,185,129,0.18)]" />
              v1.2 · Arc testnet
            </span>
            <span>
              <a href="https://github.com/Kubudak90/arc-fx-gateway" target="_blank" rel="noopener noreferrer" className="hover:text-arcora-link transition-colors">338 tests passing</a>
              {" · "}
              <a href="https://github.com/Kubudak90/arc-fx-gateway/blob/HEAD/SECURITY.md" target="_blank" rel="noopener noreferrer" className="hover:text-arcora-link transition-colors">audited</a>
              {" · "}
              <a href="https://github.com/Kubudak90/arc-fx-gateway" target="_blank" rel="noopener noreferrer" className="hover:text-arcora-link transition-colors">open-source</a>
            </span>
            <span>
              <a href="https://arc-fx-demo.vercel.app" target="_blank" rel="noopener noreferrer" className="hover:text-arcora-link transition-colors">live merchant demo →</a>
            </span>
          </div>
        </div>
      </section>

      {/* ── Live settlement simulator ────────────────────────────────────── */}
      <section className="px-4 sm:px-8 py-20 border-b border-arcora-border">
        <div className="max-w-5xl mx-auto">
          <div className="mb-8">
            <p className="eyebrow mb-1">Settlement replay</p>
            <h2 className="font-[family-name:var(--font-display)] font-normal text-[28px] sm:text-[32px] leading-tight tracking-[-0.02em] text-arcora-slate text-balance max-w-lg">
              Real flow. Real math. Arc testnet.
            </h2>
          </div>
          <LiveSettlement />
          <p className="mt-4 text-center text-[11px] text-arcora-muted-fg font-[family-name:var(--font-mono)] tracking-wider px-2">
            Replay of the v0.8 pay-flow on Arc Testnet — quote from Circle&apos;s App Kit Swap, deterministic merchant payout from the deployed gateway. No fictional volumes.
          </p>
        </div>
      </section>

      {/* ── Pillars ──────────────────────────────────────────────────────── */}
      <section className="px-4 sm:px-8 py-20 border-b border-arcora-border">
        <div className="max-w-5xl mx-auto">
          <div className="hairline mb-10" />
          <div className="grid gap-0 md:grid-cols-3 border border-arcora-border">
            {PILLARS.map((p, i) => (
              <div key={p.label} className={`p-8 flex flex-col gap-4 ${i < 2 ? "md:border-r border-b md:border-b-0 border-arcora-border" : "border-b md:border-b-0"}`}>
                <span className="eyebrow text-arcora-teal">{p.label}</span>
                <p className="text-[14px] text-arcora-muted-fg leading-[1.55]">{p.body}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── How it works ─────────────────────────────────────────────────── */}
      <section id="how-it-works" className="px-4 sm:px-8 py-20 border-b border-arcora-border scroll-mt-14">
        <div className="max-w-5xl mx-auto">
          <div className="mb-14">
            <p className="eyebrow text-arcora-teal mb-4">How it works</p>
            <h2 className="font-[family-name:var(--font-display)] font-normal text-[36px] sm:text-[44px] leading-[1.1] tracking-[-0.02em] text-arcora-slate text-balance max-w-[720px]">
              Three steps from invoice to{" "}
              <em className="not-italic italic font-[family-name:var(--font-display)]">settlement.</em>
            </h2>
          </div>

          <ol className="grid gap-0 md:grid-cols-3 border-t border-l border-arcora-border">
            {STEPS.map(step => (
              <li key={step.n} className="border-r border-b border-arcora-border p-8 flex flex-col gap-4 min-h-[320px]">
                <span className="font-[family-name:var(--font-mono)] text-[12px] font-medium text-arcora-blue tracking-[0.08em]">
                  {step.n}
                </span>
                <h3 className="text-[22px] font-medium tracking-[-0.01em] text-arcora-slate leading-snug">{step.title}</h3>
                <p className="text-[14px] text-arcora-muted-fg leading-[1.55] flex-1">{step.body}</p>
                <pre className="bg-arcora-gray border border-arcora-border px-4 py-3 text-[11px] leading-relaxed overflow-x-auto font-[family-name:var(--font-mono)] text-arcora-slate">
                  <code>{step.code}</code>
                </pre>
              </li>
            ))}
          </ol>

          <div className="mt-10 flex flex-wrap gap-3 text-sm">
            <Link href="/checkout-demo" className="btn-arcora-pill">
              Try the checkout demo →
            </Link>
            <a href="https://arc-fx-demo.vercel.app" target="_blank" rel="noopener noreferrer" className="btn-arcora-pill-light">
              Live merchant demo
            </a>
          </div>
          <p className="mt-3 text-[12px] text-arcora-muted-fg font-[family-name:var(--font-mono)]">
            Checkout demo opens in a separate page so you can step through the flow without leaving the marketing context.
          </p>
        </div>
      </section>

      {/* ── Dashboard preview ────────────────────────────────────────────── */}
      <section id="dashboard" className="px-4 sm:px-8 py-20 border-b border-arcora-border scroll-mt-14">
        <div className="max-w-5xl mx-auto">
          <div className="flex items-end justify-between gap-6 flex-wrap mb-12">
            <div className="max-w-xl">
              <p className="eyebrow mb-4">Merchant dashboard</p>
              <h2 className="font-[family-name:var(--font-display)] font-normal text-[36px] sm:text-[44px] leading-[1.05] tracking-[-0.02em] text-arcora-slate text-balance">
                Treasury that reads like a P&amp;L.
              </h2>
              <p className="mt-4 text-[16px] text-arcora-muted-fg leading-[1.55] max-w-[540px]">
                Every payment, every refund, every payout — reconciled to the second.
                Filter by currency, chain, or merchant of record.
              </p>
            </div>
            <a href="/m/dashboard" className="btn-arcora-pill-light shrink-0">Open dashboard →</a>
          </div>
          <DashboardPreview />
          <p className="mt-3 text-right text-[11px] text-arcora-muted-fg font-[family-name:var(--font-mono)] tracking-wider">
            Illustrative · numbers above are sample shapes. Your real treasury sits at <Link href="/m/treasury" className="text-arcora-link hover:underline">/m/treasury</Link>.
          </p>
        </div>
      </section>

      {/* ── Developer SDK ────────────────────────────────────────────────── */}
      <section id="developers" className="px-4 sm:px-8 py-20 border-b border-arcora-border bg-arcora-gray/20 scroll-mt-14">
        <div className="max-w-5xl mx-auto">
          <SDKBlock />
        </div>
      </section>

      {/* ── Roadmap ──────────────────────────────────────────────────────── */}
      <section id="roadmap" className="px-4 sm:px-8 py-20 border-b border-arcora-border scroll-mt-14">
        <div className="max-w-5xl mx-auto">
          <p className="eyebrow text-arcora-teal mb-4">Roadmap</p>
          <h2 className="font-[family-name:var(--font-display)] font-normal text-[36px] sm:text-[44px] leading-[1.05] tracking-[-0.02em] text-arcora-slate text-balance max-w-3xl">
            Outward, signature by signature.
          </h2>
          <p className="mt-4 text-[16px] text-arcora-muted-fg leading-[1.55] max-w-2xl">
            v1 settles USDC and EURC on Arc today. Each subsequent release moves the customer-side
            surface outward — more stables, more chains, fewer signatures — without rewriting the
            stack underneath.
          </p>

          <div className="mt-12 border-t border-arcora-border">
            {ROADMAP_ITEMS.map(item => (
              <div key={item.tag}
                className="grid grid-cols-1 md:grid-cols-[80px_110px_1fr_1fr] gap-3 md:gap-8 py-6 border-b border-arcora-border md:items-baseline">
                <span className="font-[family-name:var(--font-mono)] text-[14px] font-medium text-arcora-slate tabular-nums">
                  {item.tag}
                </span>
                <span><PhaseBadge phase={item.phase} /></span>
                <h3 className="font-medium text-[16px] text-arcora-slate tracking-[-0.01em]">
                  {item.title}
                </h3>
                <p className="text-[13px] text-arcora-muted-fg leading-[1.5]">{item.body}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── v2.0 deep-dive: crosschain diagram ───────────────────────────── */}
      <section className="px-4 sm:px-8 py-20 border-b border-arcora-border bg-arcora-gray/20">
        <div className="max-w-5xl mx-auto">
          <div className="flex items-baseline gap-3 mb-6 flex-wrap">
            <span className="font-[family-name:var(--font-mono)] text-[14px] font-medium text-arcora-slate tabular-nums">v2.0</span>
            <PhaseBadge phase="next" />
            <span className="eyebrow ml-auto">In design · No code yet</span>
          </div>
          <h3 className="font-[family-name:var(--font-display)] font-normal text-[28px] sm:text-[32px] leading-tight tracking-[-0.02em] text-arcora-slate text-balance max-w-2xl">
            Customer pays from anywhere. Merchant settles on Arc.
          </h3>
          <p className="mt-4 text-[16px] text-arcora-muted-fg leading-[1.55] max-w-2xl">
            v2.0 wires CCTP into the gateway: a customer with USDC on Ethereum, Arbitrum, Base,
            Optimism, Polygon, or any other CCTP-supported chain pays as if they were already on
            Arc. Arcora burns on the source, mints on Arc, runs the merchant&apos;s preferred swap,
            and emits the same <code className="font-[family-name:var(--font-mono)] text-arcora-slate text-[13px]">InvoicePaid</code> event the v1 indexer already understands.
          </p>

          <div className="mt-10 border border-arcora-border bg-white p-8">
            <div className="flex items-center justify-between mb-3">
              <span className="eyebrow">Source chain · Customer wallet</span>
              <span className="eyebrow">Settlement on Arc</span>
            </div>
            <CrosschainRouteDiagram />
          </div>
        </div>
      </section>

      {/* ── v1.x token registry ──────────────────────────────────────────── */}
      <section className="px-4 sm:px-8 py-20 border-b border-arcora-border">
        <div className="max-w-5xl mx-auto grid md:grid-cols-[1fr_1.2fr] gap-8 md:gap-16 items-start">
          <div>
            <div className="flex items-baseline gap-3 mb-6">
              <span className="font-[family-name:var(--font-mono)] text-[14px] font-medium text-arcora-slate tabular-nums">v1.x</span>
              <PhaseBadge phase="next" />
            </div>
            <h3 className="font-[family-name:var(--font-display)] font-normal text-[28px] sm:text-[32px] leading-tight tracking-[-0.02em] text-arcora-slate text-balance">
              Any stablecoin App Kit supports.
            </h3>
            <p className="mt-4 text-[16px] text-arcora-muted-fg leading-[1.55]">
              USDC and EURC ship today. App Kit Swap on Arc already supports USDT, USDe, DAI,
              and PYUSD; turning each one on inside Arcora is a token-whitelist call on the
              gateway. No per-pair contract redeploy, no AMM to seed — the FX layer is Arc-native.
            </p>
          </div>
          <div className="border border-arcora-border bg-white p-6">
            <p className="eyebrow mb-4">Tokens on Arc</p>
            <ul className="space-y-0">
              {[
                { sym: "USDC",  rate: "1.0000", state: "live"  },
                { sym: "EURC",  rate: "1.0863", state: "live"  },
                { sym: "USDT",  rate: "1.0001", state: "v1.x"  },
                { sym: "PYUSD", rate: "1.0000", state: "v1.x"  },
                { sym: "DAI",   rate: "1.0003", state: "v1.x"  },
                { sym: "TRYC",  rate: "0.0291", state: "later" },
              ].map(t => (
                <li key={t.sym} className="flex items-center justify-between border-b border-arcora-border py-3 last:border-b-0 font-[family-name:var(--font-mono)] text-[13px]">
                  <span className="text-arcora-slate font-semibold">{t.sym}</span>
                  <span className="text-arcora-muted-fg tabular-nums">
                    {t.rate}<span className="text-[10px] tracking-wider ml-1.5">/USD</span>
                  </span>
                  <span className={`text-[10px] uppercase tracking-[0.14em] px-2 py-0.5 font-semibold border ${
                    t.state === "live"
                      ? "text-emerald-700 border-emerald-200 bg-emerald-50"
                      : t.state === "v1.x"
                        ? "text-arcora-blue border-arcora-blue/30 bg-arcora-blue/10"
                        : "text-arcora-muted-fg border-arcora-border bg-arcora-gray"
                  }`}>{t.state}</span>
                </li>
              ))}
            </ul>
            <p className="mt-4 text-[11px] text-arcora-muted-fg font-[family-name:var(--font-mono)] tracking-wider">
              Rates shown are illustrative — only USDC and EURC have live oracles today.
            </p>
          </div>
        </div>
      </section>

      {/* ── v3.0 endgame ─────────────────────────────────────────────────── */}
      <section className="px-4 sm:px-8 py-24 bg-arcora-slate text-white border-b border-arcora-border">
        <div className="max-w-5xl mx-auto">
          <div className="flex items-baseline gap-3 mb-6">
            <span className="font-[family-name:var(--font-mono)] text-[14px] font-medium text-white/70 tabular-nums">v3.0</span>
            <span className="text-[10px] uppercase tracking-[0.14em] px-2 py-0.5 font-semibold bg-white/10 text-white/70 border border-white/20">
              Endgame
            </span>
          </div>
          <h3 className="font-[family-name:var(--font-display)] font-normal text-[36px] sm:text-[48px] leading-[1.05] tracking-[-0.025em] text-white text-balance max-w-2xl">
            One signature.{" "}
            <em className="not-italic italic font-[family-name:var(--font-display)]">Full route.</em>
          </h3>
          <p className="mt-6 text-[17px] text-white/70 max-w-2xl leading-[1.55]">
            The customer signs once. An Arcora solver executes the source-chain swap, the
            App Kit Bridge route to Arc, the destination swap, and the merchant settlement —
            off the user&apos;s critical path. One signature, full route — checkout-grade UX on stablecoin rails.
          </p>
          <div className="mt-10 border border-white/10 bg-white/5 p-6 max-w-2xl font-[family-name:var(--font-mono)] text-[13px] leading-[1.7] space-y-1">
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
      <section className="px-4 sm:px-8 py-20 border-b border-arcora-border">
        <div className="max-w-5xl mx-auto border border-arcora-border p-8 sm:p-14 bg-gradient-to-br from-arcora-blue/[0.06] via-white to-arcora-teal/[0.05] grid grid-cols-1 md:grid-cols-[1fr_auto] gap-8 items-end">
          <div>
            <p className="eyebrow mb-4">Get started</p>
            <h3 className="font-[family-name:var(--font-display)] font-light text-[36px] sm:text-[44px] leading-[1.05] tracking-[-0.025em] text-arcora-slate text-balance max-w-xl">
              Ship a checkout this afternoon.{" "}
              <em className="not-italic italic font-[family-name:var(--font-display)]">Settle by morning.</em>
            </h3>
            <p className="mt-3 text-[16px] text-arcora-muted-fg">Arc testnet is open. v1 is live; v2 is in design.</p>
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
    shipped: { label: "Live",    className: "text-emerald-700 border-emerald-200" },
    next:    { label: "Next",    className: "text-arcora-blue border-arcora-blue/30" },
    later:   { label: "Planned", className: "text-arcora-muted-fg border-arcora-border" },
  };
  const { label, className } = map[phase];
  return (
    <span className={`font-[family-name:var(--font-mono)] text-[11px] font-semibold tracking-[0.04em] uppercase border px-2 py-[3px] inline-block ${className}`}>
      {label}
    </span>
  );
}
