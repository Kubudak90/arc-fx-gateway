import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { POOL_ABI } from "@/lib/chain/pool-abi";
import { publicClient, POOL } from "@/lib/chain/client";
import { takeToken } from "@/lib/rate/limiter";
import { clientIp } from "@/lib/rate/clientIp";

/**
 * v0.6 quote endpoint. Reads our own on-chain pool (calculateSwap).
 * Superseded by POST /api/checkout/quote (v0.8, App Kit RFQ), but kept
 * alive until any remaining SDK/demo-merchant consumers cut over. The
 * v0.8 route already carries a per-IP rate limit; v0.6 used to be wide
 * open and could be hammered to exhaust the shared publicClient RPC
 * quota that the relayer and indexer also use.
 *
 * Audit App-L1 (2026-05-24): match v0.8's per-IP limiter shape so a
 * legacy caller can't accidentally take the platform-wide RPC quota down
 * with it. Same fail-open posture.
 */
const QUOTE_LIMIT = 30;
const QUOTE_WINDOW_SECONDS = 60;

const Q = z.object({
  from: z.enum(["USDC", "EURC"]),
  to: z.enum(["USDC", "EURC"]),
  amountIn: z.coerce.bigint(),
});

const TOKEN_INDEX = { USDC: 0, EURC: 1 } as const;

export async function GET(req: NextRequest) {
  const ip = clientIp(req);
  let allowed = true;
  try {
    allowed = await takeToken(`quote-v06:${ip}`, QUOTE_LIMIT, QUOTE_WINDOW_SECONDS);
  } catch {
    // Fail-open: limiter outage shouldn't block legitimate traffic.
    allowed = true;
  }
  if (!allowed) {
    return NextResponse.json(
      { error: "rate_limited", retryAfterSeconds: QUOTE_WINDOW_SECONDS },
      { status: 429, headers: { "retry-after": String(QUOTE_WINDOW_SECONDS) } },
    );
  }

  const params = Object.fromEntries(new URL(req.url).searchParams);
  const parsed = Q.safeParse(params);
  if (!parsed.success) return NextResponse.json({ error: "bad_params" }, { status: 400 });
  const { from, to, amountIn } = parsed.data;
  if (from === to) return NextResponse.json({ error: "same_token" }, { status: 400 });

  const out = await publicClient.readContract({
    address: POOL,
    abi: POOL_ABI,
    functionName: "calculateSwap",
    args: [TOKEN_INDEX[from], TOKEN_INDEX[to], amountIn],
  });
  return NextResponse.json({ from, to, amountIn: amountIn.toString(), amountOut: out.toString() });
}
