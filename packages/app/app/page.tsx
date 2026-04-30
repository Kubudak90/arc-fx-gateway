import Link from "next/link";
import { ArcoraLogo } from "@/components/brand/Logo";
import { LiveSettlement } from "@/components/landing/LiveSettlement";

const PILLARS = [
  { label: "SECURE", body: "Funds settle on-chain in a single transaction; no custody, no off-chain credit." },
  { label: "FAST",   body: "Sub-minute checkout from invoice to payout, with live FX from a Chainlink-priced AMM." },
  { label: "GLOBAL", body: "Stablecoin-native rails — accept USDC or EURC anywhere, settle in your chosen currency." },
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
    title: "Customer pays at the checkout",
    body: "The customer opens the link, connects their wallet, sees a live FX quote, and approves + pays. Same-token payments skip the swap entirely.",
    code: `pay(invoiceId, maxAmountIn);`,
  },
  {
    n: "03",
    title: "Settles on Arc, atomically",
    body: "One transaction does the FX swap (if needed), takes the protocol fee, sends the merchant their preferred stable, and emits InvoicePaid. Webhook fires once the indexer sees the event.",
    code: `→ merchantPayout USDC\n→ webhook invoice.paid`,
  },
] as const;

export default function Home() {
  return (
    <main className="min-h-screen flex flex-col">
      <header className="px-6 py-5 flex items-center justify-between border-b border-arcora-border">
        <ArcoraLogo size={28} />
        <nav className="flex items-center gap-4 text-sm">
          <a href="#how-it-works" className="text-muted-foreground hover:text-foreground">How it works</a>
          <Link href="/roadmap" className="text-muted-foreground hover:text-foreground">Roadmap</Link>
          <a href="/m/login" className="text-arcora-link hover:underline">Merchants</a>
          <a href="https://github.com/Kubudak90/arc-fx-gateway" className="text-muted-foreground hover:text-foreground">GitHub</a>
        </nav>
      </header>

      <section className="px-6 pt-20 pb-12">
        <div className="max-w-3xl mx-auto text-center">
          <ArcoraLogo size={72} className="justify-center mb-8" />
          <p className="text-sm tracking-[0.2em] uppercase text-muted-foreground">
            Stablecoin Checkout &amp; Settlement
          </p>
          <h1 className="mt-6 font-[family-name:var(--font-display)] text-[56px] leading-[1.05] tracking-tight text-arcora-slate">
            Accept, move, and settle stablecoin payments with confidence.
          </h1>
          <p className="mt-6 text-lg text-muted-foreground max-w-2xl mx-auto">
            Arcora gives global businesses a checkout that quotes live FX, settles on-chain in seconds,
            and pays out in the stablecoin you choose. Secure. Compliant. Built for scale.
          </p>
          <div className="mt-10 flex justify-center gap-3">
            <a href="/m/login" className="btn-arcora-pill">Sign in as merchant</a>
            <a href="https://github.com/Kubudak90/arc-fx-gateway" className="btn-arcora-pill-light">View on GitHub</a>
          </div>
        </div>
      </section>

      <section className="px-6 pb-20">
        <div className="max-w-5xl mx-auto">
          <LiveSettlement />
          <p className="mt-4 text-center text-xs text-muted-foreground font-[family-name:var(--font-mono)] tracking-wider">
            Replay of the live v1.0.2 pay-flow against the on-chain Chainlink oracle. Every figure derived from the deployed contract — no fictional volumes.
          </p>
        </div>
      </section>

      <section className="px-6 pb-24">
        <div className="max-w-5xl mx-auto grid gap-8 md:grid-cols-3">
          {PILLARS.map(p => (
            <div key={p.label} className="rounded-2xl border border-arcora-border p-6">
              <div className="text-xs font-semibold tracking-[0.18em] text-arcora-teal">{p.label}</div>
              <p className="mt-3 text-arcora-slate leading-relaxed">{p.body}</p>
            </div>
          ))}
        </div>
      </section>

      <section id="how-it-works" className="px-6 pb-24">
        <div className="max-w-5xl mx-auto">
          <div className="text-center mb-12">
            <p className="text-sm tracking-[0.2em] uppercase text-arcora-teal font-semibold">How it works</p>
            <h2 className="mt-3 font-[family-name:var(--font-display)] text-[36px] leading-tight tracking-tight text-arcora-slate">
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
          <div className="mt-10 flex justify-center gap-3 text-sm">
            <a href="https://arc-fx-demo.vercel.app" target="_blank" rel="noopener noreferrer" className="btn-arcora-pill">
              Try the demo
            </a>
            <a href="https://www.npmjs.com/package/@arcora/sdk" target="_blank" rel="noopener noreferrer" className="btn-arcora-pill-light">
              @arcora/sdk on npm
            </a>
          </div>
        </div>
      </section>

      <section className="px-6 pb-24 bg-arcora-gray/30 border-y border-arcora-border">
        <div className="max-w-5xl mx-auto py-14 flex flex-col md:flex-row items-start md:items-center gap-6 justify-between">
          <div>
            <p className="text-sm tracking-[0.2em] uppercase text-arcora-teal font-semibold">Roadmap</p>
            <h2 className="mt-3 font-[family-name:var(--font-display)] text-[32px] leading-tight tracking-tight text-arcora-slate max-w-xl">
              Outward, signature by signature.
            </h2>
            <p className="mt-3 text-muted-foreground max-w-xl">
              v1 is live on Arc testnet. v2 wires up CCTP so customers pay from any chain. v3 turns it into one signature.
            </p>
          </div>
          <Link href="/roadmap" className="btn-arcora-pill shrink-0">
            See the full roadmap →
          </Link>
        </div>
      </section>

      <footer className="border-t border-arcora-border px-6 py-6 text-xs text-muted-foreground flex items-center justify-between">
        <ArcoraLogo size={20} />
        <span>Arcora · Arc testnet</span>
      </footer>
    </main>
  );
}
