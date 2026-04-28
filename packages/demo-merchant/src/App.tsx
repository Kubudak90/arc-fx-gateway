import { useState } from "react";

const API_BASE = (import.meta.env.VITE_ARC_BASE_URL ?? "https://arc-fx-gateway.vercel.app").replace(/\/$/, "");
const API_KEY  = import.meta.env.VITE_ARC_API_KEY ?? "";

async function createInvoice(params: {
  amountUsdc: number;
  payInToken: "USDC" | "EURC";
  successUrl: string;
  cancelUrl?: string;
}): Promise<{ invoiceId: string; url: string }> {
  const res = await fetch(`${API_BASE}/api/invoices`, {
    method: "POST",
    headers: { "content-type": "application/json", "X-Arcora-Api-Key": API_KEY },
    body: JSON.stringify(params),
  });
  if (!res.ok) {
    const detail = await res.text();
    throw new Error(`createInvoice failed (${res.status}): ${detail}`);
  }
  return res.json() as Promise<{ invoiceId: string; url: string }>;
}

export default function App() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const paid = new URLSearchParams(window.location.search).get("paid") === "1";
  const cancelled = new URLSearchParams(window.location.search).get("cancelled") === "1";

  async function handlePay() {
    setBusy(true);
    setError(null);
    try {
      const invoice = await createInvoice({
        amountUsdc: 4.50,
        payInToken: "EURC",
        successUrl: window.location.origin + "/?paid=1",
        cancelUrl: window.location.origin + "/?cancelled=1",
      });
      window.location.href = invoice.url;
    } catch (e: any) {
      setError(e.message ?? "unknown error");
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
          <div className="status warn">Payment cancelled. Try again whenever you're ready.</div>
        )}
        {error && (
          <div className="status error">
            <strong>Couldn't start checkout:</strong>
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
