// packages/agent-commerce-cli/src/constants.ts
import { homedir } from "node:os";
import { join } from "node:path";
import { defineChain } from "viem";

export const BASE_URL = "https://arcorapay.xyz";
/** Default merchant key location. onboard/serve/refund all agree on this path. */
export const MERCHANT_KEYFILE = join(homedir(), ".arcora", "merchant.key");
export const ARC_RPC = "https://rpc.testnet.arc.network";
export const CHAIN_ID = 5042002;
export const ARC_USDC = "0x3600000000000000000000000000000000000000";
export const GATEWAY = "0xEaE914D53B2895c832dA83419a7687eF7D1d0142";
export const SERVER_WALLET = "0xb014647253cB2E38BebC9B2a84B64Abc18c883bf";
export const RIGHT_CREATE_INVOICE = 1;
export const FAUCET_URL = "https://faucet.circle.com";
/** Min native Arc gas (USDC, 18-dec wei) before we proceed: ~1 USDC covers the 2 activation txs. */
export const GAS_FLOOR_WEI = 1_000000000000000000n;

export const arcTestnet = defineChain({
  id: CHAIN_ID,
  name: "Arc Testnet",
  nativeCurrency: { name: "USDC", symbol: "USDC", decimals: 18 },
  rpcUrls: { default: { http: [ARC_RPC] } },
});

export const GATEWAY_ABI = [
  { type: "function", name: "registerMerchant", stateMutability: "nonpayable", inputs: [{ name: "payoutAddress", type: "address" }, { name: "payoutToken", type: "address" }], outputs: [] },
  { type: "function", name: "authorizeDelegate", stateMutability: "nonpayable", inputs: [{ name: "delegate", type: "address" }, { name: "expiresAt", type: "uint64" }, { name: "rights", type: "uint8" }], outputs: [] },
  { type: "function", name: "merchants", stateMutability: "view", inputs: [{ name: "merchant", type: "address" }], outputs: [{ name: "payoutAddress", type: "address" }, { name: "payoutToken", type: "address" }, { name: "active", type: "bool" }] },
  { type: "function", name: "delegates", stateMutability: "view", inputs: [{ name: "merchant", type: "address" }, { name: "delegate", type: "address" }], outputs: [{ name: "expiresAt", type: "uint64" }, { name: "rights", type: "uint8" }] },
] as const;
