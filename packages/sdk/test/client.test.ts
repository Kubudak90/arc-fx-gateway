import { describe, it, expect, vi, beforeEach, afterAll } from "vitest";
import { Arcora } from "../src";
import { ArcoraError } from "../src/error";

const ORIG_FETCH = globalThis.fetch;

beforeEach(() => {
  globalThis.fetch = vi.fn() as any;
  Arcora.init({ apiKey: "ak_test_xxx", environment: "testnet" });
});

afterAll(() => { globalThis.fetch = ORIG_FETCH; });

describe("Arcora.createInvoice", () => {
  it("posts to /api/invoices and returns the invoice", async () => {
    (globalThis.fetch as any).mockResolvedValue(
      new Response(JSON.stringify({ invoiceId: "0xabc", url: "https://x/i/0xabc" }), {
        status: 201,
        headers: { "content-type": "application/json" },
      })
    );
    const inv = await Arcora.createInvoice({
      amountUsdc: 49.99,
      payInToken: "EURC",
      successUrl: "https://merchant.example/ok",
    });
    expect(inv).toEqual({ invoiceId: "0xabc", url: "https://x/i/0xabc" });
    const call = (globalThis.fetch as any).mock.calls[0];
    expect(call[1].method).toBe("POST");
    expect(call[1].headers["X-Arcora-Api-Key"]).toBe("ak_test_xxx");
  });

  it("throws INVALID_API_KEY on 401", async () => {
    (globalThis.fetch as any).mockResolvedValue(
      new Response(JSON.stringify({ error: "invalid_api_key" }), { status: 401 })
    );
    await expect(
      Arcora.createInvoice({ amountUsdc: 1, payInToken: "EURC", successUrl: "https://x" })
    ).rejects.toMatchObject({ code: "INVALID_API_KEY" });
  });

  it("throws SERVER_ERROR on 5xx with Retry-After", async () => {
    (globalThis.fetch as any).mockResolvedValue(
      new Response("err", { status: 503, headers: { "retry-after": "30" } })
    );
    try {
      await Arcora.createInvoice({ amountUsdc: 1, payInToken: "EURC", successUrl: "https://x" });
      throw new Error("expected throw");
    } catch (e: any) {
      expect(e).toBeInstanceOf(ArcoraError);
      expect(e.code).toBe("SERVER_ERROR");
      expect(e.retryAfter).toBe(30);
    }
  });

  it("throws INVALID_URL synchronously for non-http successUrl", async () => {
    await expect(
      Arcora.createInvoice({ amountUsdc: 1, payInToken: "EURC", successUrl: "javascript:alert(1)" })
    ).rejects.toMatchObject({ code: "INVALID_URL" });
  });
});

describe("Arcora.openCheckout", () => {
  it("sets window.location.href to invoice.url", () => {
    const setHref = vi.fn();
    Object.defineProperty(globalThis, "window", {
      value: { location: { set href(url: string) { setHref(url); } } },
      configurable: true,
      writable: true,
    });
    Arcora.openCheckout({ url: "https://checkout.arcorapay.com/i/0xabc" });
    expect(setHref).toHaveBeenCalledWith("https://checkout.arcorapay.com/i/0xabc");
  });
});

describe("new Arcora() — instance pattern", () => {
  it("two instances do not share apiKey state", () => {
    const a = new Arcora({ apiKey: "ak_test_A", environment: "testnet" });
    const b = new Arcora({ apiKey: "ak_test_B", environment: "testnet" });
    expect(a.options.apiKey).not.toBe(b.options.apiKey);
  });

  it("createInvoice on instance uses that instance's apiKey", async () => {
    (globalThis.fetch as any).mockResolvedValue(
      new Response(JSON.stringify({ invoiceId: "0xabc", url: "https://x" }), { status: 201, headers: { "content-type": "application/json" } })
    );
    const a = new Arcora({ apiKey: "ak_instance_A", environment: "testnet" });
    await a.createInvoice({ amountUsdc: 1, payInToken: "EURC", successUrl: "https://m.test" });
    const call = (globalThis.fetch as any).mock.calls[0];
    expect(call[1].headers["X-Arcora-Api-Key"]).toBe("ak_instance_A");
  });
});

describe("Arcora.escrows() — V10 escrow listing", () => {
  const escrowPayload = {
    pending: [{ id: "0xaaa", amountOut: "9990000", payoutToken: "0xUsdc", claimableAt: "2026-05-10T00:00:00Z", status: "paid" }],
    matured: [],
    claimed: [],
  };

  it("GETs /api/merchant/escrows and returns structured payload", async () => {
    (globalThis.fetch as any).mockResolvedValue(
      new Response(JSON.stringify(escrowPayload), {
        status: 200,
        headers: { "content-type": "application/json" },
      })
    );
    const result = await Arcora.escrows();
    expect(result.pending).toHaveLength(1);
    expect(result.pending[0].id).toBe("0xaaa");
    expect(result.matured).toHaveLength(0);
    const call = (globalThis.fetch as any).mock.calls[0];
    expect(call[0]).toMatch(/\/api\/merchant\/escrows$/);
    expect(call[1].method).toBe("GET");
    expect(call[1].headers["X-Arcora-Api-Key"]).toBe("ak_test_xxx");
  });

  it("instance escrows() uses the instance's apiKey", async () => {
    (globalThis.fetch as any).mockResolvedValue(
      new Response(JSON.stringify({ pending: [], matured: [], claimed: [] }), {
        status: 200,
        headers: { "content-type": "application/json" },
      })
    );
    const a = new Arcora({ apiKey: "ak_escrow_inst", environment: "testnet" });
    await a.escrows();
    const call = (globalThis.fetch as any).mock.calls[0];
    expect(call[1].headers["X-Arcora-Api-Key"]).toBe("ak_escrow_inst");
  });

  it("throws INVALID_API_KEY on 401", async () => {
    (globalThis.fetch as any).mockResolvedValue(
      new Response(JSON.stringify({ error: "invalid_api_key" }), { status: 401 })
    );
    await expect(Arcora.escrows()).rejects.toMatchObject({ code: "INVALID_API_KEY" });
  });
});
