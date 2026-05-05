import { DocsShell } from "@/components/docs/DocsShell";

export const metadata = {
  title: "Migration · v0.6 → v0.9 · Arcora docs",
  description: "How to move existing integrations from the legacy v0.6 / v0.8 gateways to v0.9 (refund-source binding).",
};

export default function MigrationDocs() {
  return (
    <DocsShell
      currentPath="/docs/migration"
      title="Migration · v0.6 → v0.9"
      description="How to move existing integrations from the legacy v0.6 / v0.8 gateways to v0.9 (refund-source binding)."
    >
      <p>
        v0.9 (<code>0xdf6233…ea21</code>) is the canonical gateway as of 2026-05-03.
        v0.8 (<code>0x6fAaD9…507a8</code>) and v0.6 (<code>0x7c1137…b7a3</code>) remain indexed for
        in-flight refunds and historical lookups, but no new traffic should land there.
      </p>

      <h2>What changed</h2>
      <table>
        <thead><tr><th></th><th>v0.6</th><th>v0.8</th><th>v0.9</th></tr></thead>
        <tbody>
          <tr><td>Customer side</td><td><code>pay()</code> on-chain tx with USDC/EURC + ERC-20 approve</td><td colSpan={2}>One Permit2 EIP-712 signature, gas-less</td></tr>
          <tr><td>Swap path</td><td>In-house OracleAMM/StablePool</td><td colSpan={2}>Circle App Kit Swap (off-chain RFQ, on-chain settle)</td></tr>
          <tr><td>Settlement</td><td>Atomic in <code>pay()</code></td><td colSpan={2}>Two-step: relayer pulls + swaps + calls <code>settleInvoice</code></td></tr>
          <tr><td>Refund source</td><td>From merchant identity</td><td>From merchant identity</td><td>From the snapshotted <code>payoutSource</code> (split-wallet safe)</td></tr>
          <tr><td>Token whitelist</td><td>Per-pair pool deployment</td><td colSpan={2}><code>setTokenSupport(token)</code> mapping on the gateway</td></tr>
        </tbody>
      </table>

      <h2>Migration steps</h2>
      <h3>For merchants on the hosted checkout</h3>
      <ol>
        <li>Visit <code>/m/settings</code> → <strong>On-chain authorization</strong>. Click &quot;Register on-chain&quot; (if not yet) and &quot;Authorize delegate&quot;. One signature each; takes ~10s.</li>
        <li>Create new invoices via the dashboard &quot;Create invoice&quot; or the API — both default to <code>?engine=v9</code> already.</li>
        <li>Old v0.6 / v0.8 invoices stay queryable; they continue to settle if a customer pays and remain refundable through their original gateway.</li>
      </ol>

      <h3>For SDK users</h3>
      <pre><code>{`const arcora = new Arcora({
  apiKey: process.env.ARCORA_API_KEY,
  // engine defaults to 'v9' since 2026-05-03. Pass 'v8' or 'v6'
  // explicitly only for legacy traffic / testing.
});`}</code></pre>
      <p>
        That&apos;s the entire change. The invoice creation API is identical; the difference is the on-chain target gateway.
      </p>

      <h3>Webhooks</h3>
      <p>
        Payload shape is unchanged across all three gateways — the indexer normalizes events. You receive <code>invoice.paid</code> /{" "}
        <code>invoice.refunded</code> regardless of which gateway saw the on-chain event.
      </p>

      <h2>Rollback</h2>
      <p>
        If v9 has an issue and you need to fall back temporarily, set <code>?engine=v8</code> on the API call (or{" "}
        <code>engine: &apos;v8&apos;</code> SDK arg). Invoices land on v0.8 again. We&apos;ll publish a notice if v0.9 is
        ever pulled offline; otherwise all three gateways run in parallel until we deprecate the older ones fully (no date pinned).
      </p>
    </DocsShell>
  );
}
