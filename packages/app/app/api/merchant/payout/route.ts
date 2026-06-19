import { NextRequest } from "next/server";
import { z } from "zod";
import { eq } from "drizzle-orm";
import { getSession } from "@/lib/auth/session";
import { db } from "@/lib/db/client";
import { merchants } from "@/lib/db/schema";
import { isSameOrigin, isJsonContentType } from "@/lib/security/csrf";
import { privateJson } from "@/lib/security/respond";
import { getChainById, type PayoutToken } from "@arcora/router";

/**
 * v2 merchant payout config (PLAN §6). The merchant settles to their OWN address
 * on `payoutChainId` in `payoutCurrency` — there is NO custody gateway and NO
 * on-chain read here (unlike the v1 /payout-token route which mirrored the
 * gateway's merchant struct). We validate the chain has deployed v2 contracts and
 * issues the chosen currency, then persist the triple. Existing invoices freeze
 * their payout config at create.
 */
const Body = z.object({
  payoutChainId: z.number().int().positive(),
  payoutCurrency: z.enum(["USDC", "EURC", "USDT"]),
  payoutAddress: z.string().regex(/^0x[0-9a-fA-F]{40}$/),
});

export async function POST(req: NextRequest) {
  // Same CSRF + content-type + session guards as the sibling merchant routes.
  if (!isSameOrigin(req)) return privateJson({ error: "csrf" }, { status: 403 });
  if (!isJsonContentType(req)) return privateJson({ error: "unsupported_content_type" }, { status: 415 });
  const session = await getSession();
  if (!session.merchantAddress) return privateJson({ error: "unauthorized" }, { status: 401 });

  const parsed = Body.safeParse(await req.json());
  if (!parsed.success) return privateJson({ error: "bad_body", detail: parsed.error.format() }, { status: 400 });
  const { payoutChainId, payoutCurrency, payoutAddress } = parsed.data;

  const chain = getChainById(payoutChainId);
  if (!chain || !chain.contracts.settlementReceiver) {
    return privateJson({ error: "payout_chain_unsupported", detail: `No deployed v2 contracts for chain ${payoutChainId}.` }, { status: 400 });
  }
  if (!chain.tokens[payoutCurrency as PayoutToken]) {
    return privateJson({ error: "currency_not_on_chain", detail: `${payoutCurrency} is not issued on ${chain.name}.` }, { status: 400 });
  }

  await db
    .update(merchants)
    .set({ payoutChainId, payoutCurrency, payoutAddress })
    .where(eq(merchants.address, session.merchantAddress));

  return privateJson({ ok: true, payoutChainId, payoutCurrency, payoutAddress });
}
