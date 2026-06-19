import { describe, it, expect, beforeEach, vi } from "vitest";

// Mock the DB + compliance so createInvoiceV2 is a pure unit under test.
const h = vi.hoisted(() => ({ idemRows: [] as { id: string }[], inserts: [] as unknown[] }));
vi.mock("@/lib/db/client", () => ({
  db: {
    select: () => ({ from: () => ({ where: () => ({ limit: async () => h.idemRows }) }) }),
    insert: () => ({ values: async (v: unknown) => { h.inserts.push(v); } }),
  },
}));
vi.mock("@/lib/compliance/screen", () => ({ screenWithAudit: async () => ({ decision: "allow" }) }));
vi.mock("@/lib/compliance/factory", () => ({ resolveComplianceProvider: () => ({}), complianceRequired: () => false }));

import { createInvoiceV2, type V2Merchant } from "./createInvoice";

const BASE = 84532; // Base Sepolia — has deployed v2 contracts in the registry
const merchant = (over: Partial<V2Merchant> = {}): V2Merchant => ({
  id: "m1", address: "0xMERCH", payoutChainId: BASE, payoutAddress: "0xPAYOUT", payoutCurrency: "USDC", ...over,
});

beforeEach(() => { h.idemRows = []; h.inserts = []; });

describe("createInvoiceV2", () => {
  it("400 when merchant has no v2 payout config", async () => {
    const r = await createInvoiceV2(merchant({ payoutChainId: null }), { amount: "10" }, null, "https://x");
    expect(r.http).toBe(400);
    expect((r.body as { error: string }).error).toBe("merchant_payout_not_configured");
  });

  it("400 when the payout chain has no deployed v2 contracts", async () => {
    const r = await createInvoiceV2(merchant({ payoutChainId: 999 }), { amount: "10" }, null, "https://x");
    expect(r.http).toBe(400);
    expect((r.body as { error: string }).error).toBe("payout_chain_unsupported");
  });

  it("400 on a malformed amount", async () => {
    const r = await createInvoiceV2(merchant(), { amount: "abc" }, null, "https://x");
    expect(r.http).toBe(400);
    expect((r.body as { error: string }).error).toBe("bad_amount");
  });

  it("returns the existing invoice on an Idempotency-Key hit (no new insert)", async () => {
    h.idemRows = [{ id: "0xEXISTING" }];
    const r = await createInvoiceV2(merchant(), { amount: "10" }, "idem-1", "https://x");
    expect(r.http).toBe(201);
    expect((r.body as { invoiceId: string }).invoiceId).toBe("0xEXISTING");
    expect(h.inserts).toHaveLength(0);
  });

  it("creates an invoice + settlement row on success", async () => {
    const r = await createInvoiceV2(merchant(), { amount: "49.99", currency: "EURC" }, "idem-2", "https://x");
    expect(r.http).toBe(201);
    const body = r.body as { invoiceId: string; url: string; amount: string; currency: string };
    expect(body.invoiceId).toMatch(/^0x[0-9a-f]{64}$/);
    expect(body.url).toBe(`https://x/i/${body.invoiceId}`);
    expect(body.amount).toBe("49.99");
    expect(body.currency).toBe("EURC");
    // one invoices insert + one settlements insert
    expect(h.inserts).toHaveLength(2);
    const settlement = h.inserts[1] as { amount: string; payoutToken: string; state: string };
    expect(settlement.amount).toBe("49990000"); // 49.99 USDC in minor units
    expect(settlement.payoutToken).toBe("EURC");
    expect(settlement.state).toBe("AWAITING_DEPOSIT");
  });
});
