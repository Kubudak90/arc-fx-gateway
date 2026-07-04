import { describe, it, expect } from "vitest";
import { mcpServerEntry } from "../src/lib/config-writer";

describe("mcpServerEntry", () => {
  it("builds an npx-based MCP server entry with the api key + base url in env", () => {
    const e = mcpServerEntry({ apiKey: "ak_live_x", baseUrl: "https://arcorapay.xyz" });
    expect(e.command).toBe("npx");
    expect(e.args).toEqual(["-y", "@arcora/agent-commerce", "serve"]);
    expect(e.env.ARCORA_API_KEY).toBe("ak_live_x");
    expect(e.env.ARCORA_BASE_URL).toBe("https://arcorapay.xyz");
  });
});
