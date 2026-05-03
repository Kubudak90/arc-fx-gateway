import { DocsShell } from "@/components/docs/DocsShell";

export const metadata = {
  title: "Webhooks · Arcora docs",
  description: "Event payloads, signing, and the retry policy.",
};

export default function WebhooksDocs() {
  return (
    <DocsShell
      currentPath="/docs/webhooks"
      title="Webhooks"
      description="Event payloads, signing, and the retry policy."
    >
      <h2>Configuration</h2>
      <p>
        Set the webhook URL + secret at <code>/m/settings</code>. The secret is encrypted at rest with AES-GCM; we never
        log or display it after creation.
      </p>

      <h2>Signing</h2>
      <p>
        Every webhook request carries <code>X-Arcora-Signature: &lt;hex&gt;</code> where the value is{" "}
        <code>HMAC-SHA256(rawBody, secret)</code>. Verify before trusting:
      </p>
      <pre><code>{`import { createHmac, timingSafeEqual } from 'node:crypto';

function verify(rawBody: string, signatureHex: string, secret: string) {
  const expected = createHmac('sha256', secret).update(rawBody).digest('hex');
  const a = Buffer.from(expected, 'hex');
  const b = Buffer.from(signatureHex, 'hex');
  return a.length === b.length && timingSafeEqual(a, b);
}`}</code></pre>
      <p>The SDK exports <code>verifyWebhook</code> which does this for you.</p>

      <h2>Event types</h2>
      <h3><code>invoice.paid</code></h3>
      <p>Fires when the indexer sees <code>InvoicePaid</code> on-chain.</p>
      <pre><code>{`{
  "event_id":   "8a7e1c2b-...",
  "type":       "invoice.paid",
  "invoice_id": "0x4f3a...",
  "paid_by":    "0x3687...",
  "tx_hash":    "0x9f...",
  "metadata":   { "orderId": "123" }
}`}</code></pre>

      <h3><code>invoice.refunded</code></h3>
      <p>Fires when the indexer sees <code>InvoiceRefunded</code> on-chain.</p>
      <pre><code>{`{
  "event_id":    "...",
  "type":        "invoice.refunded",
  "invoice_id":  "0x...",
  "refunded_to": "0x...",
  "tx_hash":     "0x..."
}`}</code></pre>

      <h3><code>compliance.review_queued</code></h3>
      <p>
        Fires when <code>/api/checkout/authorize</code> returns <code>review</code> for a customer wallet (Plan-5).
        Merchant is notified out-of-band so they can follow up with the buyer if they want to.
      </p>
      <pre><code>{`{
  "event_id":   "...",
  "type":       "compliance.review_queued",
  "invoice_id": "0x...",
  "payer":      "0x...",
  "ticket_id":  "rev_..."
}`}</code></pre>

      <h2>Retry policy</h2>
      <p>Failed deliveries (non-2xx, network error, timeout) are retried with exponential backoff:</p>
      <ul>
        <li>Attempt 1: immediate</li>
        <li>Attempt 2: +1 min</li>
        <li>Attempt 3: +5 min</li>
        <li>Attempt 4: +15 min</li>
        <li>Attempt 5: +30 min total</li>
        <li>After 5 failed attempts the row stops being retried.</li>
      </ul>
      <p>
        If your endpoint is down longer than 30 minutes, fetch missed events via the API by querying invoice status directly.
      </p>

      <h2>Idempotency</h2>
      <p>
        <code>event_id</code> is a UUID generated server-side at enqueue time. If you receive the same{" "}
        <code>event_id</code> twice (rare — usually only happens if your endpoint times out but eventually returns 2xx),
        treat it as idempotent.
      </p>
    </DocsShell>
  );
}
