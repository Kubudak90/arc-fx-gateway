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

// Active custody-escrow gateway address. Source is `packages/contracts/src/
// ArcFXGateway.sol`; the live deployment is recorded in
// `packages/contracts/deployments/arc-testnet.json` and exposed via
// `GATEWAY_ADDRESS` in every environment. Retired pre-V11 addresses are
// kept in git history only — testnet was wiped 2026-05-20.
export const GATEWAY_ADDRESS: Address =
  (process.env.GATEWAY_ADDRESS
    ?? "0x0000000000000000000000000000000000000000") as Address;

// Keep GATEWAY alias for call sites that haven't migrated yet.
export const GATEWAY = GATEWAY_ADDRESS;

const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";

// 2026-06-18 prod outage: Vercel had GATEWAY_ADDRESS="" (empty string), which
// `??` does not fall through, so invoices anchored to the zero address — the
// tx to 0x0 no-ops without reverting, the handler saw a "successful" receipt,
// and no on-chain invoice existed anywhere. On-chain write paths must resolve
// the gateway through this guard instead of trusting the module constant.
export function requireGatewayAddress(): Address {
  if (!/^0x[0-9a-fA-F]{40}$/.test(GATEWAY_ADDRESS) || GATEWAY_ADDRESS.toLowerCase() === ZERO_ADDRESS) {
    throw new Error("gateway_unconfigured: GATEWAY_ADDRESS env is unset, empty, or the zero address");
  }
  return GATEWAY_ADDRESS;
}
