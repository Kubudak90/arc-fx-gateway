import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { QuoteDisplay } from "./QuoteDisplay";

beforeEach(() => {
  global.fetch = vi.fn(() => Promise.resolve(
    new Response(JSON.stringify({ amountOut: "46020000" }), { status: 200 })
  )) as any;
});

describe("QuoteDisplay", () => {
  it("renders quote after fetch", async () => {
    const onQuote = vi.fn();
    render(
      <QuoteDisplay
        payInTokenAddress="0x89B50855Aa3bE2F677cD6303Cec089B5F319D72a"
        payoutTokenAddress="0x3600000000000000000000000000000000000000"
        amountOut="49990000"
        onQuote={onQuote}
      />
    );
    await waitFor(() => expect(onQuote).toHaveBeenCalled());
    expect(screen.getByText(/EURC/)).toBeTruthy();
  });
});
