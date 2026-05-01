import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { AppKit } from "@circle-fin/app-kit";
import { createViemAdapterFromPrivateKey } from "@circle-fin/adapter-viem-v2";
import { generatePrivateKey } from "viem/accounts";

/**
 * v0.8 quote endpoint. Uses Circle's App Kit Swap to fetch a real RFQ quote
 * from the Arc maker network. Replaces the v0.6 `/api/quote` (which read our
 * own pool); both endpoints coexist while the cutover happens.
 *
 * The estimate doesn't broadcast or sign anything that hits the chain — App
 * Kit just needs an adapter shape for chain context. We fabricate one with
 * a per-cold-start throwaway key so no funded private key has to exist in
 * the Vercel env.
 */

// The endpoint supports two modes:
//   1. forward      — caller knows amountIn, asks for estimated amountOut.
//   2. targetOutput — caller knows amountOut (the merchant's floor) and
//                     wants the payIn that delivers it. Used by the v0.8
//                     hosted checkout, where the customer's payIn isn't
//                     fixed up front. Internally we probe the rate with a
//                     1.0 sample and divide.
const Q = z.object({
  payInToken:   z.enum(["USDC", "EURC"]),
  payoutToken:  z.enum(["USDC", "EURC"]),
  amountIn:     z.string().regex(/^\d+(\.\d+)?$/).optional(),
  targetOutput: z.string().regex(/^\d+(\.\d+)?$/).optional(),
  /** Slippage buffer added to the recommended payIn in targetOutput mode.
   *  Default 500 bps (5%) — wide enough that mid-quote rate drift won't
   *  push the actual swap below the merchant's amountOut floor. */
  slippageBps:  z.number().int().min(0).max(2000).optional(),
}).refine(d => d.amountIn || d.targetOutput, {
  message: "either amountIn or targetOutput is required",
});

// Created lazily on first request, reused across warm invocations within a
// single Lambda. Adapter creation has no chain interaction, so there's no
// nonce or balance state to leak.
let cachedAdapter: ReturnType<typeof createViemAdapterFromPrivateKey> | null = null;

function getAdapter() {
  if (!cachedAdapter) {
    cachedAdapter = createViemAdapterFromPrivateKey({ privateKey: generatePrivateKey() });
  }
  return cachedAdapter;
}

const kit = new AppKit();

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  const parsed = Q.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "bad_params", details: parsed.error.issues }, { status: 400 });
  }
  const { payInToken, payoutToken, amountIn, targetOutput, slippageBps } = parsed.data;
  if (payInToken === payoutToken) {
    return NextResponse.json({ error: "same_token" }, { status: 400 });
  }

  const kitKey = process.env.KIT_KEY;
  if (!kitKey) {
    return NextResponse.json({ error: "kit_key_missing" }, { status: 500 });
  }

  try {
    let resolvedAmountIn = amountIn;

    // targetOutput mode: probe the rate with a 1.0 sample, divide, add a
    // slippage cushion. This is the path the hosted checkout takes when
    // the customer hasn't been asked to pick a payIn manually.
    if (!resolvedAmountIn && targetOutput) {
      const probe = await kit.estimateSwap({
        from:     { adapter: getAdapter(), chain: "Arc_Testnet" as const },
        tokenIn:  payInToken,
        tokenOut: payoutToken,
        amountIn: "1.0",
        config:   { kitKey, slippageBps: Number(process.env.SLIPPAGE_BPS ?? "100") },
      });
      const probeOut = (probe as { estimatedOutput?: { amount: string } }).estimatedOutput?.amount;
      if (!probeOut) throw new Error("probe quote returned no estimatedOutput");
      // amountIn = targetOutput / rate, where rate = probeOut/1.0
      const target  = parseFloat(targetOutput);
      const rate    = parseFloat(probeOut);
      const buffer  = 1 + (slippageBps ?? 500) / 10_000;
      // Round up to 6 decimals so we never quote below what's needed.
      const recommended = Math.ceil((target / rate * buffer) * 1_000_000) / 1_000_000;
      resolvedAmountIn = recommended.toFixed(6);
    }

    if (!resolvedAmountIn) {
      return NextResponse.json({ error: "missing_amount" }, { status: 400 });
    }

    const estimate = await kit.estimateSwap({
      from:     { adapter: getAdapter(), chain: "Arc_Testnet" as const },
      tokenIn:  payInToken,
      tokenOut: payoutToken,
      amountIn: resolvedAmountIn,
      config:   { kitKey, slippageBps: Number(process.env.SLIPPAGE_BPS ?? "100") },
    });

    const e = estimate as {
      estimatedOutput?: { amount: string; token: string };
      stopLimit?:       { amount: string; token: string };
      fees?:            readonly { token: string; amount: string; type: string }[];
    };

    return NextResponse.json({
      payInToken, payoutToken,
      amountIn:        resolvedAmountIn,
      estimatedOutput: e.estimatedOutput?.amount,
      stopLimit:       e.stopLimit?.amount,
      fees:            e.fees ?? [],
      // 30 seconds is the lifetime the SDK shows the operator before forcing a
      // refresh; the underlying RFQ rate moves and old quotes won't fill.
      ttlSeconds:      30,
      issuedAt:        new Date().toISOString(),
    });
  } catch (err) {
    return NextResponse.json({
      error:   "estimate_failed",
      message: err instanceof Error ? err.message : String(err),
    }, { status: 502 });
  }
}
