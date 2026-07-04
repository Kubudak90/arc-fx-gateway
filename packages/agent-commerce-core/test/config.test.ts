// packages/agent-commerce-core/test/config.test.ts
import { describe, it, expect } from "vitest";
import { loadConfig } from "../src/config";

describe("loadConfig", () => {
  it("throws when ARCORA_API_KEY is missing", () => {
    expect(() => loadConfig({})).toThrow(/ARCORA_API_KEY/);
  });

  it("defaults baseUrl and successUrl", () => {
    const c = loadConfig({ ARCORA_API_KEY: "ak_live_x" });
    expect(c.apiKey).toBe("ak_live_x");
    expect(c.baseUrl).toBe("https://arcorapay.xyz");
    expect(c.successUrl).toBe("https://arcorapay.xyz/thanks");
  });

  it("reads provided baseUrl and successUrl", () => {
    const c = loadConfig({
      ARCORA_API_KEY: "ak_live_x",
      ARCORA_BASE_URL: "http://localhost:3000",
      ARCORA_SUCCESS_URL: "http://localhost:3001/ok",
    });
    expect(c.baseUrl).toBe("http://localhost:3000");
    expect(c.successUrl).toBe("http://localhost:3001/ok");
  });
});
