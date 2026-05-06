/** @vitest-environment happy-dom */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { SuccessScreen, ExpiredScreen } from "./StatusScreens";

beforeEach(() => {
  Object.defineProperty(window, "location", {
    writable: true,
    value: { href: "http://localhost/" },
  });
});

afterEach(() => {
  cleanup();
});

describe("SuccessScreen — audit H1 client-side allowlist", () => {
  it("shows the redirect countdown when successUrl origin is in the allowlist", () => {
    render(
      <SuccessScreen
        successUrl="https://shop.example.com/order/123"
        allowedOrigins={["https://shop.example.com"]}
      />
    );
    expect(screen.getByText(/Redirecting to merchant/)).toBeTruthy();
  });

  it("renders fallback (no auto-redirect) when successUrl origin is NOT in allowlist", () => {
    render(
      <SuccessScreen
        successUrl="https://attacker.example.com/?x=1"
        allowedOrigins={["https://shop.example.com"]}
      />
    );
    expect(screen.queryByText(/Redirecting to merchant/)).toBeNull();
    expect(screen.getByText(/can't safely return you to the merchant/i)).toBeTruthy();
    // Critical: no redirect happened.
    expect(window.location.href).toBe("http://localhost/");
  });

  it("renders fallback when allowlist is empty", () => {
    render(
      <SuccessScreen
        successUrl="https://shop.example.com/ok"
        allowedOrigins={[]}
      />
    );
    expect(screen.queryByText(/Redirecting to merchant/)).toBeNull();
  });
});

describe("ExpiredScreen — audit H1 client-side allowlist", () => {
  it("renders the Return-to-merchant link when cancelUrl origin is allowed", () => {
    render(
      <ExpiredScreen
        cancelUrl="https://shop.example.com/cart"
        allowedOrigins={["https://shop.example.com"]}
      />
    );
    expect(screen.getByText(/Return to merchant/)).toBeTruthy();
  });

  it("hides the Return-to-merchant link when cancelUrl origin is NOT allowed", () => {
    render(
      <ExpiredScreen
        cancelUrl="https://attacker.example.com/cart"
        allowedOrigins={["https://shop.example.com"]}
      />
    );
    expect(screen.queryByText(/Return to merchant/)).toBeNull();
  });

  it("hides the Return-to-merchant link when no cancelUrl is given", () => {
    render(<ExpiredScreen allowedOrigins={["https://shop.example.com"]} />);
    expect(screen.queryByText(/Return to merchant/)).toBeNull();
  });
});
