import { useMemo, useState } from "react";
import { Arcora, ArcoraError } from "@arcora/sdk";

const API_BASE = (import.meta.env.VITE_ARC_BASE_URL ?? "https://arcorapay.xyz").replace(/\/$/, "");
const API_KEY  = import.meta.env.VITE_ARC_API_KEY ?? "";

// Vite inlines VITE_* vars into the built JS bundle, so any key here is
// public. Refuse to run with a live key — testnet keys only.
const KEY_IS_LIVE = API_KEY.startsWith("ak_live_");
const KEY_IS_TEST = API_KEY.startsWith("ak_test_");

export default function App() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // SDK ^1.1.0: prefer the instance API (`new Arcora({...})`) over the
  // deprecated module-level singleton (`Arcora.init` + `Arcora.createInvoice`)
  // — singletons leak state across tenants in any host app that mounts more
  // than one merchant. (Audit #24.)
  const arcora = useMemo(
    () => (KEY_IS_TEST ? new Arcora({ apiKey: API_KEY, baseUrl: API_BASE }) : null),
    [],
  );

  const params = new URLSearchParams(window.location.search);
  const paid      = params.get("paid") === "1";
  const cancelled = params.get("cancelled") === "1";

  async function handlePay() {
    if (!arcora) return;
    setBusy(true);
    setError(null);
    try {
      const invoice = await arcora.createInvoice({
        amountUsdc: 4.50,
        payInToken: "EURC",
        successUrl: window.location.origin + "/?paid=1",
        cancelUrl:  window.location.origin + "/?cancelled=1",
      });
      arcora.openCheckout(invoice);
    } catch (e) {
      setError(e instanceof ArcoraError ? `${e.code}: ${e.message}` : (e as Error).message);
      setBusy(false);
    }
  }

  if (KEY_IS_LIVE || !KEY_IS_TEST) {
    return (
      <main>
        <div className="card">
          <div className="brand">☕ Acme Coffee</div>
          <div className="banner danger">
            <strong>Demo blocked</strong>
            {KEY_IS_LIVE
              ? "VITE_ARC_API_KEY starts with ak_live_. Live keys are baked into the public JS bundle — never put one here. Use an ak_test_ key on testnet."
              : "VITE_ARC_API_KEY missing or invalid. Set an ak_test_ key (testnet only) in .env.local."}
          </div>
        </div>
      </main>
    );
  }

  return (
    <main>
      <div className="card">
        <div className="brand">☕ Acme Coffee</div>
        <div className="banner warn">
          <strong>Testnet demo</strong>
          The API key is inlined into this public JS bundle. Use only on
          testnet; route through a server for production.
        </div>
        <h1>One americano, please.</h1>
        <p>€4.50 · payable in EURC on Arc Network</p>
        <button onClick={handlePay} disabled={busy} className="pay-btn">
          {busy ? "Loading…" : "Pay €4.50"}
        </button>

        {paid && (
          <div className="status success">✓ Payment received — thanks for visiting!</div>
        )}
        {cancelled && (
          <div className="status warn">Payment cancelled. Try again whenever you&apos;re ready.</div>
        )}
        {error && (
          <div className="status error">
            <strong>Couldn&apos;t start checkout:</strong>
            <code>{error}</code>
          </div>
        )}

        <div className="footer">
          <a href={API_BASE} target="_blank" rel="noopener noreferrer">
            Powered by Arcora →
          </a>
        </div>
      </div>
    </main>
  );
}
