import { describe, expect, it } from "vitest";
import { parseChainRegistryJson, chainById } from "../src/chains";

const A = (n: string) => "0x" + n.repeat(40);

const validBase = {
  cctpDomain: 6,
  tokenMessenger: A("1"),
  messageTransmitter: A("2"),
  usdcAddress: A("3"),
};

describe("parseChainRegistryJson", () => {
  it("round-trips a valid config keyed by chainId, with token decimals + optional EURC", () => {
    const reg = parseChainRegistryJson(JSON.stringify({
      "base-sepolia": validBase,
      "arc-testnet": { ...validBase, cctpDomain: 30, eurcAddress: A("4") },
    }));
    const base = chainById(reg, 84532);
    expect(base.tokens.USDC.decimals).toBe(6);
    expect(base.tokens.EURC).toBeUndefined();
    // the entry that supplied eurcAddress has EURC
    const arc = [...reg.values()].find((c) => c.key === "arc-testnet")!;
    expect(arc.tokens.EURC?.decimals).toBe(6);
  });

  it("rejects a non-object / malformed JSON input clearly (not a cryptic TypeError)", () => {
    expect(() => parseChainRegistryJson("not json")).toThrow(/invalid chain registry JSON/);
    expect(() => parseChainRegistryJson("42")).toThrow(/must be a JSON object/);
    expect(() => parseChainRegistryJson("null")).toThrow(/must be a JSON object/);
    expect(() => parseChainRegistryJson("[]")).toThrow(/must be a JSON object/);
  });

  it("rejects a zero / invalid address", () => {
    expect(() => parseChainRegistryJson(JSON.stringify({
      "base-sepolia": { ...validBase, tokenMessenger: "0x" + "0".repeat(40) },
    }))).toThrow(/invalid non-zero address/);
    expect(() => parseChainRegistryJson(JSON.stringify({
      "base-sepolia": { ...validBase, usdcAddress: "0x" + "0".repeat(40) },
    }))).toThrow(/invalid non-zero address/);
  });

  it("rejects an unknown chain key and an invalid cctpDomain", () => {
    expect(() => parseChainRegistryJson(JSON.stringify({ "not-a-chain": validBase })))
      .toThrow(/unknown chain config key/);
    expect(() => parseChainRegistryJson(JSON.stringify({ "base-sepolia": { ...validBase, cctpDomain: -1 } })))
      .toThrow(/invalid cctpDomain/);
    expect(() => parseChainRegistryJson(JSON.stringify({ "base-sepolia": { ...validBase, cctpDomain: 1.5 } })))
      .toThrow(/invalid cctpDomain/);
  });
});

describe("chainById", () => {
  it("labels the role in the error (source vs destination)", () => {
    const reg = parseChainRegistryJson(JSON.stringify({ "base-sepolia": validBase }));
    expect(() => chainById(reg, 999999)).toThrow(/unsupported source chain: 999999/);
    expect(() => chainById(reg, 999999, "destination")).toThrow(/unsupported destination chain: 999999/);
  });
});
