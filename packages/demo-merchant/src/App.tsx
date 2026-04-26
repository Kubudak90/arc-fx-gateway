import { CheckoutButton } from "@arc-fx/checkout-react";

const apiKey = import.meta.env.VITE_ARC_API_KEY ?? "ak_live_demo_set_in_env";
const arcBaseUrl = import.meta.env.VITE_ARC_BASE_URL;

export default function App() {
  return (
    <main>
      <div className="card">
        <h1>Acme Coffee</h1>
        <p>One americano, please. €4.50, payable in EURC.</p>
        <CheckoutButton
          apiKey={apiKey}
          environment="testnet"
          baseUrl={arcBaseUrl}
          invoice={{
            amountUsdc: 4.50,
            payInToken: "EURC",
            successUrl: window.location.origin + "/?paid=1",
            cancelUrl: window.location.origin + "/?cancelled=1",
          }}
          className="pay-btn"
        >
          Pay €4.50
        </CheckoutButton>
        {new URLSearchParams(window.location.search).get("paid") === "1" && (
          <p style={{ color: "#10b981", marginTop: 24 }}>✓ Payment received — thanks!</p>
        )}
      </div>
    </main>
  );
}
