import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getSession } from "@/lib/auth/session";
import { db } from "@/lib/db/client";
import { merchants } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { encrypt } from "@/lib/crypto/secret";
import { randomBytes } from "node:crypto";
import { assertSafePublicUrl } from "@/lib/security/safeUrl";

const PatchBody = z.object({ webhookUrl: z.string().url().nullable() });

export async function PATCH(req: NextRequest) {
  const session = await getSession();
  if (!session.merchantAddress) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const parsed = PatchBody.safeParse(await req.json());
  if (!parsed.success) return NextResponse.json({ error: "bad_body" }, { status: 400 });

  // Audit P2 (2026-05-03): block SSRF via merchant-controlled webhook URL.
  // We resolve DNS and reject private/loopback/link-local/cloud-metadata
  // ranges so a merchant cannot point us at internal infra.
  if (parsed.data.webhookUrl) {
    try {
      await assertSafePublicUrl(parsed.data.webhookUrl);
    } catch (e: unknown) {
      const reason = (e as Error).message ?? "url_rejected";
      return NextResponse.json({ error: "webhook_url_rejected", reason }, { status: 400 });
    }
  }

  await db.update(merchants).set({ webhookUrl: parsed.data.webhookUrl })
    .where(eq(merchants.address, session.merchantAddress));
  return NextResponse.json({ ok: true });
}

export async function POST() {
  const session = await getSession();
  if (!session.merchantAddress) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const webhookSecret = "whsec_" + randomBytes(32).toString("hex");
  const { iv, ciphertext } = encrypt(webhookSecret);
  await db.update(merchants)
    .set({ webhookSecretEnc: ciphertext, webhookSecretIv: iv })
    .where(eq(merchants.address, session.merchantAddress));
  return NextResponse.json({ webhookSecret });
}
