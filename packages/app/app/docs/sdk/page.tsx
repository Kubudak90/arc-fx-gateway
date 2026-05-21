import { DocsShell } from "@/components/docs/DocsShell";

export const metadata = {
  title: "SDK reference · Arcora docs",
  description: "@arcora/sdk and @arcora/sdk-react — installation, types, and method-by-method walkthrough.",
};

export default function SdkDocs() {
  return (
    <DocsShell
      currentPath="/docs/sdk"
      title="SDK reference"
      description="@arcora/sdk and @arcora/sdk-react — installation, types, and method-by-method walkthrough."
    >
      <h2>Packages</h2>
      <table>
        <thead>
          <tr><th>Package</th><th>Use it for</th><th>Version</th></tr>
        </thead>
        <tbody>
          <tr><td><code>@arcora/sdk</code></td><td>Browser or server-side invoice creation, hosted-checkout redirect, escrow listing</td><td><code>1.1.0</code></td></tr>
          <tr><td><code>@arcora/sdk-react</code></td><td>React hook and one-click button that wrap the SDK for embedded checkout</td><td><code>1.0.0</code></td></tr>
        </tbody>
      </table>
      <p>Webhook verification is signature-only and stays out of the SDK on purpose — three lines of <code>crypto.createHmac</code> work in any runtime; see <a href="/docs/webhooks">/docs/webhooks</a> for the snippet.</p>

      <h2><code>@arcora/sdk</code></h2>
      <h3><code>new Arcora(options)</code></h3>
      <pre><code>{`import { Arcora } from '@arcora/sdk';

const arcora = new Arcora({
  apiKey:      string,                     // required — issued at /m/settings (ak_test_… or ak_live_…)
  environment?: 'testnet' | 'mainnet',    // default 'testnet'; selects the base URL
  baseUrl?:    string,                     // override for self-hosted deployments
});`}</code></pre>
      <p>The legacy <code>Arcora.init(...)</code> / <code>Arcora.createInvoice(...)</code> singleton API is still exported for the CDN bundle but tagged <code>@deprecated</code> — use the instance API for any new code so multiple merchants in one process can&apos;t cross-contaminate state.</p>

      <h3><code>arcora.createInvoice(params)</code></h3>
      <pre><code>{`const invoice = await arcora.createInvoice({
  amountUsdc: number,                      // gross amount in USD-equivalent (1 = $1.00)
  payInToken: 'USDC' | 'EURC',             // what the customer will pay with
  successUrl?: string,                     // http(s) — where to send the customer after payment; optional for standalone invoices
  cancelUrl?:  string,                     // http(s) — same allowlist + SSRF guard
  metadata?:   Record<string, string>,     // attached to invoice + webhook payloads
});

// Returns:
// { invoiceId: '0x…',
//   url:       'https://arcorapay.xyz/i/0x…',
//   claimableAt?: '2026-05-20T…' }       // custody escrow — populated once the invoice is paid`}</code></pre>
      <p>
        Throws <code>ArcoraError</code> with a typed <code>code</code> on validation, network, server, or auth failures.
        Invalid <code>amountUsdc</code> (non-finite, ≤0) is rejected client-side before the request fires.
      </p>

      <h3><code>arcora.openCheckout(invoice)</code></h3>
      <pre><code>{`arcora.openCheckout(invoice);
// equivalent to window.location.href = invoice.url
// browser-only; throws in Node`}</code></pre>

      <h3><code>arcora.escrows()</code></h3>
      <pre><code>{`const { pending, matured, claimed } = await arcora.escrows();
// pending: paid invoices still within the 7-day refund window
// matured: paid, window elapsed, ready to claim()
// claimed: already withdrawn to the merchant payout wallet`}</code></pre>
      <p>Authenticated against the merchant whose <code>apiKey</code> the instance was constructed with. Three buckets cap at 200 rows each; a <code>truncated</code> flag tells the caller when to narrow filters.</p>

      <h3>Errors</h3>
      <pre><code>{`import { Arcora, ArcoraError } from '@arcora/sdk';

try {
  await arcora.createInvoice({ amountUsdc: 49.99, payInToken: 'EURC', successUrl: '...' });
} catch (e) {
  if (e instanceof ArcoraError) {
    // e.code is one of: 'INVALID_API_KEY' | 'NETWORK' | 'SERVER_ERROR'
    //                   | 'INVALID_URL'    | 'TIMEOUT' | 'NO_SECURE_RANDOM' | 'UNKNOWN'
    // e.retryAfter (seconds) is set on SERVER_ERROR when the server returned Retry-After
  }
}`}</code></pre>

      <h2><code>@arcora/sdk-react</code></h2>
      <h3><code>useCheckout(options)</code></h3>
      <pre><code>{`import { useCheckout } from '@arcora/sdk-react';

function PayButton() {
  const { checkout, loading, error, refundEndsAt } = useCheckout({
    apiKey: process.env.NEXT_PUBLIC_ARCORA_KEY!,
    environment: 'testnet',
  });

  return (
    <button onClick={() => checkout({
      amountUsdc: 4.50,
      payInToken: 'EURC',
      successUrl: window.location.origin + '/orders/done',
    })} disabled={loading}>
      {loading ? 'Loading…' : 'Pay €4.50'}
    </button>
  );
}`}</code></pre>
      <p>
        <code>checkout(params)</code> creates the invoice and immediately redirects via <code>window.location.href</code>.
        <code>refundEndsAt</code> populates once the invoice is paid — useful for showing the customer when the refund
        window closes.
      </p>

      <h3><code>&lt;CheckoutButton /&gt;</code></h3>
      <pre><code>{`import { CheckoutButton } from '@arcora/sdk-react';

<CheckoutButton
  apiKey={process.env.NEXT_PUBLIC_ARCORA_KEY!}
  environment="testnet"
  invoice={{ amountUsdc: 49.99, payInToken: 'EURC', successUrl: '...' }}
  className="btn-primary"
>
  Pay $49.99
</CheckoutButton>`}</code></pre>
      <p>Thin wrapper around <code>useCheckout</code>. Renders a native <code>&lt;button&gt;</code>; bring your own styling. The button auto-disables while the invoice is being created.</p>

      <h2>Types</h2>
      <p>
        Full type definitions ship in the package&apos;s <code>dist/index.d.ts</code>: <code>Arcora</code>,
        <code>ArcoraError</code>, <code>CreateInvoiceParams</code>, <code>Invoice</code>, <code>EscrowSummary</code>,
        <code>InitOptions</code>, <code>Environment</code>, <code>PayInToken</code>. The contract ABI is also
        re-exported as <code>gatewayAbi</code> / <code>GATEWAY_ABI</code> for callers building their own viem clients.
      </p>
    </DocsShell>
  );
}
