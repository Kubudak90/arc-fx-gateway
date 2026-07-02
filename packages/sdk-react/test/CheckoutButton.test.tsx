import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, cleanup } from "@testing-library/react";
import { CheckoutButton } from "../src/CheckoutButton";
import { Arcora } from "@arcora/sdk";

vi.mock("@arcora/sdk", () => {
  const ArcoraMock: any = vi.fn(function (this: any, opts: any) {
    this.options = opts;
  });
  ArcoraMock.prototype.createInvoice = vi.fn();
  ArcoraMock.prototype.openCheckout = vi.fn();
  return { Arcora: ArcoraMock, ArcoraError: class extends Error { code = "TEST"; } };
});

beforeEach(() => { vi.clearAllMocks(); });
afterEach(() => { cleanup(); });

const invoice = { amountUsdc: 1, payInToken: "USDC", successUrl: "https://m.test/ok" } as any;

describe("CheckoutButton", () => {
  it("surfaces a checkout failure in the DOM instead of swallowing it", async () => {
    (Arcora.prototype.createInvoice as any).mockRejectedValue(new Error("checkout failed"));
    render(<CheckoutButton apiKey="pk_x" environment="testnet" invoice={invoice} />);
    fireEvent.click(screen.getByRole("button"));
    await waitFor(() => {
      expect(screen.getByRole("alert").textContent).toContain("checkout failed");
    });
  });

  it("handles a failed checkout cleanly — button re-enables, error shown (no floating rejection)", async () => {
    (Arcora.prototype.createInvoice as any).mockRejectedValue(new Error("boom"));
    render(<CheckoutButton apiKey="pk_x" environment="testnet" invoice={invoice} />);
    const btn = screen.getByRole("button") as HTMLButtonElement;
    fireEvent.click(btn);
    // the failure path completing (alert shown + button re-enabled via the finally) only happens
    // if the rejection was caught and state updated — a swallowed floating promise never would.
    await waitFor(() => expect(screen.getByRole("alert").textContent).toContain("boom"));
    expect(btn.disabled).toBe(false);
  });
});
