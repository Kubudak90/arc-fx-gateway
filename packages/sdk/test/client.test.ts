import { describe, it, expect, vi, beforeEach, afterAll } from "vitest";
import { ArcFX } from "../src";
import { ArcFXError } from "../src/error";

const ORIG_FETCH = globalThis.fetch;

beforeEach(() => {
  globalThis.fetch = vi.fn() as any;
  ArcFX.init({ apiKey: "ak_test_xxx", environment: "testnet" });
});

afterAll(() => { globalThis.fetch = ORIG_FETCH; });

describe("ArcFX.createInvoice", () => {
  it("posts to /api/invoices and returns the invoice", async () => {
    (globalThis.fetch as any).mockResolvedValue(
      new Response(JSON.stringify({ invoiceId: "0xabc", url: "https://x/i/0xabc" }), {
        status: 201,
        headers: { "content-type": "application/json" },
      })
    );
    const inv = await ArcFX.createInvoice({
      amountUsdc: 49.99,
      payInToken: "EURC",
      successUrl: "https://merchant.example/ok",
    });
    expect(inv).toEqual({ invoiceId: "0xabc", url: "https://x/i/0xabc" });
    const call = (globalThis.fetch as any).mock.calls[0];
    expect(call[1].method).toBe("POST");
    expect(call[1].headers["X-Arc-Api-Key"]).toBe("ak_test_xxx");
  });

  it("throws INVALID_API_KEY on 401", async () => {
    (globalThis.fetch as any).mockResolvedValue(
      new Response(JSON.stringify({ error: "invalid_api_key" }), { status: 401 })
    );
    await expect(
      ArcFX.createInvoice({ amountUsdc: 1, payInToken: "EURC", successUrl: "https://x" })
    ).rejects.toMatchObject({ code: "INVALID_API_KEY" });
  });

  it("throws SERVER_ERROR on 5xx with Retry-After", async () => {
    (globalThis.fetch as any).mockResolvedValue(
      new Response("err", { status: 503, headers: { "retry-after": "30" } })
    );
    try {
      await ArcFX.createInvoice({ amountUsdc: 1, payInToken: "EURC", successUrl: "https://x" });
      throw new Error("expected throw");
    } catch (e: any) {
      expect(e).toBeInstanceOf(ArcFXError);
      expect(e.code).toBe("SERVER_ERROR");
      expect(e.retryAfter).toBe(30);
    }
  });

  it("throws INVALID_URL synchronously for non-http successUrl", async () => {
    await expect(
      ArcFX.createInvoice({ amountUsdc: 1, payInToken: "EURC", successUrl: "javascript:alert(1)" })
    ).rejects.toMatchObject({ code: "INVALID_URL" });
  });
});

describe("ArcFX.openCheckout", () => {
  it("sets window.location.href to invoice.url", () => {
    const setHref = vi.fn();
    Object.defineProperty(globalThis, "window", {
      value: { location: { set href(url: string) { setHref(url); } } },
      configurable: true,
      writable: true,
    });
    ArcFX.openCheckout({ url: "https://checkout.arc-fx.xyz/i/0xabc" });
    expect(setHref).toHaveBeenCalledWith("https://checkout.arc-fx.xyz/i/0xabc");
  });
});
