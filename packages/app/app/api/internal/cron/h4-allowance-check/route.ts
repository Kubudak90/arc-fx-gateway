import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db/client";
import { merchants, invoices } from "@/lib/db/schema";
import { eq, and, inArray, sum } from "drizzle-orm";
import { readAllowance } from "@/lib/chain/erc20";
import { type Address, isAddress } from "viem";

/**
 * Audit H4 (2026-05-05) — Refund-approval invariant for V9 gateway.
 *
 * V9 `refundInvoice` calls `safeTransferFrom(payoutSource, gateway, ...)`. If
 * the merchant revokes or under-funds their ERC20 allowance, refunds revert
 * on-chain. This hourly cron flags merchants whose allowance < their
 * outstanding refund liability so an operator can chase before customers
 * actually need refunds. V10 custody model removes the dependency entirely
 * — see docs/runbooks/h4-refund-approval.md.
 *
 * Auth: shared secret in `CRON_SECRET`. Vercel Cron sends `Authorization:
 * Bearer ${secret}`; we also accept the raw secret in `x-cron-secret` so
 * curl-from-script callers (ops box, manual smoke) work.
 */

const GATEWAY_V9_ADDR = (process.env.GATEWAY_ADDRESS_V9 ?? "") as Address;

export async function GET(req: NextRequest) {
  const provided = req.headers.get("authorization") ?? req.headers.get("x-cron-secret") ?? "";
  const expected = process.env.CRON_SECRET ?? "";
  if (!expected || !(provided === `Bearer ${expected}` || provided === expected)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  if (!GATEWAY_V9_ADDR) {
    return NextResponse.json({ skipped: "v9_not_configured" });
  }

  const all = await db.select().from(merchants);
  const flagged: Array<{ id: string; address: string; payoutToken: string; need: string; have: string }> = [];

  for (const m of all) {
    if (!isAddress(m.address) || !isAddress(m.payoutToken)) continue;
    // Sum of paid (unrefunded) invoices = upper bound of refund liability.
    // Real liability is bounded by what's actually refundable, but the sum
    // of paid is the safe upper bound — better to over-flag than under.
    const liabilityRows = await db
      .select({ total: sum(invoices.merchantPayout).as("total") })
      .from(invoices)
      .where(and(
        eq(invoices.merchantId, m.id),
        inArray(invoices.status, ["paid"]),
      ));
    const need = BigInt(liabilityRows[0]?.total ?? "0");
    if (need === 0n) continue;
    let have: bigint;
    try {
      have = await readAllowance(m.payoutToken as Address, m.address as Address, GATEWAY_V9_ADDR);
    } catch {
      // RPC issue — skip rather than spuriously page.
      continue;
    }
    if (have < need) {
      flagged.push({
        id: m.id,
        address: m.address,
        payoutToken: m.payoutToken,
        need: need.toString(),
        have: have.toString(),
      });
    }
  }

  return NextResponse.json({
    checked: all.length,
    flagged: flagged.length,
    merchants: flagged,
    runAt: new Date().toISOString(),
  });
}
