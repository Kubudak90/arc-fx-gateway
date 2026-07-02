import { describe, expect, it } from "vitest";
import { planCrosschainRoute } from "../src/planner";
import { parseChainRegistryJson } from "../src/chains";

const registry = parseChainRegistryJson(JSON.stringify({
  "arc-testnet": {
    cctpDomain: 30,
    tokenMessenger: "0x1111111111111111111111111111111111111111",
    messageTransmitter: "0x2222222222222222222222222222222222222222",
    usdcAddress: "0x3600000000000000000000000000000000000000",
    eurcAddress: "0x89B50855Aa3bE2F677cD6303Cec089B5F319D72a"
  },
  "base-sepolia": {
    cctpDomain: 6,
    tokenMessenger: "0x3333333333333333333333333333333333333333",
    messageTransmitter: "0x4444444444444444444444444444444444444444",
    usdcAddress: "0x5555555555555555555555555555555555555555"
  },
  "ethereum-sepolia": {
    cctpDomain: 0,
    tokenMessenger: "0x6666666666666666666666666666666666666666",
    messageTransmitter: "0x7777777777777777777777777777777777777777",
    usdcAddress: "0x8888888888888888888888888888888888888888"
  }
}));

describe("planCrosschainRoute", () => {
  it("plans Base Sepolia USDC into Arc payout USDC", () => {
    const route = planCrosschainRoute({
      registry,
      sourceChainId: 84532,
      destinationChainId: 5042002,
      sourceAmountBaseUnits: 5_000_000n,
      payoutToken: "0x3600000000000000000000000000000000000000",
      enabledSourceChains: [84532],
    });

    expect(route.source.chainId).toBe(84532);
    expect(route.destination.chainId).toBe(5042002);
    expect(route.sourceToken.address).toBe("0x5555555555555555555555555555555555555555");
    expect(route.destinationToken.address).toBe("0x3600000000000000000000000000000000000000");
    expect(route.requiresArcSwap).toBe(false);
  });

  it("plans Ethereum Sepolia USDC into Arc payout EURC with Arc-side swap", () => {
    const route = planCrosschainRoute({
      registry,
      sourceChainId: 11155111,
      destinationChainId: 5042002,
      sourceAmountBaseUnits: 12_500_000n,
      payoutToken: "0x89B50855Aa3bE2F677cD6303Cec089B5F319D72a",
      enabledSourceChains: [11155111],
    });

    expect(route.requiresArcSwap).toBe(true);
    expect(route.arcSwap.tokenIn).toBe("USDC");
    expect(route.arcSwap.tokenOut).toBe("EURC");
  });

  it("rejects disabled source chains", () => {
    expect(() => planCrosschainRoute({
      registry,
      sourceChainId: 84532,
      destinationChainId: 5042002,
      sourceAmountBaseUnits: 1_000_000n,
      payoutToken: "0x3600000000000000000000000000000000000000",
      enabledSourceChains: [],
    })).toThrow(/source chain disabled/);
  });

  // Lock in the four validation guards on the payment-routing path (previously untested).
  it("rejects a non-Arc destination chain", () => {
    expect(() => planCrosschainRoute({
      registry,
      sourceChainId: 84532,
      destinationChainId: 84532, // Base Sepolia, not Arc
      sourceAmountBaseUnits: 5_000_000n,
      payoutToken: "0x3600000000000000000000000000000000000000",
      enabledSourceChains: [84532],
    })).toThrow(/unsupported destination chain/);
  });

  it("rejects a zero or negative source amount", () => {
    const base = {
      registry,
      sourceChainId: 84532,
      destinationChainId: 5042002,
      payoutToken: "0x3600000000000000000000000000000000000000" as `0x${string}`,
      enabledSourceChains: [84532],
    };
    expect(() => planCrosschainRoute({ ...base, sourceAmountBaseUnits: 0n })).toThrow(/source amount must be positive/);
    expect(() => planCrosschainRoute({ ...base, sourceAmountBaseUnits: -1n })).toThrow(/source amount must be positive/);
  });

  it("rejects when the Arc destination has no EURC configured", () => {
    const noEurc = parseChainRegistryJson(JSON.stringify({
      "arc-testnet": {
        cctpDomain: 30,
        tokenMessenger: "0x1111111111111111111111111111111111111111",
        messageTransmitter: "0x2222222222222222222222222222222222222222",
        usdcAddress: "0x3600000000000000000000000000000000000000",
      },
      "base-sepolia": {
        cctpDomain: 6,
        tokenMessenger: "0x3333333333333333333333333333333333333333",
        messageTransmitter: "0x4444444444444444444444444444444444444444",
        usdcAddress: "0x5555555555555555555555555555555555555555",
      },
    }));
    expect(() => planCrosschainRoute({
      registry: noEurc,
      sourceChainId: 84532,
      destinationChainId: 5042002,
      sourceAmountBaseUnits: 5_000_000n,
      payoutToken: "0x3600000000000000000000000000000000000000",
      enabledSourceChains: [84532],
    })).toThrow(/Arc EURC config missing/);
  });

  it("rejects an unsupported Arc payout token", () => {
    expect(() => planCrosschainRoute({
      registry,
      sourceChainId: 84532,
      destinationChainId: 5042002,
      sourceAmountBaseUnits: 5_000_000n,
      payoutToken: "0x9999999999999999999999999999999999999999",
      enabledSourceChains: [84532],
    })).toThrow(/unsupported Arc payout token/);
  });
});
