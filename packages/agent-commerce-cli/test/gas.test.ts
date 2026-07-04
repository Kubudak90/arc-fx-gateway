// packages/agent-commerce-cli/test/gas.test.ts
import { describe, it, expect, vi } from "vitest";
import { waitForGas } from "../src/lib/gas";

describe("waitForGas", () => {
  it("returns immediately when balance already meets the floor", async () => {
    const getBalance = vi.fn().mockResolvedValue(5n);
    const onNeedFunds = vi.fn();
    await waitForGas({ getBalance, floor: 1n, onNeedFunds, pollMs: 1, maxPolls: 3 });
    expect(onNeedFunds).not.toHaveBeenCalled();
    expect(getBalance).toHaveBeenCalledTimes(1);
  });
  it("prompts to fund then resolves once the balance crosses the floor", async () => {
    const getBalance = vi.fn().mockResolvedValueOnce(0n).mockResolvedValueOnce(0n).mockResolvedValue(2n);
    const onNeedFunds = vi.fn();
    await waitForGas({ getBalance, floor: 1n, onNeedFunds, pollMs: 1, maxPolls: 10 });
    expect(onNeedFunds).toHaveBeenCalledTimes(1);
    expect(getBalance.mock.calls.length).toBeGreaterThanOrEqual(3);
  });
  it("throws after maxPolls if never funded", async () => {
    const getBalance = vi.fn().mockResolvedValue(0n);
    await expect(waitForGas({ getBalance, floor: 1n, onNeedFunds: vi.fn(), pollMs: 1, maxPolls: 3 })).rejects.toThrow(/gas_timeout/);
  });
});
