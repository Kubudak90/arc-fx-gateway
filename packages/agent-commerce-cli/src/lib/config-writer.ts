// packages/agent-commerce-cli/src/lib/config-writer.ts
import { PKG_VERSION } from "../constants";

export interface McpServerEntry {
  command: string;
  args: string[];
  env: Record<string, string>;
}

const PACKAGE = "@arcora/agent-commerce";

export function mcpServerEntry(opts: { apiKey: string; baseUrl: string }): McpServerEntry {
  return {
    command: "npx",
    // Audit LOW (2026-07-04): pin the exact version — this entry runs on every
    // agent start with the merchant secret in env, so an unpinned `npx -y`
    // would execute whatever latest became (one bad release = key exfil).
    args: ["-y", `${PACKAGE}@${PKG_VERSION}`, "serve"],
    env: { ARCORA_API_KEY: opts.apiKey, ARCORA_BASE_URL: opts.baseUrl },
  };
}

/** Generic MCP config (Hermes & Claude both use a top-level `mcpServers` map). */
export function renderConfigs(entry: McpServerEntry): { generic: string } {
  const generic = JSON.stringify({ mcpServers: { "arcora-commerce": entry } }, null, 2);
  return { generic };
}

/** The same config with the API key masked — safe for stdout/CI logs. */
export function renderConfigsMasked(entry: McpServerEntry): string {
  const masked = {
    ...entry,
    env: { ...entry.env, ARCORA_API_KEY: `${entry.env.ARCORA_API_KEY?.slice(0, 12) ?? ""}…` },
  };
  return JSON.stringify({ mcpServers: { "arcora-commerce": masked } }, null, 2);
}
