// packages/agent-commerce-mcp/src/index.ts
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { Commerce, loadConfig } from "@arcora/agent-commerce-core";
import { buildServer } from "./server.js";

async function main(): Promise<void> {
  const commerce = new Commerce(loadConfig());
  const server = buildServer(commerce);
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
