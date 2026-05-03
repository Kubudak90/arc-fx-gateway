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
          <tr><th>Package</th><th>Use it for</th></tr>
        </thead>
        <tbody>
          <tr><td><code>@arcora/sdk</code></td><td>Server-side invoice creation, webhook verification, refund triggers</td></tr>
          <tr><td><code>@arcora/sdk-react</code></td><td>React components for embedded checkout, hooks for invoice state</td></tr>
        </tbody>
      </table>
      <p>Both packages ship <code>1.0.0</code> on npm.</p>

      <h2><code>@arcora/sdk</code></h2>
      <h3><code>new Arcora(options)</code></h3>
      <pre><code>{`import { Arcora } from '@arcora/sdk';

const arcora = new Arcora({
  apiKey:  string,            // required — created at /m/settings
  baseUrl?: string,           // default 'https://arcorapay.xyz'
  engine?: 'v6' | 'v8',       // default 'v6'; opt into the relayer-driven v0.8 path with 'v8'
});`}</code></pre>

      <h3><code>arcora.createInvoice(input)</code></h3>
      <pre><code>{`const invoice = await arcora.createInvoice({
  amountUsdc:  number,                          // gross amount in USD-equivalent
  payInToken:  'USDC' | 'EURC',                 // what the customer will pay with
  successUrl:  string,                          // where to send the customer after payment
  cancelUrl?:  string,
  metadata?:   Record<string, string>,          // attached to the invoice and webhook payloads
});

// Returns:
// { invoiceId: '0x...', url: 'https://arcorapay.xyz/i/0x...' }`}</code></pre>

      <h3><code>arcora.refundInvoice(invoiceId)</code></h3>
      <pre><code>{`await arcora.refundInvoice('0x...');
// Triggers the on-chain refund tx from the merchant wallet — only works
// if the merchant has approved the gateway to pull payoutToken funds.`}</code></pre>

      <h3><code>verifyWebhook(rawBody, signature, secret)</code></h3>
      <pre><code>{`import { verifyWebhook } from '@arcora/sdk';

verifyWebhook(rawBody, headerSignature, process.env.ARCORA_WEBHOOK_SECRET!);
// returns boolean`}</code></pre>
      <p>Signature scheme: <code>HMAC-SHA256(rawBody, secret)</code> hex-encoded. Compare in constant time; the helper does that for you.</p>

      <h2><code>@arcora/sdk-react</code></h2>
      <h3><code>&lt;ArcoraProvider /&gt;</code></h3>
      <pre><code>{`import { ArcoraProvider } from '@arcora/sdk-react';

<ArcoraProvider apiKey={publicKey}>
  {children}
</ArcoraProvider>`}</code></pre>

      <h3><code>useInvoice(invoiceId)</code></h3>
      <pre><code>{`const { invoice, status, error } = useInvoice(invoiceId);
// status: 'loading' | 'created' | 'paid' | 'refunded' | 'expired' | 'failed'`}</code></pre>

      <h3><code>&lt;CheckoutButton /&gt;</code></h3>
      <pre><code>{`<CheckoutButton
  invoice={{ amountUsdc: 49.99, payInToken: 'EURC', successUrl: '...' }}
  onPaid={(invoiceId) => router.push(\`/orders/\${invoiceId}/thanks\`)}
/>`}</code></pre>
      <p>
        The component creates the invoice on click, opens the hosted checkout in a popup (with iframe fallback), and resolves
        when the customer&apos;s payment lands.
      </p>

      <h2>Types</h2>
      <p>
        Full type definitions ship with the package — <code>Arcora</code>, <code>Invoice</code>, <code>WebhookEvent</code>,
        <code>WebhookEventType</code>, etc. Open the <code>.d.ts</code> files in your IDE for the canonical shapes.
      </p>
    </DocsShell>
  );
}
