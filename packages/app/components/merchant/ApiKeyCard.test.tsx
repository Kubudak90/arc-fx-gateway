import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { ApiKeyCard } from "./ApiKeyCard";

beforeEach(() => {
  global.fetch = vi.fn() as any;
});

describe("ApiKeyCard", () => {
  it("calls bootstrap on first generate", async () => {
    (global.fetch as any).mockResolvedValue(
      new Response(JSON.stringify({ apiKey: "ak_live_abc" }), { status: 201 })
    );
    const onBootstrap = vi.fn().mockResolvedValue(undefined);
    render(<ApiKeyCard hasMerchant={false} onBootstrap={onBootstrap} />);
    fireEvent.click(screen.getByText(/Generate API key/));
    await waitFor(() => expect((global.fetch as any).mock.calls[0][0]).toBe("/api/merchant/bootstrap"));
    await waitFor(() => expect(screen.getByText("ak_live_abc")).toBeTruthy());
    expect(onBootstrap).toHaveBeenCalled();
  });

  it("calls rotate when merchant exists", async () => {
    (global.fetch as any).mockResolvedValue(
      new Response(JSON.stringify({ apiKey: "ak_live_xyz" }), { status: 200 })
    );
    render(<ApiKeyCard hasMerchant={true} onBootstrap={vi.fn()} />);
    fireEvent.click(screen.getByText(/Rotate key/));
    await waitFor(() => expect((global.fetch as any).mock.calls[0][0]).toBe("/api/merchant/api-key"));
  });
});
