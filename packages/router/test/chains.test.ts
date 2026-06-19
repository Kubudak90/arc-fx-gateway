import { describe, it, expect } from "vitest";
import { getAddress, isAddress } from "viem";
import {
  CHAINS,
  getTestnets,
  getChainByDomain,
  getChainByKey,
  getChainById,
  requireChainByDomain,
  CCTP_V2_TESTNET,
  CCTP_V2_MAINNET,
  CCTP_FINALITY,
  IRIS_API,
  DEPLOY_TESTNET_KEYS,
} from "../src/chains";

describe("chain registry integrity", () => {
  it("every chain has USDC and a CCTP messenger", () => {
    for (const c of CHAINS) {
      expect(c.tokens.USDC, `${c.key} USDC`).toBeDefined();
      expect(c.cctp.tokenMessengerV2, `${c.key} messenger`).toBeDefined();
      expect(c.cctp.messageTransmitterV2, `${c.key} transmitter`).toBeDefined();
    }
  });

  it("all token + protocol addresses are valid checksummed addresses", () => {
    for (const c of CHAINS) {
      for (const [sym, addr] of Object.entries(c.tokens)) {
        expect(isAddress(addr as string), `${c.key}.${sym}`).toBe(true);
        // getAddress throws if the checksum is wrong — guards against typos.
        expect(getAddress(addr as string)).toBe(addr);
      }
      expect(getAddress(c.cctp.tokenMessengerV2)).toBe(c.cctp.tokenMessengerV2);
      expect(getAddress(c.cctp.messageTransmitterV2)).toBe(c.cctp.messageTransmitterV2);
    }
  });

  it("chainId and (domain, network-class) and key are unique", () => {
    const ids = new Set<number>();
    const keys = new Set<string>();
    const testnetDomains = new Set<number>();
    const mainnetDomains = new Set<number>();
    for (const c of CHAINS) {
      expect(ids.has(c.chainId), `dup chainId ${c.chainId}`).toBe(false);
      ids.add(c.chainId);
      expect(keys.has(c.key), `dup key ${c.key}`).toBe(false);
      keys.add(c.key);
      const set = c.isTestnet ? testnetDomains : mainnetDomains;
      expect(set.has(c.cctpDomain), `dup domain ${c.cctpDomain}`).toBe(false);
      set.add(c.cctpDomain);
    }
  });

  it("testnet CCTP addresses differ from mainnet (correct network class wired)", () => {
    for (const c of getTestnets()) {
      expect(c.cctp).toBe(CCTP_V2_TESTNET);
      expect(c.cctp.tokenMessengerV2).not.toBe(CCTP_V2_MAINNET.tokenMessengerV2);
    }
  });
});

describe("lookups", () => {
  it("resolves Base Sepolia by domain 6 (testnet)", () => {
    const c = requireChainByDomain(6, true);
    expect(c.key).toBe("baseSepolia");
    expect(c.chainId).toBe(84532);
  });

  it("domain 0 disambiguates by network class", () => {
    expect(getChainByDomain(0, true)?.key).toBe("ethereumSepolia");
    expect(getChainByDomain(0, false)?.key).toBe("ethereum");
  });

  it("getChainByKey / getChainById round-trip", () => {
    const c = getChainByKey("arbitrumSepolia");
    expect(c?.chainId).toBe(421614);
    expect(getChainById(421614)?.key).toBe("arbitrumSepolia");
  });

  it("requireChainByDomain throws on an unknown domain", () => {
    expect(() => requireChainByDomain(999, true)).toThrow(/no testnet chain/);
  });
});

describe("constants", () => {
  it("finality thresholds match CCTP V2 source", () => {
    expect(CCTP_FINALITY.FAST).toBe(1000);
    expect(CCTP_FINALITY.STANDARD).toBe(2000);
    expect(CCTP_FINALITY.MIN).toBe(500);
  });
  it("iris bases are the sandbox/prod hosts", () => {
    expect(IRIS_API.testnet).toContain("sandbox");
    expect(IRIS_API.mainnet).toBe("https://iris-api.circle.com");
  });
  it("deploy targets are real testnet keys", () => {
    for (const k of DEPLOY_TESTNET_KEYS) {
      expect(getChainByKey(k)?.isTestnet).toBe(true);
    }
  });
});
