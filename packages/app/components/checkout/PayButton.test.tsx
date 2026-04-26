import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { PayButton } from "./PayButton";

vi.mock("wagmi", () => ({
  useAccount: () => ({ address: undefined }),
  useWriteContract: () => ({ writeContractAsync: vi.fn() }),
  usePublicClient: () => ({ waitForTransactionReceipt: vi.fn() }),
  useChainId: () => 5042002,
}));

describe("PayButton", () => {
  it("is disabled with no wallet connected", () => {
    render(
      <PayButton
        invoiceId="0x01"
        payInTokenAddress="0x89B50855Aa3bE2F677cD6303Cec089B5F319D72a"
        amountIn={null}
        onPaid={() => {}}
      />
    );
    const btn = screen.getByRole("button");
    expect((btn as HTMLButtonElement).disabled).toBe(true);
  });
});
