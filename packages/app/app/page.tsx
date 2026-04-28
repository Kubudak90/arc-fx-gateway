import { ArcoraLogo } from "@/components/brand/Logo";

const PILLARS = [
  { label: "SECURE", body: "Funds settle on-chain in a single transaction; no custody, no off-chain credit." },
  { label: "FAST",   body: "Sub-minute checkout from invoice to payout, with live FX from a Chainlink-priced AMM." },
  { label: "GLOBAL", body: "Stablecoin-native rails — accept USDC or EURC anywhere, settle in your chosen currency." },
] as const;

export default function Home() {
  return (
    <main className="min-h-screen flex flex-col">
      <header className="px-6 py-5 flex items-center justify-between border-b border-arcora-border">
        <ArcoraLogo size={28} />
        <nav className="flex items-center gap-4 text-sm">
          <a href="/m/login" className="text-arcora-link hover:underline">Merchants</a>
          <a href="https://github.com/Kubudak90/arc-fx-gateway" className="text-muted-foreground hover:text-foreground">GitHub</a>
        </nav>
      </header>

      <section className="flex-1 grid place-items-center px-6 py-20">
        <div className="max-w-3xl text-center">
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

      <footer className="border-t border-arcora-border px-6 py-6 text-xs text-muted-foreground flex items-center justify-between">
        <ArcoraLogo size={20} />
        <span>Arcora · Arc testnet</span>
      </footer>
    </main>
  );
}
