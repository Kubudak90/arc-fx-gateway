// packages/agent-commerce-core/src/refund.ts
//
// Merchant-initiated on-chain refund of a PAID invoice on Arc. The invoiceId
// returned by create_invoice IS the on-chain bytes32 globalId — it is passed
// straight to refundInvoice(bytes32 globalId) on the ArcFXGateway. The escrowed
// USDC is returned to the ORIGINAL payer (inv.paidBy); funds cannot be
// redirected. Valid only while the invoice is Paid and within the 7-day refund
// window (enforced on-chain).
//
// Core stays self-contained (no cross-package import to the CLI). The stable
// testnet chain constants are duplicated locally — that is intentional.
import {
  createPublicClient,
  createWalletClient,
  defineChain,
  http,
  type Account,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";

// --- Arc testnet constants (duplicated from the CLI's constants.ts on purpose;
//     core must not import from the cli package). ---
export const ARC_RPC = "https://rpc.testnet.arc.network";
export const GATEWAY = "0xEaE914D53B2895c832dA83419a7687eF7D1d0142";
export const CHAIN_ID = 5042002;

export const arcTestnet = defineChain({
  id: CHAIN_ID,
  name: "Arc Testnet",
  nativeCurrency: { name: "USDC", symbol: "USDC", decimals: 18 },
  rpcUrls: { default: { http: [ARC_RPC] } },
});

export const REFUND_ABI = [
  {
    type: "function",
    name: "refundInvoice",
    stateMutability: "nonpayable",
    inputs: [{ name: "globalId", type: "bytes32" }],
    outputs: [],
  },
] as const;

const INVOICE_ID_RE = /^0x[0-9a-fA-F]{64}$/;

export interface RefundResult {
  invoiceId: string;
  txHash: `0x${string}`;
  status: "success";
}

/** The minimal chain surface refund() needs — lets tests inject a fake and
 *  keeps the on-chain call out of unit tests (no funds, no live invoice). */
export interface RefundClients {
  writeContract(args: {
    address: `0x${string}`;
    abi: typeof REFUND_ABI;
    functionName: "refundInvoice";
    args: readonly [`0x${string}`];
    account: Account;
    chain: typeof arcTestnet;
  }): Promise<`0x${string}`>;
  waitForReceipt(hash: `0x${string}`): Promise<{ status: "success" | "reverted" }>;
}

export interface RefunderOptions {
  privateKey: `0x${string}`;
  rpcUrl?: string;
  gateway?: `0x${string}`;
  chainId?: number;
  /** Inject to mock the chain in tests; omit to build real viem clients. */
  clients?: RefundClients;
}

export interface Refunder {
  refund(invoiceId: string): Promise<RefundResult>;
}

export function createRefunder(opts: RefunderOptions): Refunder {
  const rpcUrl = opts.rpcUrl ?? ARC_RPC;
  const gateway = (opts.gateway ?? GATEWAY) as `0x${string}`;
  const chainId = opts.chainId ?? CHAIN_ID;
  const chain: typeof arcTestnet =
    chainId === CHAIN_ID
      ? arcTestnet
      : (defineChain({ ...arcTestnet, id: chainId }) as typeof arcTestnet);

  const account = privateKeyToAccount(opts.privateKey);

  function buildClients(): RefundClients {
    const publicClient = createPublicClient({ chain, transport: http(rpcUrl) });
    const walletClient = createWalletClient({ account, chain, transport: http(rpcUrl) });
    return {
      writeContract: (args) => walletClient.writeContract(args as never),
      waitForReceipt: async (hash) => {
        const receipt = await publicClient.waitForTransactionReceipt({ hash });
        return { status: receipt.status };
      },
    };
  }

  return {
    async refund(invoiceId: string): Promise<RefundResult> {
      if (!INVOICE_ID_RE.test(invoiceId)) throw new Error("invalid_invoice_id");
      const clients = opts.clients ?? buildClients();
      const txHash = await clients.writeContract({
        address: gateway,
        abi: REFUND_ABI,
        functionName: "refundInvoice",
        args: [invoiceId as `0x${string}`],
        account,
        chain,
      });
      const receipt = await clients.waitForReceipt(txHash);
      if (receipt.status !== "success") throw new Error(`refund_reverted:${txHash}`);
      return { invoiceId, txHash, status: "success" };
    },
  };
}
