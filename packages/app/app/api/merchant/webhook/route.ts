import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getSession } from "@/lib/auth/session";
import { db } from "@/lib/db/client";
import { merchants } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { encrypt } from "@/lib/crypto/secret";
import { randomBytes } from "node:crypto";

const PatchBody = z.object({ webhookUrl: z.string().url().nullable() });

export async function PATCH(req: NextRequest) {
  const session = await getSession();
  if (!session.merchantAddress) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const parsed = PatchBody.safeParse(await req.json());
  if (!parsed.success) return NextResponse.json({ error: "bad_body" }, { status: 400 });

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
