// packages/agent-commerce-core/test/commerce.test.ts
import { describe, it, expect, vi, afterEach } from "vitest";
import { Commerce } from "../src/commerce";
import type { CommerceConfig } from "../src/config";

const config: CommerceConfig = {
  apiKey: "ak_live_x",
  baseUrl: "https://arcorapay.xyz",
  successUrl: "https://arcorapay.xyz/thanks",
};

afterEach(() => vi.restoreAllMocks());

function mockFetch(status: number, body: unknown) {
  return vi.spyOn(globalThis, "fetch").mockResolvedValue(
    new Response(JSON.stringify(body), {
      status,
      headers: { "content-type": "application/json" },
    }),
  );
}

describe("Commerce.createInvoiceForItem", () => {
  it("creates an invoice for a known item with correct SDK params", async () => {
    const createInvoice = vi
      .fn()
      .mockResolvedValue({ invoiceId: "0xabc", url: "https://arcorapay.xyz/i/0xabc" });
    const commerce = new Commerce(config, { createInvoice });
    const item = commerce.listCatalog()[0]!;

    const result = await commerce.createInvoiceForItem(item.id);

    expect(result.invoiceId).toBe("0xabc");
    expect(result.url).toBe("https://arcorapay.xyz/i/0xabc");
    expect(result.item.id).toBe(item.id);
    expect(createInvoice).toHaveBeenCalledWith({
      amountUsdc: item.priceUsdc,
      payInToken: "USDC",
      successUrl: config.successUrl,
      metadata: { itemId: item.id, itemName: item.name },
    });
  });

  it("throws for an unknown item", async () => {
    const commerce = new Commerce(config, { createInvoice: vi.fn() });
    await expect(commerce.createInvoiceForItem("nope")).rejects.toThrow(/unknown_item/);
  });
});

describe("Commerce.getCheckoutStatus", () => {
  const commerce = new Commerce(config, { createInvoice: vi.fn() });

  it("maps paid / created / expired", async () => {
    mockFetch(200, { status: "paid" });
    expect(await commerce.getCheckoutStatus("0x1")).toBe("paid");
    mockFetch(200, { status: "created" });
    expect(await commerce.getCheckoutStatus("0x1")).toBe("created");
    mockFetch(200, { status: "expired" });
    expect(await commerce.getCheckoutStatus("0x1")).toBe("expired");
  });

  it("returns unknown on 404", async () => {
    mockFetch(404, { error: "not_found" });
    expect(await commerce.getCheckoutStatus("0x1")).toBe("unknown");
  });

  it("throws on a 5xx", async () => {
    mockFetch(500, {});
    await expect(commerce.getCheckoutStatus("0x1")).rejects.toThrow(/status_lookup_failed/);
  });

  it("calls the public invoice endpoint", async () => {
    const spy = mockFetch(200, { status: "created" });
    await commerce.getCheckoutStatus("0xfeed");
    expect(spy).toHaveBeenCalledWith("https://arcorapay.xyz/api/invoices/0xfeed");
  });

  it("maps claimed → paid (escrow pulled = success)", async () => {
    mockFetch(200, { status: "claimed" });
    expect(await commerce.getCheckoutStatus("0x1")).toBe("paid");
  });

  it("maps refunded → refunded and failed → failed", async () => {
    mockFetch(200, { status: "refunded" });
    expect(await commerce.getCheckoutStatus("0x1")).toBe("refunded");
    mockFetch(200, { status: "failed" });
    expect(await commerce.getCheckoutStatus("0x1")).toBe("failed");
  });

  it("maps recovered / unrecognized / missing status → unknown", async () => {
    mockFetch(200, { status: "recovered" });
    expect(await commerce.getCheckoutStatus("0x1")).toBe("unknown");
    mockFetch(200, {});
    expect(await commerce.getCheckoutStatus("0x1")).toBe("unknown");
  });

  it("normalizes a network error to status_lookup_failed:network", async () => {
    vi.spyOn(globalThis, "fetch").mockRejectedValue(new TypeError("fetch failed"));
    await expect(commerce.getCheckoutStatus("0x1")).rejects.toThrow(/status_lookup_failed:network/);
  });
});
