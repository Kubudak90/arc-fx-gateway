// packages/agent-commerce-cli/src/lib/config-writer.ts
export interface McpServerEntry {
  command: string;
  args: string[];
  env: Record<string, string>;
}

const PACKAGE = "@arcora/agent-commerce";

export function mcpServerEntry(opts: { apiKey: string; baseUrl: string }): McpServerEntry {
  return {
    command: "npx",
    args: ["-y", PACKAGE, "serve"],
    env: { ARCORA_API_KEY: opts.apiKey, ARCORA_BASE_URL: opts.baseUrl },
  };
}

/** Generic MCP config (Hermes & Claude both use a top-level `mcpServers` map). */
export function renderConfigs(entry: McpServerEntry): { generic: string } {
  const generic = JSON.stringify({ mcpServers: { "arcora-commerce": entry } }, null, 2);
  return { generic };
}
