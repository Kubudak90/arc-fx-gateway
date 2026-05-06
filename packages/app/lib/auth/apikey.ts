import bcrypt from "bcryptjs";
import { randomBytes } from "node:crypto";
import { db } from "@/lib/db/client";
import { merchants } from "@/lib/db/schema";
import { eq } from "drizzle-orm";

export const PREFIX_LEN = 12; // "ak_live_" + 4 chars of body
const PREFIX = "ak_live_";
const ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";

export function generateApiKey(): string {
  const bytes = randomBytes(56);
  let out = "";
  for (let i = 0; i < 56; i++) out += ALPHABET[bytes[i]! % ALPHABET.length];
  return PREFIX + out;
}

export async function hashApiKey(key: string): Promise<string> {
  return bcrypt.hash(key, 10);
}

export async function verifyApiKey(key: string, hash: string): Promise<boolean> {
  return bcrypt.compare(key, hash);
}

/** Returns the matching merchant or null. O(1) via api_key_prefix index (audit H2, 2026-05-05). */
export async function lookupMerchantByApiKey(key: string) {
  if (!key.startsWith(PREFIX)) return null;
  const prefix = key.slice(0, PREFIX_LEN);
  const candidates = await db.select().from(merchants).where(eq(merchants.apiKeyPrefix, prefix));
  for (const m of candidates) {
    if (await verifyApiKey(key, m.apiKeyHash)) return m;
  }
  return null;
}
