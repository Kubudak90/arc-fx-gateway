import { useState } from "react";
import { Arcora, ArcoraError } from "@arcora/sdk";

const API_BASE = (import.meta.env.VITE_ARC_BASE_URL ?? "https://arcorapay.xyz").replace(/\/$/, "");
const API_KEY  = import.meta.env.VITE_ARC_API_KEY ?? "";

Arcora.init({ apiKey: API_KEY, baseUrl: API_BASE });

export default function App() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const params = new URLSearchParams(window.location.search);
  const paid      = params.get("paid") === "1";
  const cancelled = params.get("cancelled") === "1";

  async function handlePay() {
    setBusy(true);
    setError(null);
    try {
      const invoice = await Arcora.createInvoice({
        amountUsdc: 4.50,
        payInToken: "EURC",
        successUrl: window.location.origin + "/?paid=1",
        cancelUrl:  window.location.origin + "/?cancelled=1",
      });
      Arcora.openCheckout(invoice);
    } catch (e) {
      setError(e instanceof ArcoraError ? `${e.code}: ${e.message}` : (e as Error).message);
      setBusy(false);
    }
  }

  return (
    <main>
      <div className="card">
        <div className="brand">☕ Acme Coffee</div>
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
