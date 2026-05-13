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

// Active custody-escrow gateway address. Prefers V11 (audit-fix bytecode,
// deployed 2026-05-13) when configured; falls back to V10 for environments
// that haven't been cut over yet. New invoice creation always targets this
// address; legacy escrows on V10 stay claimable via direct calls until the
// 7d refund + 7d recovery window closes.
const _v11 = process.env.GATEWAY_ADDRESS_V11;
const _v10 = process.env.GATEWAY_ADDRESS_V10;
export const GATEWAY_ADDRESS: Address = (_v11 ?? _v10 ?? "0x0000000000000000000000000000000000000000") as Address;

/** OG V10 address, exposed for indexer dual-watch / legacy escrow tools. */
export const GATEWAY_ADDRESS_V10_LEGACY: Address =
  (_v10 ?? "0x0000000000000000000000000000000000000000") as Address;

// Keep GATEWAY alias for call sites that haven't migrated yet.
export const GATEWAY = GATEWAY_ADDRESS;
