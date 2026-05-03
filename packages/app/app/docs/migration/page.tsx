import { DocsShell } from "@/components/docs/DocsShell";

export const metadata = {
  title: "Migration · v0.6 → v0.8 · Arcora docs",
  description: "How to move existing integrations from the legacy v0.6 gateway to the v0.8 (relayer-driven) flow.",
};

export default function MigrationDocs() {
  return (
    <DocsShell
      currentPath="/docs/migration"
      title="Migration · v0.6 → v0.8"
      description="How to move existing integrations from the legacy v0.6 gateway to the v0.8 (relayer-driven) flow."
    >
      <p>
        Gateway v0.6 (<code>0x7c1137…b7a3</code>) and v0.8 (<code>0x6fAaD9…507a8</code>) both run on Arc Testnet today.
        v0.6 is in maintenance — we keep its events indexed for legacy invoice lookup but no new traffic should land there.
      </p>

      <h2>What changed</h2>
      <table>
        <thead><tr><th></th><th>v0.6</th><th>v0.8</th></tr></thead>
        <tbody>
          <tr><td>Customer side</td><td><code>pay()</code> on-chain tx with USDC/EURC + ERC-20 approve</td><td>One Permit2 EIP-712 signature, gas-less</td></tr>
          <tr><td>Swap path</td><td>In-house OracleAMM/StablePool</td><td>Circle App Kit Swap (off-chain RFQ, on-chain settle via FxEscrow)</td></tr>
          <tr><td>Settlement</td><td>Atomic in <code>pay()</code></td><td>Two-step: relayer pulls + swaps + calls <code>settleInvoice</code></td></tr>
          <tr><td>Failure mode</td><td><code>pay()</code> reverts; customer sees error</td><td>Refund branch off-chain (<code>recordPayerRefund</code> marks invoice <code>Failed</code>)</td></tr>
          <tr><td>Token whitelist</td><td>Per-pair pool deployment</td><td><code>setTokenSupport(token)</code> mapping on the gateway</td></tr>
        </tbody>
      </table>

      <h2>Migration steps</h2>
      <h3>For merchants on the hosted checkout</h3>
      <ol>
        <li>Re-register your merchant on <code>ArcFXGatewayV8</code> from <code>/m/settings</code> → &quot;Re-register on V8&quot;. One signature; takes ~10s.</li>
        <li>Create new invoices with <code>?engine=v8</code> query (or via dashboard &quot;Create invoice&quot; — already V8-default).</li>
        <li>Old v0.6 invoices stay queryable; they continue to settle if a customer pays.</li>
      </ol>

      <h3>For SDK users</h3>
      <pre><code>{`const arcora = new Arcora({
  apiKey: process.env.ARCORA_API_KEY,
  engine: 'v8',  // 👈 new
});`}</code></pre>
      <p>
        That&apos;s the entire change. The invoice creation API is identical; the difference is the on-chain target gateway.
      </p>

      <h3>Webhooks</h3>
      <p>
        Payload shape is unchanged across both gateways — the indexer normalizes events. You receive <code>invoice.paid</code> /{" "}
        <code>invoice.refunded</code> regardless of which gateway saw the on-chain event.
      </p>

      <h2>Rollback</h2>
      <p>
        If V8 has an issue and you need to fall back temporarily, drop the <code>?engine=v8</code> query parameter (or{" "}
        <code>engine: &apos;v8&apos;</code> SDK arg). Your invoices land on v0.6 again. We&apos;ll publish a notice if v0.8 is
        ever pulled offline; otherwise both run in parallel until we deprecate v0.6 fully (no date pinned).
      </p>
    </DocsShell>
  );
}
