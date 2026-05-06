import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getSession } from "@/lib/auth/session";
import { db } from "@/lib/db/client";
import { merchants } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { generateApiKey, hashApiKey, PREFIX_LEN } from "@/lib/auth/apikey";
import { encrypt } from "@/lib/crypto/secret";
import { assertSafePublicUrl } from "@/lib/security/safeUrl";
import { readAllowance } from "@/lib/chain/erc20";
import type { Address } from "viem";
import { randomBytes } from "node:crypto";

// Audit H1 (2026-05-05): merchant must declare which origins may receive
// customers after a successful payment. We persist `new URL(...).origin`
// (scheme+host+port only) so /api/invoices can validate successUrl/cancelUrl
// at create-time and the checkout client can re-check before redirecting.
// See packages/app/lib/security/safeUrl.ts#assertOriginAllowed.
const Body = z.object({
  payoutToken: z.string().regex(/^0x[0-9a-fA-F]{40}$/),
  webhookUrl: z.string().url().optional(),
  allowedOrigins: z.array(z.string().url()).min(1).max(20),
});

export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session.merchantAddress) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const existing = await db.select().from(merchants).where(eq(merchants.address, session.merchantAddress)).limit(1);
  if (existing.length > 0) return NextResponse.json({ error: "already_bootstrapped" }, { status: 409 });

  const parsed = Body.safeParse(await req.json());
  if (!parsed.success) return NextResponse.json({ error: "bad_body" }, { status: 400 });

  // Audit pass 3 (2026-05-04): bootstrap previously stored any URL that
  // passed `z.string().url()`, including localhost / RFC1918 / link-local
  // addresses. The webhook daemon would later fetch them, exposing internal
  // services. Same SSRF guard the merchant settings PATCH already runs.
  if (parsed.data.webhookUrl) {
    try {
      await assertSafePublicUrl(parsed.data.webhookUrl);
    } catch (e) {
      return NextResponse.json({
        error: "unsafe_webhook_url",
        detail: e instanceof Error ? e.message : String(e),
      }, { status: 400 });
    }
  }

  // Normalize each allowedOrigin to scheme+host[:port] only — anything
  // beyond `URL.origin` (path, query, fragment) is meaningless for the
  // post-payment redirect check and only invites footguns later.
  let allowedOrigins: string[];
  try {
    allowedOrigins = Array.from(
      new Set(parsed.data.allowedOrigins.map((u) => new URL(u).origin)),
    );
  } catch {
    return NextResponse.json({ error: "bad_body" }, { status: 400 });
  }

  const apiKey = generateApiKey();
  const apiKeyHash = await hashApiKey(apiKey);
  const webhookSecret = "whsec_" + randomBytes(32).toString("hex");
  const { iv, ciphertext } = encrypt(webhookSecret);

  await db.insert(merchants).values({
    address: session.merchantAddress,
    payoutToken: parsed.data.payoutToken,
    webhookUrl: parsed.data.webhookUrl ?? null,
    apiKeyHash,
    apiKeyPrefix: apiKey.slice(0, PREFIX_LEN),
    allowedOrigins,
    webhookSecretEnc: ciphertext,
    webhookSecretIv: iv,
  });

  session.apiKey = apiKey;
  await session.save();

  // Audit H4 (2026-05-05): V9 `refundInvoice` pulls funds via
  // `safeTransferFrom(payoutSource, gateway, ...)`. If the payout wallet
  // doesn't approve the gateway with sufficient allowance, refunds revert
  // on-chain. We can't gate bootstrap on RPC (RPC outage shouldn't lock out
  // onboarding), so we surface a best-effort `warning` flag the dashboard
  // renders into a "Grant approval" CTA. V10 custody model removes this.
  const MIN_REFUND_HEADROOM = BigInt(process.env.H4_MIN_BOOTSTRAP_ALLOWANCE ?? "1000000"); // 1 USDC default (6 decimals)
  const GATEWAY_V9_ADDR = (process.env.GATEWAY_ADDRESS_V9 ?? "") as Address;
  let warning: string | undefined;
  try {
    if (GATEWAY_V9_ADDR) {
      const allowance = await readAllowance(
        parsed.data.payoutToken as Address,
        session.merchantAddress as Address,
        GATEWAY_V9_ADDR,
      );
      if (allowance < MIN_REFUND_HEADROOM) warning = "approval_required";
    }
  } catch {
    // RPC outage shouldn't block bootstrap; warning is a best-effort hint.
  }

  return NextResponse.json(
    { apiKey, webhookSecret, ...(warning && { warning }) },
    { status: 201 },
  );
}
