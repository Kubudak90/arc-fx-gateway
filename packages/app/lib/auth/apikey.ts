import bcrypt from "bcryptjs";
import { randomBytes } from "node:crypto";
import { db } from "@/lib/db/client";
import { merchants } from "@/lib/db/schema";

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

/** Returns the matching merchant or null. O(N merchants) — acceptable for demo scale. */
export async function lookupMerchantByApiKey(key: string) {
  if (!key.startsWith(PREFIX)) return null;
  const all = await db.select().from(merchants);
  for (const m of all) {
    if (await verifyApiKey(key, m.apiKeyHash)) return m;
  }
  return null;
}
