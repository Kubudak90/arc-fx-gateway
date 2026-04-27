import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { POOL_ABI } from "@/lib/chain/pool-abi";
import { publicClient, POOL } from "@/lib/chain/client";

const Q = z.object({
  from: z.enum(["USDC", "EURC"]),
  to: z.enum(["USDC", "EURC"]),
  amountIn: z.coerce.bigint(),
});

const TOKEN_INDEX = { USDC: 0, EURC: 1 } as const;

export async function GET(req: NextRequest) {
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
