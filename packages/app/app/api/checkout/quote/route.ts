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

const Q = z.object({
  payInToken:  z.enum(["USDC", "EURC"]),
  payoutToken: z.enum(["USDC", "EURC"]),
  amountIn:    z.string().regex(/^\d+(\.\d+)?$/, "amountIn must be a decimal string like '1.50'"),
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
  const { payInToken, payoutToken, amountIn } = parsed.data;
  if (payInToken === payoutToken) {
    return NextResponse.json({ error: "same_token" }, { status: 400 });
  }

  const kitKey = process.env.KIT_KEY;
  if (!kitKey) {
    return NextResponse.json({ error: "kit_key_missing" }, { status: 500 });
  }

  try {
    const estimate = await kit.estimateSwap({
      from:     { adapter: getAdapter(), chain: "Arc_Testnet" as const },
      tokenIn:  payInToken,
      tokenOut: payoutToken,
      amountIn,
      config:   { kitKey, slippageBps: Number(process.env.SLIPPAGE_BPS ?? "100") },
    });

    const e = estimate as {
      estimatedOutput?: { amount: string; token: string };
      stopLimit?:       { amount: string; token: string };
      fees?:            readonly { token: string; amount: string; type: string }[];
    };

    return NextResponse.json({
      payInToken, payoutToken, amountIn,
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
