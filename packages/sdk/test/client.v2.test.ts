import { describe, it, expect, vi, beforeEach, afterAll } from "vitest";
import { Arcora } from "../src";

const ORIG_FETCH = globalThis.fetch;
beforeEach(() => { globalThis.fetch = vi.fn() as never; });
afterAll(() => { globalThis.fetch = ORIG_FETCH; });

function ok201() {
  (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
    new Response(JSON.stringify({ invoiceId: "0xref", url: "https://x/i/0xref" }), {
      status: 201, headers: { "content-type": "application/json" },
    }),
  );
}

describe("Arcora.createInvoice — v2 surface (amount string + currency + idempotency)", () => {
  it("sends a v2 body + Idempotency-Key header when `amount` is a string", async () => {
    ok201();
    const a = new Arcora({ apiKey: "ak_test_x", environment: "testnet" });
    const inv = await a.createInvoice({ amount: "49.99", currency: "EURC", idempotencyKey: "idem-1", successUrl: "https://m.test/ok" });
    expect(inv.invoiceId).toBe("0xref");
    const call = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(call[1].headers["Idempotency-Key"]).toBe("idem-1");
    const body = JSON.parse(call[1].body);
    expect(body.amount).toBe("49.99");
    expect(body.currency).toBe("EURC");
    expect(body.amountUsdc).toBeUndefined(); // never sends the v1 field on the v2 path
  });

  it("defaults currency to USDC and omits the header when no idempotencyKey", async () => {
    ok201();
    const a = new Arcora({ apiKey: "ak_test_x", environment: "testnet" });
    await a.createInvoice({ amount: "3", successUrl: "https://m.test/ok" });
    const call = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(JSON.parse(call[1].body).currency).toBe("USDC");
    expect(call[1].headers["Idempotency-Key"]).toBeUndefined();
  });

  it("rejects a non-positive / malformed amount string", async () => {
    const a = new Arcora({ apiKey: "ak_test_x", environment: "testnet" });
    await expect(a.createInvoice({ amount: "0", successUrl: "https://m.test/ok" })).rejects.toMatchObject({ code: "UNKNOWN" });
    await expect(a.createInvoice({ amount: "1e6", successUrl: "https://m.test/ok" })).rejects.toMatchObject({ code: "UNKNOWN" });
    expect(globalThis.fetch as ReturnType<typeof vi.fn>).not.toHaveBeenCalled();
  });

  it("still sends the v1 body when amountUsdc is used (back-compat union)", async () => {
    ok201();
    const a = new Arcora({ apiKey: "ak_test_x", environment: "testnet" });
    await a.createInvoice({ amountUsdc: 9.99, payInToken: "USDC", successUrl: "https://m.test/ok" });
    const body = JSON.parse((globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0][1].body);
    expect(body.amountUsdc).toBe(9.99);
    expect(body.amount).toBeUndefined();
  });
});
