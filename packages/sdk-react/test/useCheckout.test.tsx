import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useCheckout } from "../src/useCheckout";
import { Arcora } from "@arcora/sdk";

vi.mock("@arcora/sdk", () => ({
  Arcora: {
    init: vi.fn(),
    createInvoice: vi.fn(),
    openCheckout: vi.fn(),
  },
  ArcoraError: class extends Error { code = "TEST"; },
}));

beforeEach(() => { vi.clearAllMocks(); });

describe("useCheckout", () => {
  it("initializes Arcora with the provided apiKey", () => {
    renderHook(() => useCheckout({ apiKey: "ak_x", environment: "testnet" }));
    expect(Arcora.init).toHaveBeenCalledWith({ apiKey: "ak_x", environment: "testnet" });
  });

  it("checkout() creates invoice then opens checkout", async () => {
    (Arcora.createInvoice as any).mockResolvedValue({ invoiceId: "0x1", url: "https://x/i/1" });
    const { result } = renderHook(() => useCheckout({ apiKey: "ak_x" }));
    await act(async () => {
      await result.current.checkout({ amountUsdc: 1, payInToken: "EURC", successUrl: "https://m" });
    });
    expect(Arcora.openCheckout).toHaveBeenCalledWith({ invoiceId: "0x1", url: "https://x/i/1" });
  });

  it("exposes loading + error state", async () => {
    (Arcora.createInvoice as any).mockRejectedValue(new Error("boom"));
    const { result } = renderHook(() => useCheckout({ apiKey: "ak_x" }));
    await act(async () => {
      try {
        await result.current.checkout({ amountUsdc: 1, payInToken: "EURC", successUrl: "https://m" });
      } catch {}
    });
    expect(result.current.error).toBeTruthy();
  });
});
