import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useCheckout } from "../src/useCheckout";
import { ArcFX } from "@arc-fx/checkout";

vi.mock("@arc-fx/checkout", () => ({
  ArcFX: {
    init: vi.fn(),
    createInvoice: vi.fn(),
    openCheckout: vi.fn(),
  },
  ArcFXError: class extends Error { code = "TEST"; },
}));

beforeEach(() => { vi.clearAllMocks(); });

describe("useCheckout", () => {
  it("initializes ArcFX with the provided apiKey", () => {
    renderHook(() => useCheckout({ apiKey: "ak_x", environment: "testnet" }));
    expect(ArcFX.init).toHaveBeenCalledWith({ apiKey: "ak_x", environment: "testnet" });
  });

  it("checkout() creates invoice then opens checkout", async () => {
    (ArcFX.createInvoice as any).mockResolvedValue({ invoiceId: "0x1", url: "https://x/i/1" });
    const { result } = renderHook(() => useCheckout({ apiKey: "ak_x" }));
    await act(async () => {
      await result.current.checkout({ amountUsdc: 1, payInToken: "EURC", successUrl: "https://m" });
    });
    expect(ArcFX.openCheckout).toHaveBeenCalledWith({ invoiceId: "0x1", url: "https://x/i/1" });
  });

  it("exposes loading + error state", async () => {
    (ArcFX.createInvoice as any).mockRejectedValue(new Error("boom"));
    const { result } = renderHook(() => useCheckout({ apiKey: "ak_x" }));
    await act(async () => {
      try {
        await result.current.checkout({ amountUsdc: 1, payInToken: "EURC", successUrl: "https://m" });
      } catch {}
    });
    expect(result.current.error).toBeTruthy();
  });
});
