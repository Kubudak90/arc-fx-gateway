// packages/agent-commerce-core/test/refund.test.ts
import { describe, it, expect, vi } from "vitest";
import { createRefunder } from "../src/refund";

// A throwaway, well-formed test key (never used on-chain in tests — the chain
// clients are injected, so writeContract/waitForReceipt are mocked).
const PRIVATE_KEY = "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d";
const VALID_ID = ("0x" + "a".repeat(64)) as `0x${string}`;
const TX_HASH = ("0x" + "b".repeat(64)) as `0x${string}`;

describe("createRefunder.refund", () => {
  it("rejects an invalid invoice id (not a 0x bytes32)", async () => {
    const refunder = createRefunder({ privateKey: PRIVATE_KEY, clients: { writeContract: vi.fn(), waitForReceipt: vi.fn() } });
    await expect(refunder.refund("not-an-id")).rejects.toThrow(/invalid_invoice_id/);
    await expect(refunder.refund("0x" + "a".repeat(63))).rejects.toThrow(/invalid_invoice_id/);
  });

  it("does not touch the chain when the id is invalid", async () => {
    const writeContract = vi.fn();
    const waitForReceipt = vi.fn();
    const refunder = createRefunder({ privateKey: PRIVATE_KEY, clients: { writeContract, waitForReceipt } });
    await expect(refunder.refund("bad")).rejects.toThrow(/invalid_invoice_id/);
    expect(writeContract).not.toHaveBeenCalled();
    expect(waitForReceipt).not.toHaveBeenCalled();
  });

  it("calls refundInvoice with the globalId and returns a success RefundResult", async () => {
    const writeContract = vi.fn().mockResolvedValue(TX_HASH);
    const waitForReceipt = vi.fn().mockResolvedValue({ status: "success" });
    const refunder = createRefunder({ privateKey: PRIVATE_KEY, clients: { writeContract, waitForReceipt } });

    const result = await refunder.refund(VALID_ID);

    expect(result).toEqual({ invoiceId: VALID_ID, txHash: TX_HASH, status: "success" });
    expect(writeContract).toHaveBeenCalledTimes(1);
    const call = writeContract.mock.calls[0]![0];
    expect(call.functionName).toBe("refundInvoice");
    expect(call.args).toEqual([VALID_ID]);
    // refundInvoice goes to the gateway; default Arc gateway address.
    expect(call.address).toBe("0xEaE914D53B2895c832dA83419a7687eF7D1d0142");
    expect(waitForReceipt).toHaveBeenCalledWith(TX_HASH);
  });

  it("throws refund_reverted:<txHash> when the receipt status is reverted", async () => {
    const writeContract = vi.fn().mockResolvedValue(TX_HASH);
    const waitForReceipt = vi.fn().mockResolvedValue({ status: "reverted" });
    const refunder = createRefunder({ privateKey: PRIVATE_KEY, clients: { writeContract, waitForReceipt } });

    await expect(refunder.refund(VALID_ID)).rejects.toThrow(`refund_reverted:${TX_HASH}`);
  });
});
