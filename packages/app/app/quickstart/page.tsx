import Link from "next/link";
import type { Route } from "next";
import { ArcoraLogo } from "@/components/brand/Logo";
import { SiteFooter } from "@/components/landing/SiteFooter";
import { AddArcTestnetButton } from "@/components/quickstart/AddArcTestnetButton";

const NETWORK = {
  name: "Arc Testnet",
  chainId: 5042002,
  rpcUrl: "https://rpc.testnet.arc.network",
  explorer: "https://testnet.arcscan.app",
  symbol: "USDC",
};

const FAUCET = "https://faucet.circle.com";

const STEPS: Array<{ n: string; title: string; body: React.ReactNode }> = [
  {
    n: "01",
    title: "Add Arc Testnet to your wallet",
    body: (
      <>
        <p className="text-muted-foreground leading-relaxed">
          Arcora settles on Arc Testnet today. One click to add the network — your wallet will prompt for confirmation.
        </p>
        <div className="mt-5">
          <AddArcTestnetButton />
        </div>
        <details className="mt-5 group">
          <summary className="cursor-pointer text-sm text-muted-foreground hover:text-foreground select-none">
            Or add it manually with these values
          </summary>
          <dl className="mt-3 grid grid-cols-[140px_1fr] gap-y-2 text-sm font-[family-name:var(--font-mono)]">
            <dt className="text-muted-foreground">Network name</dt>
            <dd className="text-arcora-slate">{NETWORK.name}</dd>
            <dt className="text-muted-foreground">Chain ID</dt>
            <dd className="text-arcora-slate">{NETWORK.chainId}</dd>
            <dt className="text-muted-foreground">RPC URL</dt>
            <dd className="text-arcora-slate break-all">{NETWORK.rpcUrl}</dd>
            <dt className="text-muted-foreground">Symbol</dt>
            <dd className="text-arcora-slate">{NETWORK.symbol}</dd>
            <dt className="text-muted-foreground">Explorer</dt>
            <dd className="text-arcora-slate break-all">{NETWORK.explorer}</dd>
          </dl>
        </details>
        <p className="mt-4 text-xs text-muted-foreground">
          On Arc, gas is paid in <span className="font-[family-name:var(--font-mono)]">USDC</span>, not ETH.
          Native USDC has 18 decimals; the ERC-20 interface (the one you&apos;ll see in dapps) is 6 decimals.
        </p>
      </>
    ),
  },
  {
    n: "02",
    title: "Get testnet USDC and EURC",
    body: (
      <>
        <p className="text-muted-foreground leading-relaxed">
          Circle&apos;s public faucet drops both stables on Arc Testnet — pick a token, paste your wallet address, claim.
        </p>
        <a
          href={FAUCET}
          target="_blank"
          rel="noopener noreferrer"
          className="mt-5 inline-flex btn-arcora-pill-light"
        >
          Open Circle Faucet →
        </a>
        <p className="mt-4 text-xs text-muted-foreground">
          You&apos;ll need a small amount of native USDC for gas plus whatever pay-in token you want to test
          (USDC or EURC). 10 of each is plenty for a few full pay/refund cycles.
        </p>
      </>
    ),
  },
  {
    n: "03",
    title: "Sign in as a merchant",
    body: (
      <>
        <p className="text-muted-foreground leading-relaxed">
          Open the merchant portal and authenticate with Sign-In-with-Ethereum. The wallet you sign with becomes your
          merchant identity — there&apos;s no signup form on testnet, just a signature.
        </p>
        <Link href="/m/login" className="mt-5 inline-flex btn-arcora-pill">
          Open merchant portal →
        </Link>
        <p className="mt-4 text-xs text-muted-foreground">
          First time only: you&apos;ll be asked which stablecoin you want to settle in (USDC or EURC). That choice is
          frozen at registration but rotatable later for future invoices.
        </p>
      </>
    ),
  },
  {
    n: "04",
    title: "Create a test invoice",
    body: (
      <>
        <p className="text-muted-foreground leading-relaxed">
          From the dashboard, click <span className="font-semibold">Create invoice</span>. Set the amount, the pay-in
          token (the customer&apos;s side — can be different from your payout), and a success URL. Arcora returns a
          hosted checkout link.
        </p>
        <Link href="/m/dashboard" className="mt-5 inline-flex btn-arcora-pill-light">
          Go to dashboard →
        </Link>
        <p className="mt-4 text-xs text-muted-foreground">
          You can also create invoices from the SDK — see the &ldquo;Developers&rdquo; section on the home page.
        </p>
      </>
    ),
  },
  {
    n: "05",
    title: "Pay the invoice from a different wallet",
    body: (
      <>
        <p className="text-muted-foreground leading-relaxed">
          Open the invoice link in an incognito window or a different wallet. Connect, see the live FX quote, sign
          one Permit2 message — no transaction popup, no gas. Arcora&apos;s relayer handles the on-chain side.
        </p>
        <p className="mt-4 text-sm text-muted-foreground leading-relaxed">
          Watch settlement land on the merchant dashboard&apos;s <Link href="/m/treasury" className="text-arcora-link hover:underline">treasury page</Link> within ~30 seconds.
          Try a refund from the invoice row to round-trip the flow.
        </p>
      </>
    ),
  },
];

const KNOWN_ISSUES: Array<{ headline: string; detail: string }> = [
  {
    headline: "We’re on Arc Testnet only — no real money moves.",
    detail: "Arc itself is on testnet, so we are too. Mainnet T-0 is gated on Arc going mainnet. Treat this as a working preview, not a production payment rail.",
  },
  {
    headline: "Pay-in / payout tokens are USDC and EURC for now.",
    detail: "App Kit Swap on Arc Testnet supports only USDC ⇄ EURC today. USDT, PYUSD, DAI, and USDe are mainnet-only on App Kit; we’ll list them as Arc opens those on testnet or as we move to mainnet.",
  },
  {
    headline: "Refunds need the merchant to re-approve the gateway.",
    detail: "The refund flow pulls the merchant’s payout-token funds back to send to the customer — so the gateway needs an ERC-20 allowance from the merchant’s wallet first. The dashboard’s refund button handles the prompt.",
  },
  {
    headline: "Webhooks retry 5× over 30 minutes, then stop.",
    detail: "If your webhook endpoint is down longer than that, you’ll need to fetch missed events via the API. Long-term retry policy is on the v1.x list.",
  },
  {
    headline: "Compliance screening is in shadow mode.",
    detail: "The /api/checkout/authorize gate exists and logs decisions, but the active provider is Noop on testnet — no wallet is rejected today. Mainnet flips it to a real Elliptic / TRM Labs adapter via env, no code change.",
  },
  {
    headline: "Single-instance relayer.",
    detail: "One VPS handles every settle and refund. If it’s slow or briefly down, your invoice queues up and processes when it’s back. Multi-relayer with rolling failover is on the v1.x ops list.",
  },
];

export default function QuickstartPage() {
  return (
    <main className="min-h-screen flex flex-col">
      <header className="sticky top-0 z-50 backdrop-blur-md bg-white/80 px-4 sm:px-6 py-4 flex items-center justify-between gap-3 border-b border-arcora-border">
        <Link href={"/" as Route} className="inline-flex items-center" aria-label="Arcora home">
          <ArcoraLogo size={28} />
        </Link>
        <nav className="flex items-center gap-3 sm:gap-4 text-sm">
          <Link href={"/" as Route} className="text-muted-foreground hover:text-foreground">Home</Link>
          <Link href={"/m/login" as Route} className="text-arcora-link hover:underline whitespace-nowrap">Merchants</Link>
          <a
            href="https://github.com/Kubudak90/arc-fx-gateway"
            className="text-muted-foreground hover:text-foreground"
          >
            GitHub
          </a>
        </nav>
      </header>

      <section className="px-4 sm:px-6 pt-12 sm:pt-20 pb-12">
        <div className="max-w-3xl mx-auto text-center">
          <p className="text-xs sm:text-sm tracking-[0.2em] uppercase text-muted-foreground">Tester quickstart</p>
          <h1 className="mt-6 font-[family-name:var(--font-display)] text-[34px] sm:text-[44px] md:text-[52px] leading-[1.08] tracking-tight text-arcora-slate text-balance">
            From zero to a settled testnet payment in five steps.
          </h1>
          <p className="mt-6 text-base sm:text-lg text-muted-foreground max-w-2xl mx-auto">
            Should take ten minutes including the wallet setup. If anything sticks, open an issue on
            GitHub or email <span className="font-[family-name:var(--font-mono)]">support@arcorapay.xyz</span> — we&apos;d rather hear about a bug now than once
            mainnet money is moving.
          </p>
        </div>
      </section>

      <section className="px-4 sm:px-6 pb-20">
        <ol className="max-w-3xl mx-auto space-y-6">
          {STEPS.map((step) => (
            <li
              key={step.n}
              className="rounded-2xl border border-arcora-border p-6 sm:p-8 bg-white"
            >
              <div className="flex items-baseline gap-4 mb-3">
                <span className="font-[family-name:var(--font-mono)] text-xs font-semibold tracking-[0.18em] text-arcora-teal">
                  STEP {step.n}
                </span>
                <h2 className="font-semibold text-arcora-slate text-lg sm:text-xl">{step.title}</h2>
              </div>
              {step.body}
            </li>
          ))}
        </ol>
      </section>

      <section className="px-4 sm:px-6 pb-24">
        <div className="max-w-3xl mx-auto">
          <div className="text-center mb-8">
            <p className="text-xs sm:text-sm tracking-[0.2em] uppercase text-arcora-teal font-semibold">
              Known issues
            </p>
            <h2 className="mt-3 font-[family-name:var(--font-display)] text-[24px] sm:text-[28px] leading-tight tracking-tight text-arcora-slate text-balance">
              What&apos;s rough, on purpose.
            </h2>
            <p className="mt-3 text-sm text-muted-foreground">
              We&apos;d rather you hit these expecting them than be surprised mid-test.
            </p>
          </div>
          <ul className="space-y-4">
            {KNOWN_ISSUES.map((issue) => (
              <li
                key={issue.headline}
                className="rounded-xl border border-arcora-border p-5 bg-arcora-gray/30"
              >
                <p className="font-semibold text-arcora-slate">{issue.headline}</p>
                <p className="mt-1 text-sm text-muted-foreground leading-relaxed">{issue.detail}</p>
              </li>
            ))}
          </ul>
        </div>
      </section>

      <SiteFooter />
    </main>
  );
}
