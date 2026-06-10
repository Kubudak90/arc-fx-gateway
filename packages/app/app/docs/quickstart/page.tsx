import Link from "next/link";
import type { Route } from "next";
import { DocsShell } from "@/components/docs/DocsShell";

export const metadata = {
  title: "Developer quickstart · Arcorapay docs",
  description: "Install the SDK, create an invoice, listen for the webhook — ten minutes end-to-end.",
};

export default function QuickstartDocs() {
  return (
    <DocsShell
      currentPath="/docs/quickstart"
      title="Developer quickstart"
      description="Install the SDK, create an invoice, listen for the webhook — ten minutes end-to-end."
    >
      <p>
        This is the developer integration guide. If you&apos;re a tester just trying the flow in a browser, the{" "}
        <Link href={"/quickstart" as Route}>10-minute tester quickstart</Link> is faster.
      </p>

      <h2>Prerequisites</h2>
      <ul>
        <li>Node.js 20 or higher</li>
        <li>A merchant account on <code>arcorapay.xyz/m/login</code> (sign in once with your wallet, register your payout token)</li>
        <li>An API key (created at <code>/m/settings</code> once registered)</li>
      </ul>

      <h2>1. Install the SDK</h2>
      <pre><code>{`npm install @arcora/sdk
# or, for React:
npm install @arcora/sdk-react`}</code></pre>

      <h2>2. Create an invoice</h2>
      <pre><code>{`import { Arcora } from '@arcora/sdk';

const arcora = new Arcora({ apiKey: process.env.ARCORA_API_KEY });

const invoice = await arcora.createInvoice({
  amountUsdc:  49.99,
  payInToken:  'EURC',
  successUrl:  'https://yourshop.com/order/123/success',
  cancelUrl:   'https://yourshop.com/order/123/cancel',
  metadata:    { orderId: '123' },
});

// Send the customer here:
console.log(invoice.url);
// https://arcorapay.xyz/i/0x4f3a...`}</code></pre>
      <p>
        <code>amountUsdc</code> is the gross amount your customer will pay, denominated in your payout-token&apos;s
        USD-equivalent. The pay-in token is what the customer pays <em>with</em> — Arcora handles the FX.
      </p>

      <h2>3. Receive the webhook</h2>
      <p>
        Configure a webhook URL in <code>/m/settings</code>. Arcora signs each payload with HMAC-SHA256 over the raw
        body using the secret you set there. Verification is plain <code>node:crypto</code> — deliberately not an SDK
        method, so it works in any runtime (see <Link href={"/docs/webhooks" as Route}>Webhooks</Link> for details).
      </p>
      <pre><code>{`import { createHmac, timingSafeEqual } from 'node:crypto';

function verifyWebhook(rawBody: string, signatureHex: string, secret: string) {
  const expected = createHmac('sha256', secret).update(rawBody).digest('hex');
  const a = Buffer.from(expected, 'hex');
  const b = Buffer.from(signatureHex, 'hex');
  return a.length === b.length && timingSafeEqual(a, b);
}

export async function POST(req: Request) {
  const signature = req.headers.get('x-arcora-signature') ?? '';
  const rawBody   = await req.text();

  if (!verifyWebhook(rawBody, signature, process.env.ARCORA_WEBHOOK_SECRET!)) {
    return new Response('Bad signature', { status: 400 });
  }

  const event = JSON.parse(rawBody);

  switch (event.type) {
    case 'invoice.paid':
      // event.invoice_id, event.paid_by, event.tx_hash
      break;
    case 'invoice.refunded':
      break;
    case 'compliance.review_queued':
      break;
  }
  return new Response('ok');
}`}</code></pre>

      <h2>4. Test it</h2>
      <p>
        Open the invoice URL in an incognito window with a different funded wallet. Sign the Permit2 prompt. Within 30 seconds:
      </p>
      <ul>
        <li>Customer sees &quot;Paid ✓&quot;</li>
        <li>Your webhook endpoint receives <code>invoice.paid</code></li>
        <li>The settled amount lands in your merchant wallet</li>
      </ul>
      <p>
        Refund flows the same way — trigger it from the invoice row in <code>/m/dashboard</code>. (There&apos;s no SDK
        refund method; refunds are merchant-dashboard or direct-contract operations.)
      </p>

      <h2>Common pitfalls</h2>
      <ul>
        <li><strong>CORS</strong> — <code>/api/invoices</code> is CORS-open by design. The hosted checkout doesn&apos;t need your origin allowlisted.</li>
        <li><strong>Quote expiry</strong> — Hosted checkout shows a TTL on the quote; if it expires, the customer has to refresh. SDK quotes are advisory; the actual rate is locked at <code>kit.swap</code> time.</li>
        <li><strong>Refund window</strong> — The custody-escrow gateway holds each settled invoice in per-invoice escrow for 7 days. Refunds drain directly from the escrow — no ERC-20 allowance from the merchant wallet is required. The window is <em>soft</em>: after 7 days anyone can call <code>claim(globalIds[])</code> to release the matured funds to the merchant payout address, but a refund stays callable until that claim actually lands — whichever transaction confirms first wins. Once claimed, the refund path closes.</li>
      </ul>
    </DocsShell>
  );
}
