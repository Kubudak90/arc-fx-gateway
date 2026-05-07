import { createPublicClient, createWalletClient, http, defineChain, type Address } from "viem";
import { loadServerWallet } from "@/lib/wallet/server-wallet";

export const arcTestnet = defineChain({
  id: 5042002,
  name: "Arc Testnet",
  nativeCurrency: { name: "USDC", symbol: "USDC", decimals: 18 },
  rpcUrls: {
    default: { http: [process.env.ARC_TESTNET_RPC ?? "https://rpc.testnet.arc.network"] },
  },
  blockExplorers: { default: { name: "Arcscan", url: "https://testnet.arcscan.app" } },
});

export const publicClient = createPublicClient({
  chain: arcTestnet,
  transport: http(),
});

export async function getServerWalletClient() {
  const account = await loadServerWallet();
  return createWalletClient({ account, chain: arcTestnet, transport: http() });
}

export const POOL: Address = (process.env.POOL_ADDRESS ?? "0x0000000000000000000000000000000000000000") as Address;

// V10 custody gateway address. Throws at import time if unset so a missing
// env var surfaces immediately rather than failing at first RPC call.
const _v10 = process.env.GATEWAY_ADDRESS_V10;
export const GATEWAY_ADDRESS: Address = (_v10 ?? "0x0000000000000000000000000000000000000000") as Address;

// Keep GATEWAY alias for call sites that haven't migrated yet.
export const GATEWAY = GATEWAY_ADDRESS;
