import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getSession } from "@/lib/auth/session";
import { db } from "@/lib/db/client";
import { merchants } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { generateApiKey, hashApiKey, PREFIX_LEN } from "@/lib/auth/apikey";
import { encrypt } from "@/lib/crypto/secret";
import { assertSafePublicUrl } from "@/lib/security/safeUrl";
import { randomBytes } from "node:crypto";

const Body = z.object({
  payoutToken: z.string().regex(/^0x[0-9a-fA-F]{40}$/),
  webhookUrl: z.string().url().optional(),
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
    webhookSecretEnc: ciphertext,
    webhookSecretIv: iv,
  });

  session.apiKey = apiKey;
  await session.save();

  return NextResponse.json({ apiKey, webhookSecret }, { status: 201 });
}
