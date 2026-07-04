import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { mcpServerEntry, renderConfigsMasked } from "../src/lib/config-writer";
import { PKG_VERSION } from "../src/constants";

describe("mcpServerEntry", () => {
  it("builds an npx-based MCP server entry with the api key + base url in env", () => {
    const e = mcpServerEntry({ apiKey: "ak_live_x", baseUrl: "https://arcorapay.xyz" });
    expect(e.command).toBe("npx");
    expect(e.args).toEqual(["-y", `@arcora/agent-commerce@${PKG_VERSION}`, "serve"]);
    expect(e.env.ARCORA_API_KEY).toBe("ak_live_x");
    expect(e.env.ARCORA_BASE_URL).toBe("https://arcorapay.xyz");
  });

  it("pins the EXACT package version, kept in sync with package.json (2026-07-04)", () => {
    const pkg = JSON.parse(readFileSync(join(__dirname, "..", "package.json"), "utf8")) as { version: string };
    expect(PKG_VERSION).toBe(pkg.version);
  });

  it("masks the api key in the stdout render (2026-07-04)", () => {
    const e = mcpServerEntry({ apiKey: "ak_live_0123456789abcdef", baseUrl: "https://arcorapay.xyz" });
    const masked = renderConfigsMasked(e);
    expect(masked).not.toContain("ak_live_0123456789abcdef");
    expect(masked).toContain("ak_live_0123…");
  });
});
