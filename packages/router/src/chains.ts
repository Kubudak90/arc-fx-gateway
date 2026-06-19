// Chain registry — the single source of truth for CCTP V2 domains, token
// addresses, and protocol contract addresses (PLAN §5.1). Every value here was
// verified against Circle's canonical docs and the circlefin/evm-cctp-contracts
// source; NONE come from memory. A wrong address/domain in funds-handling code is
// a critical bug, so this file is the only place addresses live.
//
// Sources:
//   domains   — developers.circle.com/cctp/concepts/supported-chains-and-domains
//   cctp v2   — developers.circle.com/cctp/references/contract-addresses
//   usdc/eurc — developers.circle.com/stablecoins/{usdc,eurc}-contract-addresses
//   iris      — developers.circle.com/api-reference/cctp/all/get-messages-v2

import type { Address } from "viem";
import type { PayoutToken } from "./selectRoute";

// ── CCTP V2 protocol addresses ──────────────────────────────────────────────
// CCTP V2 deploys the SAME address on every EVM chain within a network class
// (the only mainnet exception is EDGE, which is out of scope here). So the
// protocol addresses are constants, not per-chain.
export const CCTP_V2_TESTNET = {
  tokenMessengerV2: "0x8FE6B999Dc680CcFDD5Bf7EB0974218be2542DAA" as Address,
  messageTransmitterV2: "0xE737e5cEBEEBa77EFE34D4aa090756590b1CE275" as Address,
} as const;

export const CCTP_V2_MAINNET = {
  tokenMessengerV2: "0x28b5a0e9C621a5BadaA536219b3a228C8168cf5d" as Address,
  messageTransmitterV2: "0x81D40F21F12A8F0E3252Bccb954D722d4c464B64" as Address,
} as const;

// ── CCTP V2 finality thresholds (src/v2/FinalityThresholds.sol) ─────────────
export const CCTP_FINALITY = {
  /** Fast Transfer — soft/confirmed finality, backed by Circle's allowance. */
  FAST: 1000,
  /** Standard Transfer — hard finality, maxFee may be 0. */
  STANDARD: 2000,
  /** Minimum threshold the TokenMessenger will accept. */
  MIN: 500,
} as const;

// ── Iris (attestation) API base URLs ─────────────────────────────────────────
export const IRIS_API = {
  mainnet: "https://iris-api.circle.com",
  testnet: "https://iris-api-sandbox.circle.com",
} as const;

export interface ChainConfig {
  /** Stable registry key, e.g. "baseSepolia". */
  key: string;
  name: string;
  chainId: number;
  /** CCTP domain — the routing key encoded into escrowId byte[1]. */
  cctpDomain: number;
  isTestnet: boolean;
  /** Whether CCTP Fast Transfer (threshold 1000) is available on this chain. */
  fastTransfer: boolean;
  /** Env var the RPC URL is read from (no URL is ever committed). */
  rpcEnvVar: string;
  /** Public default RPC, used when the env var is unset (testnets only). */
  defaultRpcUrl?: string;
  /** Stablecoin addresses. USDC is always present; EURC/USDT only where issued. */
  tokens: Partial<Record<PayoutToken, Address>>;
  /** CCTP V2 protocol addresses for this chain's network class. */
  cctp: { tokenMessengerV2: Address; messageTransmitterV2: Address };
  /** Our deployed contracts — filled in after Phase 3 deploy, per chain. */
  contracts: { paymentEscrow?: Address; settlementReceiver?: Address };
}

// ── Testnet chains (the Phase 3 deploy targets) ─────────────────────────────
const TESTNETS: ChainConfig[] = [
  {
    key: "ethereumSepolia",
    name: "Ethereum Sepolia",
    chainId: 11155111,
    cctpDomain: 0,
    isTestnet: true,
    fastTransfer: true,
    rpcEnvVar: "ETHEREUM_SEPOLIA_RPC_URL",
    tokens: {
      USDC: "0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238",
      EURC: "0x08210F9170F89Ab7658F0B5E3fF39b0E03C594D4",
    },
    cctp: CCTP_V2_TESTNET,
    contracts: {},
  },
  {
    key: "avalancheFuji",
    name: "Avalanche Fuji",
    chainId: 43113,
    cctpDomain: 1,
    isTestnet: true,
    fastTransfer: false, // Avalanche is Standard-only on CCTP V2
    rpcEnvVar: "AVALANCHE_FUJI_RPC_URL",
    defaultRpcUrl: "https://api.avax-test.network/ext/bc/C/rpc",
    tokens: {
      USDC: "0x5425890298aed601595a70AB815c96711a31Bc65",
      EURC: "0x5E44db7996c682E92a960b65AC713a54AD815c6B",
    },
    cctp: CCTP_V2_TESTNET,
    contracts: {},
  },
  {
    key: "optimismSepolia",
    name: "OP Sepolia",
    chainId: 11155420,
    cctpDomain: 2,
    isTestnet: true,
    fastTransfer: true,
    rpcEnvVar: "OP_SEPOLIA_RPC_URL",
    defaultRpcUrl: "https://sepolia.optimism.io",
    tokens: {
      USDC: "0x5fd84259d66Cd46123540766Be93DFE6D43130D7",
      // Circle does not issue EURC on OP — intentionally absent.
    },
    cctp: CCTP_V2_TESTNET,
    contracts: {},
  },
  {
    key: "arbitrumSepolia",
    name: "Arbitrum Sepolia",
    chainId: 421614,
    cctpDomain: 3,
    isTestnet: true,
    fastTransfer: true,
    rpcEnvVar: "ARBITRUM_SEPOLIA_RPC_URL",
    defaultRpcUrl: "https://sepolia-rollup.arbitrum.io/rpc",
    tokens: {
      USDC: "0x75faf114eafb1BDbe2F0316DF893fd58CE46AA4d",
      // Circle does not issue EURC on Arbitrum — intentionally absent.
    },
    cctp: CCTP_V2_TESTNET,
    contracts: {},
  },
  {
    key: "baseSepolia",
    name: "Base Sepolia",
    chainId: 84532,
    cctpDomain: 6,
    isTestnet: true,
    fastTransfer: true,
    rpcEnvVar: "BASE_SEPOLIA_RPC_URL",
    defaultRpcUrl: "https://sepolia.base.org",
    tokens: {
      USDC: "0x036CbD53842c5426634e7929541eC2318f3dCF7e",
      EURC: "0x808456652fdb597867f38412077A9182bf77359F",
    },
    cctp: CCTP_V2_TESTNET,
    // Deployed 2026-06-18 (fee-enabled v2: feeBps skim at settle).
    contracts: {
      paymentEscrow: "0xEdC7FCcB1eD192b298A0e7221108eA9D5fCd930a",
      settlementReceiver: "0x125a105daF0FFA7D76Eb65c884E9c03E29b99862",
    },
  },
  {
    // Circle's own chain. USDC is the NATIVE gas token (18-dp) but the CCTP
    // ERC-20 USDC at 0x3600…0000 is a standard 6-dp ERC-20 (a precompile bridges
    // it to the native balance: 1e18 native = 1e6 ERC-20), so the contracts work
    // unmodified. Standard-only on CCTP (no Fast Transfer) → use threshold 2000.
    key: "arcTestnet",
    name: "Arc Testnet",
    chainId: 5042002,
    cctpDomain: 26,
    isTestnet: true,
    fastTransfer: false,
    rpcEnvVar: "ARC_TESTNET_RPC_URL",
    defaultRpcUrl: "https://rpc.testnet.arc.network",
    tokens: {
      USDC: "0x3600000000000000000000000000000000000000",
      EURC: "0x89B50855Aa3bE2F677cD6303Cec089B5F319D72a",
    },
    cctp: CCTP_V2_TESTNET,
    // Deployed 2026-06-18 (fee-enabled v2: feeBps skim at settle).
    contracts: {
      paymentEscrow: "0xd1a0703CB0527A7677742b156Bd19a6E122A1b3C",
      settlementReceiver: "0x49F9131d09A368a0Cb12504Da90BdE2e3720cc6c",
    },
  },
];

// ── Mainnet chains (registry only; deploy is out of scope, PLAN §8) ─────────
const MAINNETS: ChainConfig[] = [
  {
    key: "ethereum",
    name: "Ethereum",
    chainId: 1,
    cctpDomain: 0,
    isTestnet: false,
    fastTransfer: true,
    rpcEnvVar: "ETHEREUM_RPC_URL",
    tokens: {
      USDC: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48",
      EURC: "0x1aBaEA1f7C830bD89Acc67eC4af516284b1bC33c",
    },
    cctp: CCTP_V2_MAINNET,
    contracts: {},
  },
  {
    key: "avalanche",
    name: "Avalanche C-Chain",
    chainId: 43114,
    cctpDomain: 1,
    isTestnet: false,
    fastTransfer: false,
    rpcEnvVar: "AVALANCHE_RPC_URL",
    tokens: {
      USDC: "0xB97EF9Ef8734C71904D8002F8b6Bc66Dd9c48a6E",
      EURC: "0xC891EB4cbdEFf6e073e859e987815Ed1505c2ACD",
    },
    cctp: CCTP_V2_MAINNET,
    contracts: {},
  },
  {
    key: "optimism",
    name: "OP Mainnet",
    chainId: 10,
    cctpDomain: 2,
    isTestnet: false,
    fastTransfer: true,
    rpcEnvVar: "OPTIMISM_RPC_URL",
    tokens: { USDC: "0x0b2C639c533813f4Aa9D7837CAf62653d097Ff85" },
    cctp: CCTP_V2_MAINNET,
    contracts: {},
  },
  {
    key: "arbitrum",
    name: "Arbitrum One",
    chainId: 42161,
    cctpDomain: 3,
    isTestnet: false,
    fastTransfer: true,
    rpcEnvVar: "ARBITRUM_RPC_URL",
    tokens: { USDC: "0xaf88d065e77c8cC2239327C5EDb3A432268e5831" },
    cctp: CCTP_V2_MAINNET,
    contracts: {},
  },
  {
    key: "base",
    name: "Base",
    chainId: 8453,
    cctpDomain: 6,
    isTestnet: false,
    fastTransfer: true,
    rpcEnvVar: "BASE_RPC_URL",
    tokens: {
      USDC: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
      EURC: "0x60a3E35Cc302bFA44Cb288Bc5a4F316Fdb1adb42",
    },
    cctp: CCTP_V2_MAINNET,
    contracts: {},
  },
  {
    key: "polygon",
    name: "Polygon PoS",
    chainId: 137,
    cctpDomain: 7,
    isTestnet: false,
    fastTransfer: false,
    rpcEnvVar: "POLYGON_RPC_URL",
    tokens: { USDC: "0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359" },
    cctp: CCTP_V2_MAINNET,
    contracts: {},
  },
];

export const CHAINS: readonly ChainConfig[] = [...TESTNETS, ...MAINNETS];

// ── Lookups ─────────────────────────────────────────────────────────────────
const BY_DOMAIN_TESTNET = new Map(TESTNETS.map((c) => [c.cctpDomain, c]));
const BY_DOMAIN_MAINNET = new Map(MAINNETS.map((c) => [c.cctpDomain, c]));
const BY_KEY = new Map(CHAINS.map((c) => [c.key, c]));
const BY_CHAIN_ID = new Map(CHAINS.map((c) => [c.chainId, c]));

/** Resolve a chain by CCTP domain. `testnet` disambiguates the shared domain
 *  (Ethereum mainnet and Sepolia are both domain 0). */
export function getChainByDomain(domain: number, testnet: boolean): ChainConfig | undefined {
  return (testnet ? BY_DOMAIN_TESTNET : BY_DOMAIN_MAINNET).get(domain);
}

export function getChainByKey(key: string): ChainConfig | undefined {
  return BY_KEY.get(key);
}

export function getChainById(chainId: number): ChainConfig | undefined {
  return BY_CHAIN_ID.get(chainId);
}

/** Like getChainByDomain but throws — use on the funds-handling path where a
 *  missing chain must never be silently treated as "skip". */
export function requireChainByDomain(domain: number, testnet: boolean): ChainConfig {
  const c = getChainByDomain(domain, testnet);
  if (!c) throw new Error(`no ${testnet ? "testnet" : "mainnet"} chain for CCTP domain ${domain}`);
  return c;
}

export function getTestnets(): readonly ChainConfig[] {
  return TESTNETS;
}

/** The deploy targets for Phase 3 (≥3 CCTP V2 testnets). Arc is primary — USDC is
 *  its native gas, so one Circle faucet funds deploy + testing. */
export const DEPLOY_TESTNET_KEYS = ["arcTestnet", "baseSepolia", "arbitrumSepolia"] as const;
