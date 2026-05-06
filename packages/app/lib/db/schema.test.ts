import { describe, it, expect } from "vitest";
import { merchants, invoices } from "./schema";

describe("schema", () => {
  it("merchants table has expected columns", () => {
    expect(merchants.address).toBeDefined();
    expect(merchants.apiKeyHash).toBeDefined();
    expect(merchants.webhookSecretEnc).toBeDefined();
  });
  it("invoices table is defined with status enum column", () => {
    expect(invoices.status).toBeDefined();
  });
  it("merchants table exposes apiKeyPrefix and allowedOrigins", () => {
    expect(merchants.apiKeyPrefix.name).toBe("api_key_prefix");
    expect(merchants.allowedOrigins.name).toBe("allowed_origins");
  });
});
