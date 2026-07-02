// Li.Fi integration (PLAN §5.4). Li.Fi is used **only** as a same-chain DEX
// aggregator — NEVER as a bridge (CCTP is the only bridge in this system). This
// module fetches a quote and then defensively rejects it unless EVERY step is a
// same-chain swap: if any step crosses chains or is a bridge, we throw rather
// than execute. The on-chain side enforces finite approvals + minOut; this is the
// off-chain half of that defense in depth (a bridge step must never sneak in).

import type { Address } from "viem";

const LIFI_BASE = "https://li.quest/v1";

export interface LifiQuoteParams {
  /** Same chain for from and to — this is a swap, not a bridge. */
  chainId: number;
  fromToken: Address; // USDC
  toToken: Address; // EURC / USDT
  fromAmount: string; // minor units, decimal-free string
  /** The contract that will execute the swap (PaymentEscrow / SettlementReceiver). */
  fromAddress: Address;
  /** Fractional slippage, e.g. 0.005 = 0.5%. Default 0.005. */
  slippage?: number;
  fetchImpl?: typeof fetch;
  base?: string;
}

export interface SwapPlan {
  /** Router to call — becomes the escrow/receiver `lifiRouter`'s expected target. */
  router: Address;
  /** Calldata to pass to the contract's settle/swap (executed via finite approval). */
  calldata: `0x${string}`;
  /** Native value; must be 0 for an ERC20→ERC20 swap. */
  value: bigint;
  /** Guaranteed-minimum output (minor units) — passed as the contract's `minOut`. */
  minOut: bigint;
}

interface LifiStep {
  type?: string; // "swap" | "cross" | "lifi" | "protocol" | ...
  tool?: string;
  action?: { fromChainId?: number; toChainId?: number };
  includedSteps?: LifiStep[];
}

interface LifiQuote {
  action?: { fromChainId?: number; toChainId?: number };
  estimate?: { toAmountMin?: string };
  includedSteps?: LifiStep[];
  transactionRequest?: { to?: string; data?: string; value?: string };
}

/** Throws if any (possibly nested) step is a bridge or crosses chains. */
export function assertSwapOnly(quote: { includedSteps?: LifiStep[]; action?: LifiStep["action"] }): void {
  const top = quote.action;
  if (top && top.fromChainId !== undefined && top.toChainId !== undefined && top.fromChainId !== top.toChainId) {
    throw new Error(`lifi_bridge_rejected:top_level_cross_chain ${top.fromChainId}->${top.toChainId}`);
  }
  const walk = (steps: LifiStep[] | undefined): void => {
    for (const s of steps ?? []) {
      const t = (s.type ?? "").toLowerCase();
      if (t === "cross" || t === "bridge") {
        throw new Error(`lifi_bridge_rejected:bridge_step tool=${s.tool ?? "?"}`);
      }
      const a = s.action;
      if (a && a.fromChainId !== undefined && a.toChainId !== undefined && a.fromChainId !== a.toChainId) {
        throw new Error(`lifi_bridge_rejected:cross_chain_step ${a.fromChainId}->${a.toChainId}`);
      }
      // "lifi" aggregator steps wrap real sub-steps — recurse so a bridge can't hide.
      walk(s.includedSteps);
    }
  };
  walk(quote.includedSteps);
}

/** Fetch a same-chain swap quote, reject anything that isn't swap-only, and return
 *  the calldata + minOut for the contract to execute under a finite approval. */
export async function getSwapPlan(params: LifiQuoteParams): Promise<SwapPlan> {
  const f = params.fetchImpl ?? fetch;
  const base = params.base ?? LIFI_BASE;
  const slippage = params.slippage ?? 0.005;

  const url = new URL(`${base}/quote`);
  url.searchParams.set("fromChain", String(params.chainId));
  url.searchParams.set("toChain", String(params.chainId)); // same chain — swap, not bridge
  url.searchParams.set("fromToken", params.fromToken);
  url.searchParams.set("toToken", params.toToken);
  url.searchParams.set("fromAmount", params.fromAmount);
  url.searchParams.set("fromAddress", params.fromAddress);
  url.searchParams.set("slippage", String(slippage));
  // Hard-constrain the aggregator to swaps; we still re-validate the response.
  url.searchParams.set("allowBridges", "false");

  const res = await f(url.toString());
  if (!res.ok) throw new Error(`lifi_error:${res.status}`);
  let quote: LifiQuote;
  try {
    quote = (await res.json()) as LifiQuote;
  } catch {
    throw new Error(`lifi_parse_error:${res.status}`);
  }

  assertSwapOnly(quote);

  const tx = quote.transactionRequest;
  if (!tx?.to || !tx.data) throw new Error("lifi_quote_missing_transaction");
  const value = BigInt(tx.value ?? "0");
  if (value !== 0n) throw new Error("lifi_unexpected_native_value");
  const minOut = quote.estimate?.toAmountMin;
  if (minOut === undefined) throw new Error("lifi_quote_missing_minout");

  return {
    router: tx.to as Address,
    calldata: tx.data as `0x${string}`,
    value,
    minOut: BigInt(minOut),
  };
}
