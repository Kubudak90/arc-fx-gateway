import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth/session";
import { db } from "@/lib/db/client";
import { merchants } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { generateApiKey, hashApiKey, PREFIX_LEN } from "@/lib/auth/apikey";

export async function POST() {
  const session = await getSession();
  if (!session.merchantAddress) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const apiKey = generateApiKey();
  const apiKeyHash = await hashApiKey(apiKey);
  const updated = await db.update(merchants)
    .set({ apiKeyHash, apiKeyPrefix: apiKey.slice(0, PREFIX_LEN) })
    .where(eq(merchants.address, session.merchantAddress))
    .returning();
  if (updated.length === 0) return NextResponse.json({ error: "no_merchant" }, { status: 404 });

  session.apiKey = apiKey;
  await session.save();
  return NextResponse.json({ apiKey });
}
