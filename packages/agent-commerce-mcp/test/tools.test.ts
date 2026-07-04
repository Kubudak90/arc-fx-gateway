// packages/agent-commerce-mcp/test/tools.test.ts
import { describe, it, expect, vi } from "vitest";
import { listCatalogTool, createInvoiceTool, checkoutStatusTool, refundInvoiceTool } from "../src/tools";
import { buildServer } from "../src/server";
import { RefundGuard } from "../src/refund-guard";

const fakeItem = { id: "logo-pack", name: "AI Logo Pack", description: "x", priceUsdc: 5, emoji: "🎨" };

function fakeCommerce(overrides = {}) {
  return {
    listCatalog: () => [fakeItem],
    createInvoiceForItem: vi.fn().mockResolvedValue({ invoiceId: "0xabc", url: "https://arcorapay.xyz/i/0xabc", item: fakeItem }),
    getCheckoutStatus: vi.fn().mockResolvedValue("paid"),
    ...overrides,
  };
}

/** Read the private registered-tools map (no public listing API on McpServer). */
function registeredToolNames(server: unknown): string[] {
  return Object.keys((server as { _registeredTools: Record<string, unknown> })._registeredTools);
}

describe("listCatalogTool", () => {
  it("returns text listing each item id, name and price", async () => {
    const r = await listCatalogTool(fakeCommerce());
    expect(r.isError).toBeUndefined();
    const text = r.content[0]!.text;
    expect(text).toContain("logo-pack");
    expect(text).toContain("AI Logo Pack");
    expect(text).toContain("5");
  });
});

describe("createInvoiceTool", () => {
  it("returns the invoice id and checkout url on success", async () => {
    const r = await createInvoiceTool(fakeCommerce(), { itemId: "logo-pack" });
    expect(r.isError).toBeUndefined();
    expect(r.content[0]!.text).toContain("0xabc");
    expect(r.content[0]!.text).toContain("https://arcorapay.xyz/i/0xabc");
  });

  it("returns isError with the message when the item is unknown", async () => {
    const commerce = fakeCommerce({
      createInvoiceForItem: vi.fn().mockRejectedValue(new Error("unknown_item:nope")),
    });
    const r = await createInvoiceTool(commerce, { itemId: "nope" });
    expect(r.isError).toBe(true);
    expect(r.content[0]!.text).toContain("unknown_item:nope");
  });
});

describe("checkoutStatusTool", () => {
  it("returns the status text", async () => {
    const r = await checkoutStatusTool(fakeCommerce(), { invoiceId: "0xabc" });
    expect(r.content[0]!.text).toContain("paid");
  });

  it("returns isError when the lookup throws", async () => {
    const commerce = fakeCommerce({
      getCheckoutStatus: vi.fn().mockRejectedValue(new Error("status_lookup_failed:500")),
    });
    const r = await checkoutStatusTool(commerce, { invoiceId: "0xabc" });
    expect(r.isError).toBe(true);
    expect(r.content[0]!.text).toContain("status_lookup_failed:500");
  });
});

describe("refundInvoiceTool", () => {
  it("formats the refund tx hash and status on success", async () => {
    const refunder = { refund: vi.fn().mockResolvedValue({ invoiceId: "0x" + "a".repeat(64), txHash: "0x" + "b".repeat(64), status: "success" }) };
    const r = await refundInvoiceTool(refunder, { invoiceId: "0x" + "a".repeat(64) });
    expect(r.isError).toBeUndefined();
    expect(r.content[0]!.text).toContain("0x" + "b".repeat(64));
    expect(r.content[0]!.text).toContain("success");
    expect(refunder.refund).toHaveBeenCalledWith("0x" + "a".repeat(64));
  });

  it("surfaces the error message via isError when refund throws", async () => {
    const refunder = { refund: vi.fn().mockRejectedValue(new Error("invalid_invoice_id")) };
    const r = await refundInvoiceTool(refunder, { invoiceId: "bad" });
    expect(r.isError).toBe(true);
    expect(r.content[0]!.text).toContain("invalid_invoice_id");
  });
});

describe("RefundGuard (Audit M6 — refund authorization boundary)", () => {
  const ID_A = "0x" + "a".repeat(64);
  const ID_B = "0x" + "b".repeat(64);

  it("refuses an invoice not created in this session (blocks injected arbitrary ids)", () => {
    const guard = new RefundGuard();
    const v = guard.check(ID_A);
    expect(v.ok).toBe(false);
    if (!v.ok) expect(v.reason).toContain("not_in_session");
  });

  it("allows a refund for an invoice this session created", () => {
    const guard = new RefundGuard();
    guard.recordCreated(ID_A);
    expect(guard.check(ID_A)).toEqual({ ok: true });
  });

  it("matches ids case-insensitively", () => {
    const guard = new RefundGuard();
    guard.recordCreated(ID_A.toUpperCase());
    expect(guard.check(ID_A.toLowerCase()).ok).toBe(true);
  });

  it("does not consume a rate-limit slot on a refused (not-in-session) check", () => {
    let t = 1_000;
    const guard = new RefundGuard({ maxPerWindow: 1, now: () => t });
    guard.recordCreated(ID_A);
    // 10 refused attempts for an unknown id must not exhaust the budget...
    for (let i = 0; i < 10; i++) expect(guard.check(ID_B).ok).toBe(false);
    // ...the one allowed refund still goes through.
    expect(guard.check(ID_A).ok).toBe(true);
  });

  it("rate-limits allowed refunds within the window, then recovers after it passes", () => {
    let t = 1_000;
    const guard = new RefundGuard({ maxPerWindow: 2, windowMs: 60_000, now: () => t });
    guard.recordCreated(ID_A);
    expect(guard.check(ID_A).ok).toBe(true); // 1
    expect(guard.check(ID_A).ok).toBe(true); // 2
    const limited = guard.check(ID_A); // 3 → over limit
    expect(limited.ok).toBe(false);
    if (!limited.ok) expect(limited.reason).toContain("rate_limited");
    t += 60_001; // advance past the window
    expect(guard.check(ID_A).ok).toBe(true);
  });
});

describe("buildServer tool registration", () => {
  it("registers exactly the 3 base tools when no refunder is provided", () => {
    const server = buildServer(fakeCommerce() as never);
    const names = registeredToolNames(server);
    expect(names).toContain("list_catalog");
    expect(names).toContain("create_invoice");
    expect(names).toContain("get_checkout_status");
    expect(names).not.toContain("refund_invoice");
  });

  it("registers refund_invoice when a refunder is provided", () => {
    const refunder = { refund: vi.fn() };
    const server = buildServer(fakeCommerce() as never, { refunder } as never);
    expect(registeredToolNames(server)).toContain("refund_invoice");
  });
});
