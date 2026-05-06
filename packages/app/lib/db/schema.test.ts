import { describe, it, expect } from "vitest";
import { merchants, invoices, webhookAttempts } from "./schema";

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
  // Audit H5 (2026-05-05): the indexer dedupes webhook_attempts via
  // (invoice_id, event_type) — `eventType` must exist as a NOT NULL column
  // for the `ON CONFLICT (invoice_id, event_type) DO NOTHING` insert path.
  it("webhookAttempts exposes eventType column required for dedupe", () => {
    expect(webhookAttempts.eventType).toBeDefined();
    expect(webhookAttempts.eventType.name).toBe("event_type");
    expect(webhookAttempts.eventType.notNull).toBe(true);
  });
});
