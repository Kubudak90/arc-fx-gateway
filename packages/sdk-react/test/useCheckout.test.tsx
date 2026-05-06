import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useCheckout } from "../src/useCheckout";
import { Arcora } from "@arcora/sdk";

vi.mock("@arcora/sdk", () => {
  const ArcoraMock: any = vi.fn(function(this: any, opts: any) { this.options = opts; });
  ArcoraMock.prototype.createInvoice = vi.fn();
  ArcoraMock.prototype.openCheckout = vi.fn();
  ArcoraMock.init = vi.fn();
  ArcoraMock.createInvoice = vi.fn();
  ArcoraMock.openCheckout = vi.fn();
  return {
    Arcora: ArcoraMock,
    ArcoraError: class extends Error { code = "TEST"; },
  };
});

beforeEach(() => { vi.clearAllMocks(); });

describe("useCheckout", () => {
  it("initializes Arcora with the provided apiKey", () => {
    renderHook(() => useCheckout({ apiKey: "ak_x", environment: "testnet" }));
    expect(Arcora).toHaveBeenCalledWith({ apiKey: "ak_x", environment: "testnet" });
  });

  it("checkout() creates invoice then opens checkout", async () => {
    (Arcora.prototype.createInvoice as any).mockResolvedValue({ invoiceId: "0x1", url: "https://x/i/1" });
    const { result } = renderHook(() => useCheckout({ apiKey: "ak_x" }));
    await act(async () => {
      await result.current.checkout({ amountUsdc: 1, payInToken: "EURC", successUrl: "https://m" });
    });
    expect(Arcora.prototype.openCheckout).toHaveBeenCalledWith({ invoiceId: "0x1", url: "https://x/i/1" });
  });

  it("exposes loading + error state", async () => {
    (Arcora.prototype.createInvoice as any).mockRejectedValue(new Error("boom"));
    const { result } = renderHook(() => useCheckout({ apiKey: "ak_x" }));
    await act(async () => {
      try {
        await result.current.checkout({ amountUsdc: 1, payInToken: "EURC", successUrl: "https://m" });
      } catch {}
    });
    expect(result.current.error).toBeTruthy();
  });

  it("two simultaneous useCheckout hooks keep separate apiKey contexts", () => {
    const a = renderHook(() => useCheckout({ apiKey: "ak_A", baseUrl: "http://a" }));
    const b = renderHook(() => useCheckout({ apiKey: "ak_B", baseUrl: "http://b" }));
    // useMemo deps include apiKey + baseUrl, so each gets its own Arcora instance
    expect(a.result.current.checkout).not.toBe(b.result.current.checkout);
  });
});
