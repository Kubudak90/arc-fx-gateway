import Link from "next/link";
import type { Route } from "next";
import { DocsShell } from "@/components/docs/DocsShell";

export const metadata = {
  title: "Agents & MCP · Arcorapay docs",
  description:
    "@arcora/agent-commerce — let any MCP-capable agent onboard as a merchant and sell over the Model Context Protocol.",
};

export default function AgentsDocs() {
  return (
    <DocsShell
      currentPath="/docs/agents"
      title="Agents & MCP"
      description="@arcora/agent-commerce — let any MCP-capable agent onboard as a merchant and sell over the Model Context Protocol."
    >
      <p>
        <code>@arcora/agent-commerce</code> is a CLI that turns an AI agent into an Arcora merchant. There&apos;s no
        global install and nothing to scaffold — <code>npx</code> the <code>onboard</code> command once to provision a
        wallet and API key, then <code>serve</code> exposes Arcora&apos;s checkout as a set of{" "}
        <a href="https://modelcontextprotocol.io" target="_blank" rel="noopener noreferrer">Model Context Protocol</a>{" "}
        tools that any MCP-capable agent (Claude, Hermes, custom agents) can call. It runs on <strong>Arc testnet</strong>,
        the same rails as the rest of Arcora.
      </p>
      <p>
        Published on npm as <code>@arcora/agent-commerce</code> (referenced below as <code>latest</code>). Pin a specific
        version in production agents for reproducible runs.
      </p>

      <h2>1. Onboard</h2>
      <pre><code>{`npx -y @arcora/agent-commerce onboard`}</code></pre>
      <p>
        <code>onboard</code> generates a fresh wallet (or imports one you supply), then waits for that wallet to be
        funded with Arc gas — grab testnet gas from{" "}
        <a href="https://faucet.circle.com" target="_blank" rel="noopener noreferrer">faucet.circle.com</a>. Once funded
        it runs a <strong>SIWE</strong> bootstrap to mint your secret <code>ak_live_</code> API key, registers the wallet
        as a merchant on-chain and authorizes the server delegate, and writes <code>~/.arcora/mcp-config.json</code> with
        the key and merchant address so <code>serve</code> can pick them up.
      </p>

      <h2>2. Serve — the MCP server</h2>
      <pre><code>{`npx -y @arcora/agent-commerce serve`}</code></pre>
      <p>
        <code>serve</code> starts a <strong>stdio</strong> MCP server. It advertises these tools:
      </p>
      <table>
        <thead>
          <tr><th>Tool</th><th>Args</th><th>What it does</th></tr>
        </thead>
        <tbody>
          <tr><td><code>list_catalog</code></td><td>—</td><td>Returns the merchant&apos;s catalog items (id, title, price).</td></tr>
          <tr><td><code>create_invoice</code></td><td><code>itemId</code></td><td>Creates an Arcora invoice for a catalog item and returns the hosted-checkout URL.</td></tr>
          <tr><td><code>get_checkout_status</code></td><td><code>invoiceId</code></td><td>Polls settlement state for an invoice.</td></tr>
          <tr><td><code>refund_invoice</code></td><td><code>invoiceId</code></td><td>Refunds a settled invoice. Only active when <code>ARCORA_MERCHANT_KEY</code> is set, and funds return <strong>only</strong> to the original payer.</td></tr>
        </tbody>
      </table>
      <p>
        Refunds are deliberately guarded: <code>refund_invoice</code> is only wired when your secret{" "}
        <code>ARCORA_MERCHANT_KEY</code> (an <code>ak_live_</code> key) is present in the server environment — without it
        the tool is inert. And a refund can never be redirected: it always sends funds back to the wallet that paid the
        invoice, so a compromised or over-eager agent can&apos;t drain to an arbitrary address.
      </p>

      <h2>3. Wire it into an MCP host</h2>
      <p>
        <code>serve</code> speaks stdio, so it drops into any MCP host — Claude Desktop, or any other MCP-capable agent
        runtime. Point the host at the command and pass your merchant key in the env:
      </p>
      <pre><code>{`{
  "mcpServers": {
    "arcora": {
      "command": "npx",
      "args": ["-y", "@arcora/agent-commerce", "serve"],
      "env": {
        "ARCORA_MERCHANT_KEY": "ak_live_..."
      }
    }
  }
}`}</code></pre>
      <p>
        With that in place, the agent can list the catalog, mint a checkout link for a buyer, watch it settle, and (with
        the merchant key set) issue refunds — all as ordinary tool calls. It works with any MCP host; nothing is
        Claude-specific.
      </p>

      <h2>How it relates to the SDK</h2>
      <p>
        Under the hood the CLI is the same Arcora checkout you&apos;d reach from the{" "}
        <Link href={"/docs/sdk" as Route}>SDK</Link> or the <Link href={"/docs/rest-api" as Route}>REST API</Link> — it
        just packages onboarding, key management, and an MCP surface so an agent can transact without you writing any
        integration code. Invoices, webhooks, and refunds behave exactly as documented elsewhere in these docs.
      </p>

      <h2>Source</h2>
      <ul>
        <li>GitHub: <a href="https://github.com/Kubudak90/agent-commerce" target="_blank" rel="noopener noreferrer">github.com/Kubudak90/agent-commerce</a></li>
        <li>npm: <a href="https://www.npmjs.com/package/@arcora/agent-commerce" target="_blank" rel="noopener noreferrer">npmjs.com/package/@arcora/agent-commerce</a></li>
      </ul>
    </DocsShell>
  );
}
