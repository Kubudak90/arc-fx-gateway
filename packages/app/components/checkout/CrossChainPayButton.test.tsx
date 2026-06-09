/** @vitest-environment happy-dom */
import { describe, expect, it, afterEach, vi } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { CrossChainPayButton } from "./CrossChainPayButton";

vi.mock("wagmi", () => ({
  useAccount: () => ({ address: "0x" + "a".repeat(40), isConnected: true }),
  useChainId: () => 84532,
  useSwitchChain: () => ({ switchChainAsync: vi.fn() }),
  useWriteContract: () => ({
    writeContractAsync: vi.fn().mockResolvedValue("0x" + "b".repeat(64)),
  }),
  usePublicClient: () => ({
    readContract: vi.fn().mockResolvedValue(0n),
    waitForTransactionReceipt: vi.fn(),
  }),
}));

afterEach(() => {
  cleanup();
});

describe("CrossChainPayButton", () => {
  it("renders source chain and bridge action", () => {
    render(
      <CrossChainPayButton
        invoiceId={"0x" + "1".repeat(64)}
        sourceChainId={84532}
        onPaid={vi.fn()}
        onFailed={vi.fn()}
      />,
    );
    expect(screen.getByRole("button").textContent).toMatch(/Bridge USDC from Base/i);
  });
});
