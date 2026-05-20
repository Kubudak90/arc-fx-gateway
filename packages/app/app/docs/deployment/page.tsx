import { DocsShell } from "@/components/docs/DocsShell";

export const metadata = {
  title: "Self-host & deploy · Arcora docs",
  description: "Stand up your own Arcora — env vars, infra, and the runbook.",
};

export default function DeploymentDocs() {
  return (
    <DocsShell
      currentPath="/docs/deployment"
      title="Self-host & deploy"
      description="Stand up your own Arcora — env vars, infra, and the runbook."
    >
      <p>
        The Arcora codebase is open source — <a href="https://github.com/Kubudak90/arc-fx-gateway">github.com/Kubudak90/arc-fx-gateway</a>.
        Most merchants will use the hosted version at <code>arcorapay.xyz</code>; if you need to self-host (compliance, branding, sovereignty), here&apos;s the shape.
      </p>

      <h2>Components</h2>
      <table>
        <thead><tr><th>Service</th><th>What it does</th></tr></thead>
        <tbody>
          <tr><td><code>packages/app</code> (Next.js on Vercel)</td><td>Hosted checkout, merchant dashboard, REST API</td></tr>
          <tr><td><code>packages/contracts</code> (Foundry)</td><td><code>ArcFXGatewayV10</code> custody-escrow gateway — the live deployment is the audit-fixed <strong>V11</strong> redeploy (<code>0x07BAC123…</code>, 2026-05-13); deployed via <code>script/DeployV10.s.sol</code></td></tr>
          <tr><td><code>ops/relayer</code> (single VPS)</td><td>Drains the Permit2 queue, runs <code>kit.swap</code>, calls <code>settleInvoice</code></td></tr>
          <tr><td><code>ops/indexer</code> (same VPS)</td><td>Watches gateway events, writes invoice status, enqueues webhooks</td></tr>
          <tr><td>Postgres (Neon or self-hosted)</td><td>Invoices, queue, merchant rows, compliance audit log</td></tr>
        </tbody>
      </table>

      <h2>Required env vars</h2>
      <h3>App (<code>packages/app</code>)</h3>
      <pre><code>{`POSTGRES_URL_NON_POOLING   Neon non-pooling URL (used by API + indexer)
POSTGRES_URL               Neon pooled URL (used by Vercel functions)
GATEWAY_ADDRESS            custody-escrow gateway (current ArcFXGateway address)
NEXT_PUBLIC_GATEWAY_ADDRESS    same address, exposed to client components
USDC_ADDRESS               on Arc
EURC_ADDRESS               on Arc
ARC_TESTNET_RPC            https://rpc.testnet.arc.network
NEXT_PUBLIC_RELAYER_ADDRESS the relayer EOA you'll fund
KIT_KEY                    Circle App Kit API key
PUBLIC_BASE_URL            https://yourdomain
SESSION_SECRET             32+ bytes random; for SIWE cookie sealing
WEBHOOK_SECRET_AES_KEY     32 bytes; encrypts merchant webhook secrets at rest`}</code></pre>
      <p>Optional (compliance):</p>
      <pre><code>{`COMPLIANCE_PROVIDER          noop | elliptic | trmlabs   (default noop)
COMPLIANCE_API_KEY           required for non-noop
COMPLIANCE_FAIL_OPEN_FOR_PAY     default false (fail-closed for customer pay)
COMPLIANCE_FAIL_OPEN_FOR_INVOICE default true  (fail-open for invoice creation)`}</code></pre>

      <h3>Relayer + indexer (VPS)</h3>
      <p>Same as app, plus:</p>
      <pre><code>{`RELAYER_PK             relayer wallet private key (encrypted in DB; ops/relayer derives)
INDEXER_TICK_MS        default 30000
INDEXER_REORG_BUFFER_BLOCKS  default 5
RELAYER_TICK_MS        default 5000`}</code></pre>

      <h2>Database</h2>
      <p>Drizzle migrations live at <code>packages/app/lib/db/migrations/</code>. Two-step apply:</p>
      <ol>
        <li><code>vercel env pull .env.production.local</code> (or copy your env)</li>
        <li><code>pnpm exec drizzle-kit migrate</code> from <code>packages/app</code></li>
      </ol>
      <p>
        If the <code>__drizzle_migrations</code> table is out of sync (manual SQL applied earlier), run the SQL files
        directly inside a transaction. See <code>memory/compliance_phase0.md</code> in the repo for the workflow.
      </p>

      <h2>Deploying the gateway</h2>
      <pre><code>{`cd packages/contracts
forge script script/DeployV10.s.sol \\
  --rpc-url $ARC_TESTNET_RPC \\
  --broadcast --slow --verify \\
  --verifier-url $ARC_EXPLORER_URL \\
  --etherscan-api-key $ARC_EXPLORER_KEY`}</code></pre>
      <p>
        Then verify with <code>cast receipt</code> and <code>cast code</code>. The full deploy checklist is at{" "}
        <a href="https://github.com/Kubudak90/arc-fx-gateway/blob/plan-1-protocol/docs/audit/deploy-checklist.md">
          docs/audit/deploy-checklist.md
        </a>{" "}
        — cover that before mainnet.
      </p>

      <h2>Operational reality</h2>
      <ul>
        <li><strong>Single-instance relayer</strong> — the canonical deploy runs one relayer on one VPS. Multi-relayer with rolling failover is on the v1.x ops list.</li>
        <li><strong>Foundry broadcast can lie on Arc testnet</strong> — always verify with <code>cast receipt</code> (status=1) AND <code>cast code &lt;addr&gt;</code> (non-empty bytecode).</li>
        <li><strong>Drizzle tracking on prod is empty</strong> — historical SQL was applied directly, so <code>drizzle-kit migrate</code> would try to re-apply 0000–0005. Backfill <code>__drizzle_migrations</code> once or keep applying SQL directly.</li>
      </ul>
    </DocsShell>
  );
}
