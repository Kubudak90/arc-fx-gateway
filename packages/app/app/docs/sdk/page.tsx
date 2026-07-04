import { DocsShell } from "@/components/docs/DocsShell";

export const metadata = {
  title: "SDK reference · Arcorapay docs",
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
          <tr><td><code>@arcora/sdk</code></td><td>Browser or server-side invoice creation, hosted-checkout redirect, escrow listing, webhook verification</td><td><code>1.4.0</code></td></tr>
          <tr><td><code>@arcora/sdk-react</code></td><td>React hook and one-click button that wrap the SDK for embedded checkout</td><td><code>1.4.1</code></td></tr>
        </tbody>
      </table>
      <p>
        Webhook verification ships in the SDK since <code>1.3.0</code>:{" "}
        <code>{`import { verifyWebhook } from "@arcora/sdk/webhook"`}</code> enforces the replay window and compares in
        constant time, and is <strong>fail-closed</strong> — a missing or mismatched signature returns{" "}
        <code>false</code>. Runtimes without the SDK can reproduce the same HMAC in a few lines of{" "}
        <code>node:crypto</code>; see <a href="/docs/webhooks">/docs/webhooks</a> for both.
      </p>

      <h2>Two key types — publishable vs secret</h2>
      <table>
        <thead>
          <tr><th>Key</th><th>Prefix</th><th>Where it goes</th><th>Capability</th></tr>
        </thead>
        <tbody>
          <tr><td>Publishable</td><td><code>pk_live_…</code></td><td>Browser / client code — <strong>safe to embed</strong></td><td>Create a checkout from one of your allowlisted origins</td></tr>
          <tr><td>Secret</td><td><code>ak_live_…</code></td><td><strong>Server-side only — never ship to the browser</strong></td><td>Everything: create invoices, list escrows, read private invoice data</td></tr>
        </tbody>
      </table>
      <p>
        Anyone who loads your page can read a key embedded in it. Embed only the
        <strong> publishable</strong> key in browser code; keep the <strong>secret</strong>
        key on your server. Privileged reads like <code>escrows()</code> require the
        secret key and only work server-side. Both keys are shown in
        <a href="/m/settings"> /m/settings</a>; set your allowed origins there so
        publishable-key checkouts are accepted.
      </p>

      <h2><code>@arcora/sdk</code></h2>
      <h3><code>new Arcora(options)</code></h3>
      <pre><code>{`import { Arcora } from '@arcora/sdk';

const arcora = new Arcora({
  apiKey:      string,                     // required — publishable pk_live_… in the browser, secret ak_live_… on a server
  environment?: 'testnet' | 'mainnet',    // default 'testnet'; selects the base URL
  baseUrl?:    string,                     // override for self-hosted deployments
  timeoutMs?:  number,                     // per-request timeout; default 30000 — a hung server rejects with code 'TIMEOUT'
});`}</code></pre>
      <p>The legacy <code>Arcora.init(...)</code> / <code>Arcora.createInvoice(...)</code> singleton API is still exported for the CDN bundle but tagged <code>@deprecated</code> — use the instance API for any new code so multiple merchants in one process can&apos;t cross-contaminate state.</p>

      <h3><code>arcora.createInvoice(params)</code></h3>
      <pre><code>{`const invoice = await arcora.createInvoice({
  amount:      string,                     // amount in major units as a DECIMAL STRING, e.g. '49.99' (no floats)
  currency?:   'USDC' | 'EURC' | 'USDT',   // merchant payout currency; default 'USDC'
  idempotencyKey?: string,                 // sent as the Idempotency-Key header; a retried create never duplicates
  successUrl:  string,                     // required — http(s) where to send the customer after payment
  cancelUrl?:  string,                     // http(s) — same allowlist + SSRF guard
  metadata?:   Record<string, string>,     // attached to invoice + webhook payloads

  // Deprecated v1 amount form — prefer amount/currency above. The buyer always locks USDC.
  amountUsdc?: number,                     // @deprecated — gross amount as a number (1 = $1.00)
  payInToken?: 'USDC' | 'EURC',            // @deprecated — ignored on the v2 path
});

// Returns:
// { invoiceId: '0x…',
//   url:       'https://arcorapay.xyz/i/0x…',
//   claimableAt?: '2026-05-20T…' }       // custody escrow — populated once the invoice is paid`}</code></pre>
      <p>
        Supply exactly one amount form — the SDK sends the v2 request when <code>amount</code> is present, otherwise the
        legacy v1 request. Throws <code>ArcoraError</code> with a typed <code>code</code> on validation, network, server,
        or auth failures. An <code>amount</code> that isn&apos;t a positive decimal string (and a legacy{" "}
        <code>amountUsdc</code> that&apos;s non-finite or ≤0) is rejected client-side before the request fires; a missing
        or non-http(s) <code>successUrl</code> is likewise rejected client-side with <code>INVALID_URL</code>.
      </p>
      <p>
        <strong>Note:</strong> the SDK requires <code>successUrl</code>. Standalone invoices (no redirect — the invoice
        page just shows the paid status) are possible only by calling the raw REST endpoint{" "}
        <code>POST /api/invoices</code> directly, where <code>successUrl</code> is optional.
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
      <p><strong>Server-side only — requires your secret <code>ak_live_</code> key.</strong> Calling <code>escrows()</code> with a publishable key throws <code>PUBLISHABLE_KEY_FORBIDDEN</code> without making a request. Authenticated against the merchant whose <code>apiKey</code> the instance was constructed with. Three buckets cap at 200 rows each; a <code>truncated</code> flag tells the caller when to narrow filters.</p>

      <h3>Errors</h3>
      <pre><code>{`import { Arcora, ArcoraError } from '@arcora/sdk';

try {
  await arcora.createInvoice({ amount: '49.99', currency: 'EURC', successUrl: '...' });
} catch (e) {
  if (e instanceof ArcoraError) {
    // e.code is one of: 'INVALID_API_KEY' | 'NETWORK' | 'SERVER_ERROR'
    //                   | 'INVALID_URL'    | 'TIMEOUT' | 'NO_SECURE_RANDOM'
    //                   | 'PUBLISHABLE_KEY_FORBIDDEN' | 'SECRET_KEY_IN_BROWSER'
    //                   | 'UNKNOWN'
    // e.retryAfter (seconds) is set on SERVER_ERROR when the server returned Retry-After
  }
}`}</code></pre>

      <h2><code>@arcora/sdk-react</code></h2>
      <h3><code>useCheckout(options)</code></h3>
      <pre><code>{`import { useCheckout } from '@arcora/sdk-react';

function PayButton() {
  const { checkout, loading, error, refundEndsAt } = useCheckout({
    apiKey: process.env.NEXT_PUBLIC_ARCORA_PUBLISHABLE_KEY!, // pk_live_… — safe to inline in the browser
    environment: 'testnet',
  });

  return (
    <button onClick={() => checkout({
      amount: '4.50',
      currency: 'EURC',
      successUrl: window.location.origin + '/orders/done',
    })} disabled={loading}>
      {loading ? 'Loading…' : 'Pay €4.50'}
    </button>
  );
}`}</code></pre>
      <p>
        <code>checkout(params)</code> creates the invoice and immediately redirects via <code>window.location.href</code>.
        <code>refundEndsAt</code> is <code>null</code> after checkout — the created invoice is still unpaid — so read the
        merchant claim deadline from <code>escrows()</code> once the invoice is paid.
      </p>

      <h3><code>&lt;CheckoutButton /&gt;</code></h3>
      <pre><code>{`import { CheckoutButton } from '@arcora/sdk-react';

<CheckoutButton
  apiKey={process.env.NEXT_PUBLIC_ARCORA_PUBLISHABLE_KEY!}
  environment="testnet"
  invoice={{ amount: '49.99', currency: 'EURC', successUrl: '...' }}
  className="btn-primary"
>
  Pay $49.99
</CheckoutButton>`}</code></pre>
      <p>Thin wrapper around <code>useCheckout</code>. Renders a native <code>&lt;button&gt;</code>; bring your own styling. The button auto-disables while the invoice is being created.</p>

      <h2>Types</h2>
      <p>
        Full type definitions ship in the package&apos;s <code>dist/index.d.ts</code>: <code>Arcora</code>,
        <code>ArcoraError</code>, <code>CreateInvoiceParams</code>, <code>Invoice</code>, <code>EscrowSummary</code>,
        <code>InitOptions</code>, <code>Environment</code>, <code>Currency</code>, <code>PayInToken</code>. The contract ABI is also
        re-exported as <code>gatewayAbi</code> / <code>GATEWAY_ABI</code> for callers building their own viem clients.
      </p>
    </DocsShell>
  );
}
