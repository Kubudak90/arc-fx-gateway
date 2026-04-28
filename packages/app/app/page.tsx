export default function Home() {
  return (
    <main className="min-h-screen grid place-items-center px-6">
      <div className="max-w-2xl text-center">
        <h1 className="font-[family-name:var(--font-display)] text-[64px] leading-[1.00] tracking-tight">
          Arcora
        </h1>
        <p className="mt-6 text-lg text-muted-foreground">
          Stablecoin checkout and FX settlement on Arc. Merchants invoice in USDC; customers pay with USDC or EURC; settlement happens in one onchain transaction.
        </p>
        <div className="mt-10 flex justify-center gap-3">
          <a href="/m/login" className="btn-cb-pill-light">Sign in as merchant</a>
          <a href="https://github.com/Kubudak90/arc-fx-gateway" className="btn-cb-pill">View on GitHub</a>
        </div>
      </div>
    </main>
  );
}
