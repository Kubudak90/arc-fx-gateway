import { AppKit } from "@circle-fin/app-kit";
import { createViemAdapterFromPrivateKey } from "@circle-fin/adapter-viem-v2";
import { generatePrivateKey } from "viem/accounts";

/**
 * Server-side App Kit quote helper. Used by /api/checkout/authorize to
 * compute the min_amount_in for cross-token invoices without an HTTP
 * round-trip back to /api/checkout/quote. Same adapter pattern: we
 * fabricate a throwaway viem adapter so App Kit has a chain context;
 * estimateSwap doesn't broadcast or sign anything that hits the chain.
 *
 * Returns the resolved customer payIn in base units (6-decimal stables on
 * Arc Testnet — USDC, EURC). Caller is expected to apply its own slack /
 * cushion before storing as min_amount_in.
 */

const kit = new AppKit();

let cachedAdapter: ReturnType<typeof createViemAdapterFromPrivateKey> | null = null;
function getAdapter() {
  if (!cachedAdapter) {
    cachedAdapter = createViemAdapterFromPrivateKey({ privateKey: generatePrivateKey() });
  }
  return cachedAdapter;
}

const STABLE_DECIMALS = 6;

function humanize(baseUnits: bigint, decimals: number): string {
  const scale = 10n ** BigInt(decimals);
  const whole = baseUnits / scale;
  const frac  = (baseUnits % scale).toString().padStart(decimals, "0").replace(/0+$/, "");
  return frac.length === 0 ? whole.toString() : `${whole}.${frac}`;
}

function parseHuman(amount: string, decimals: number): bigint {
  const [whole = "0", fracRaw = ""] = amount.split(".");
  const frac = fracRaw.padEnd(decimals, "0").slice(0, decimals);
  return BigInt(whole) * 10n ** BigInt(decimals) + BigInt(frac || "0");
}

export interface ServerQuoteParams {
  payInToken:           "USDC" | "EURC";
  payoutToken:          "USDC" | "EURC";
  /** Merchant floor in payoutToken base units (= invoice.amountOut). */
  targetOutputBaseUnits: bigint;
  /** Slippage bps for the recommended payIn. Default 250 (2.5%). */
  slippageBps?:         number;
}

export interface ServerQuoteResult {
  recommendedPayInBaseUnits: bigint;
  estimatedOutputBaseUnits:  bigint;
}

export async function estimateSwapForTarget(params: ServerQuoteParams): Promise<ServerQuoteResult> {
  const kitKey = process.env.KIT_KEY;
  if (!kitKey) throw new Error("KIT_KEY missing");

  const customFeeBps = Number(process.env.CUSTOM_FEE_BPS ?? "100");
  const feeRecipient = process.env.CUSTOM_FEE_RECIPIENT;

  // Probe the rate with 1.0 of payInToken (matches /api/checkout/quote so
  // both clients see the same numbers within the same request burst).
  const probe = await kit.estimateSwap({
    from:     { adapter: getAdapter(), chain: "Arc_Testnet" as const },
    tokenIn:  params.payInToken,
    tokenOut: params.payoutToken,
    amountIn: "1.0",
    config:   {
      kitKey,
      slippageBps: Number(process.env.SLIPPAGE_BPS ?? "100"),
      ...(feeRecipient ? { customFee: { percentageBps: customFeeBps, recipientAddress: feeRecipient } } : {}),
    },
  });
  const probeOut = (probe as { estimatedOutput?: { amount: string } }).estimatedOutput?.amount;
  if (!probeOut) throw new Error("probe quote returned no estimatedOutput");

  const targetHuman = humanize(params.targetOutputBaseUnits, STABLE_DECIMALS);
  const target = parseFloat(targetHuman);
  const rate   = parseFloat(probeOut);
  const buffer = 1 + (params.slippageBps ?? 250) / 10_000;
  const recommendedHuman = (target / rate * buffer).toFixed(STABLE_DECIMALS);
  const recommended = parseHuman(recommendedHuman, STABLE_DECIMALS);

  // Run a second estimate with the resolved amountIn for the estimated output.
  const final = await kit.estimateSwap({
    from:     { adapter: getAdapter(), chain: "Arc_Testnet" as const },
    tokenIn:  params.payInToken,
    tokenOut: params.payoutToken,
    amountIn: recommendedHuman,
    config:   { kitKey, slippageBps: Number(process.env.SLIPPAGE_BPS ?? "100") },
  });
  const finalOut = (final as { estimatedOutput?: { amount: string } }).estimatedOutput?.amount ?? "0";

  return {
    recommendedPayInBaseUnits: recommended,
    estimatedOutputBaseUnits:  parseHuman(finalOut, STABLE_DECIMALS),
  };
}
