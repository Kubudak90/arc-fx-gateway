import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useCheckout } from "../src/useCheckout";
import { Arcora } from "@arcora/sdk";

vi.mock("@arcora/sdk", () => {
  const ArcoraMock: any = vi.fn(function(this: any, opts: any) { this.options = opts; });
  ArcoraMock.prototype.createInvoice = vi.fn();
  ArcoraMock.prototype.openCheckout = vi.fn();
  ArcoraMock.prototype.escrows = vi.fn();
  ArcoraMock.init = vi.fn();
  ArcoraMock.createInvoice = vi.fn();
  ArcoraMock.openCheckout = vi.fn();
  ArcoraMock.escrows = vi.fn();
  return {
    Arcora: ArcoraMock,
    ArcoraError: class extends Error { code = "TEST"; },
  };
});

beforeEach(() => {
  vi.clearAllMocks();
  // clearAllMocks resets call records but NOT implementations, so a mockResolvedValue
  // or throwing ctor set in one test would leak into the next. Restore the base
  // constructor behavior and clear the per-method impls so every test starts clean.
  (Arcora as any).mockImplementation(function(this: any, opts: any) { this.options = opts; });
  (Arcora.prototype.createInvoice as any).mockReset();
  (Arcora.prototype.openCheckout as any).mockReset();
});

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

  it("refundEndsAt is null before any checkout", () => {
    const { result } = renderHook(() => useCheckout({ apiKey: "ak_x" }));
    expect(result.current.refundEndsAt).toBeNull();
  });

  // Gap #12: the production @arcora/sdk createInvoice returns ONLY {invoiceId,url}
  // (the invoice is unpaid at creation, so claimableAt is absent). The old test
  // hand-mocked a claimableAt-bearing shape the SDK can never produce, masking the
  // fact that refundEndsAt is null after a real checkout. Pin the real shape.
  it("refundEndsAt stays null for the real create-response shape {invoiceId,url}", async () => {
    (Arcora.prototype.createInvoice as any).mockResolvedValue({ invoiceId: "0x1", url: "https://x/i/1" });
    const { result } = renderHook(() => useCheckout({ apiKey: "ak_x" }));
    await act(async () => {
      await result.current.checkout({ amountUsdc: 1, payInToken: "EURC", successUrl: "https://m" });
    });
    expect(result.current.refundEndsAt).toBeNull();
  });

  // Gap #13: the Arcora constructor throws synchronously for common misconfigs
  // (missing apiKey; a secret ak_ key in a browser). It runs inside useMemo during
  // render, so a throw must NOT crash the render tree — it must surface via error.
  it("populates error state (no render crash) when the Arcora constructor throws", () => {
    (Arcora as any).mockImplementationOnce(() => { throw new Error("secret key used in browser"); });
    const { result } = renderHook(() => useCheckout({ apiKey: "ak_live_bad", environment: "testnet" }));
    expect(result.current.error).toBeInstanceOf(Error);
    expect(result.current.error?.message).toMatch(/secret key/);
    expect(result.current.loading).toBe(false);
  });

  it("checkout() rejects with the construction error when the Arcora constructor threw", async () => {
    (Arcora as any).mockImplementationOnce(() => { throw new Error("missing apiKey"); });
    const { result } = renderHook(() => useCheckout({ apiKey: "" as any }));
    await expect(
      result.current.checkout({ amountUsdc: 1, payInToken: "EURC", successUrl: "https://m" }),
    ).rejects.toThrow(/missing apiKey/);
  });

  // Gap #14: the loading contract (the only thing CheckoutButton uses to disable
  // the button) was never asserted to flip true in-flight and back to false.
  it("loading is true in-flight and false after a successful checkout", async () => {
    let resolve!: (v: unknown) => void;
    const pending = new Promise((r) => { resolve = r; });
    (Arcora.prototype.createInvoice as any).mockReturnValue(pending);
    const { result } = renderHook(() => useCheckout({ apiKey: "ak_x" }));
    let call!: Promise<unknown>;
    act(() => {
      call = result.current.checkout({ amountUsdc: 1, payInToken: "EURC", successUrl: "https://m" });
    });
    expect(result.current.loading).toBe(true);
    await act(async () => {
      resolve({ invoiceId: "0x1", url: "https://x/i/1" });
      await call;
    });
    expect(result.current.loading).toBe(false);
  });

  it("loading returns to false after a failed checkout", async () => {
    let reject!: (e: unknown) => void;
    const pending = new Promise((_, rj) => { reject = rj; });
    (Arcora.prototype.createInvoice as any).mockReturnValue(pending);
    const { result } = renderHook(() => useCheckout({ apiKey: "ak_x" }));
    let call!: Promise<unknown>;
    act(() => {
      call = result.current.checkout({ amountUsdc: 1, payInToken: "EURC", successUrl: "https://m" });
    });
    expect(result.current.loading).toBe(true);
    await act(async () => {
      reject(new Error("boom"));
      await call.catch(() => {});
    });
    expect(result.current.loading).toBe(false);
  });
});
