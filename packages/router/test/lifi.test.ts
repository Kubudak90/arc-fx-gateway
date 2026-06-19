import { describe, it, expect, vi } from "vitest";
import { assertSwapOnly, getSwapPlan } from "../src/lifi";
import type { Address } from "viem";

const USDC = "0x036CbD53842c5426634e7929541eC2318f3dCF7e" as Address;
const EURC = "0x808456652fdb597867f38412077A9182bf77359F" as Address;
const CALLER = "0x1111111111111111111111111111111111111111" as Address;

describe("assertSwapOnly", () => {
  it("accepts a pure same-chain swap", () => {
    expect(() =>
      assertSwapOnly({
        action: { fromChainId: 84532, toChainId: 84532 },
        includedSteps: [{ type: "swap", action: { fromChainId: 84532, toChainId: 84532 } }],
      }),
    ).not.toThrow();
  });

  it("rejects a top-level cross-chain action", () => {
    expect(() => assertSwapOnly({ action: { fromChainId: 84532, toChainId: 421614 } })).toThrow(/bridge_rejected/);
  });

  it("rejects a bridge step", () => {
    expect(() =>
      assertSwapOnly({ includedSteps: [{ type: "cross", tool: "stargate" }] }),
    ).toThrow(/bridge_rejected/);
  });

  it("rejects a cross-chain swap step", () => {
    expect(() =>
      assertSwapOnly({ includedSteps: [{ type: "swap", action: { fromChainId: 1, toChainId: 10 } }] }),
    ).toThrow(/bridge_rejected/);
  });

  it("rejects a bridge hidden inside a lifi aggregator step", () => {
    expect(() =>
      assertSwapOnly({
        includedSteps: [
          { type: "lifi", includedSteps: [{ type: "swap" }, { type: "cross", tool: "across" }] },
        ],
      }),
    ).toThrow(/bridge_rejected/);
  });
});

describe("getSwapPlan", () => {
  function quote(over: Record<string, unknown> = {}) {
    return {
      ok: true,
      status: 200,
      json: async () => ({
        action: { fromChainId: 84532, toChainId: 84532 },
        estimate: { toAmountMin: "9200000" },
        includedSteps: [{ type: "swap", action: { fromChainId: 84532, toChainId: 84532 } }],
        transactionRequest: { to: "0xrouter", data: "0xcalldata", value: "0" },
        ...over,
      }),
    } as Response;
  }

  it("returns router/calldata/minOut for a valid swap", async () => {
    const fetchImpl = vi.fn(async () => quote()) as unknown as typeof fetch;
    const plan = await getSwapPlan({
      chainId: 84532,
      fromToken: USDC,
      toToken: EURC,
      fromAmount: "10000000",
      fromAddress: CALLER,
      fetchImpl,
    });
    expect(plan.router).toBe("0xrouter");
    expect(plan.calldata).toBe("0xcalldata");
    expect(plan.minOut).toBe(9_200_000n);
    expect(plan.value).toBe(0n);
  });

  it("sends fromChain == toChain (same-chain swap)", async () => {
    const fetchImpl = vi.fn(async () => quote()) as unknown as typeof fetch;
    await getSwapPlan({ chainId: 84532, fromToken: USDC, toToken: EURC, fromAmount: "1", fromAddress: CALLER, fetchImpl });
    const url = (fetchImpl as unknown as { mock: { calls: string[][] } }).mock.calls[0]![0] as string;
    expect(url).toContain("fromChain=84532");
    expect(url).toContain("toChain=84532");
    expect(url).toContain("allowBridges=false");
  });

  it("rejects a quote whose route contains a bridge", async () => {
    const fetchImpl = vi.fn(async () =>
      quote({ includedSteps: [{ type: "cross", tool: "x" }], action: { fromChainId: 84532, toChainId: 84532 } }),
    ) as unknown as typeof fetch;
    await expect(
      getSwapPlan({ chainId: 84532, fromToken: USDC, toToken: EURC, fromAmount: "1", fromAddress: CALLER, fetchImpl }),
    ).rejects.toThrow(/bridge_rejected/);
  });

  it("rejects a quote that carries native value", async () => {
    const fetchImpl = vi.fn(async () =>
      quote({ transactionRequest: { to: "0xr", data: "0xd", value: "5" } }),
    ) as unknown as typeof fetch;
    await expect(
      getSwapPlan({ chainId: 84532, fromToken: USDC, toToken: EURC, fromAmount: "1", fromAddress: CALLER, fetchImpl }),
    ).rejects.toThrow(/native_value/);
  });
});
