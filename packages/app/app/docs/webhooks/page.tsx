import { DocsShell } from "@/components/docs/DocsShell";

export const metadata = {
  title: "Webhooks · Arcorapay docs",
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
        Every delivery is dual-signed. Both signature headers carry a <code>sha256=</code> prefix followed by the
        lowercase hex HMAC — the prefix is part of the header value, so compare against it, do not strip it before
        you have a constant-time match.
      </p>
      <ul>
        <li>
          <code>X-Arcora-Signature</code> (legacy) — <code>sha256=HMAC-SHA256(rawBody, secret)</code>.
        </li>
        <li>
          <code>X-Arcora-Signature-V2</code> — <code>sha256=HMAC-SHA256(&quot;&lt;timestamp&gt;.&quot; + rawBody, secret)</code>,
          paired with <code>X-Arcora-Timestamp</code> (unix seconds). Binding the timestamp into the signed payload
          gives you replay protection: reject any delivery whose timestamp is outside a tolerance window
          (we use <strong>±300 seconds</strong>).
        </li>
      </ul>
      <p>
        <strong>Prefer V2 when both are present.</strong> The legacy header has no timestamp, so a captured legacy
        delivery can be replayed indefinitely — only V2 closes that. Verify before trusting:
      </p>
      <pre><code>{`import { createHmac, timingSafeEqual } from 'node:crypto';

const TOLERANCE_SECONDS = 300; // ±5 min replay window

// Both headers are 'sha256=<hex>'. Compare the whole value in constant time.
function safeEqual(a: string, b: string) {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  return ab.length === bb.length && timingSafeEqual(ab, bb);
}

function verifyWebhook(headers: Headers, rawBody: string, secret: string) {
  const sigV2 = headers.get('x-arcora-signature-v2');
  const ts    = headers.get('x-arcora-timestamp');

  // Prefer V2: timestamp-bound, replay-protected.
  if (sigV2 && ts) {
    const tsNum = Number(ts);
    if (!Number.isFinite(tsNum) || Math.abs(Date.now() / 1000 - tsNum) > TOLERANCE_SECONDS) {
      return false; // outside the replay window
    }
    const expected = 'sha256=' + createHmac('sha256', secret).update(ts + '.' + rawBody).digest('hex');
    return safeEqual(expected, sigV2);
  }

  // Legacy fallback (no replay protection): sha256=HMAC(rawBody).
  const sig = headers.get('x-arcora-signature') ?? '';
  const expected = 'sha256=' + createHmac('sha256', secret).update(rawBody).digest('hex');
  return safeEqual(expected, sig);
}`}</code></pre>
      <p>
        Verification deliberately stays out of the SDK — the snippet above is all you need, and it works in any
        runtime with Node&apos;s <code>crypto</code> (or the equivalent HMAC in your language of choice).
      </p>

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
