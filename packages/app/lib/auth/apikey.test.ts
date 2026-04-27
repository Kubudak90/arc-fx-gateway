import { describe, it, expect, beforeEach } from "vitest";
import { generateApiKey, hashApiKey, verifyApiKey, lookupMerchantByApiKey } from "./apikey";
import { db } from "@/lib/db/client";
import { merchants, invoices, webhookAttempts } from "@/lib/db/schema";
import { randomBytes } from "node:crypto";

beforeEach(async () => {
  // Order matters: webhookAttempts → invoices → merchants (FK chain)
  await db.delete(webhookAttempts);
  await db.delete(invoices);
  await db.delete(merchants);
  process.env.MASTER_KEY = randomBytes(32).toString("base64");
});

describe("api key", () => {
  it("generateApiKey returns prefixed 64-char string", () => {
    const k = generateApiKey();
    expect(k).toMatch(/^ak_live_[A-Za-z0-9]{56}$/);
  });

  it("hashApiKey + verifyApiKey round-trip", async () => {
    const a = await hashApiKey("ak_live_xxx");
    const b = await hashApiKey("ak_live_xxx");
    expect(a).not.toBe(b); // bcrypt salt makes hashes differ
    expect(await verifyApiKey("ak_live_xxx", a)).toBe(true);
    expect(await verifyApiKey("ak_live_xxx", b)).toBe(true);
    expect(await verifyApiKey("ak_live_yyy", a)).toBe(false);
  });

  it("lookupMerchantByApiKey returns the merchant when key matches", async () => {
    const k = generateApiKey();
    const hash = await hashApiKey(k);
    await db.insert(merchants).values({
      address: "0x" + "a".repeat(40),
      payoutToken: "0x" + "b".repeat(40),
      apiKeyHash: hash,
      webhookSecretEnc: Buffer.alloc(48),
      webhookSecretIv: Buffer.alloc(12),
    });
    const m = await lookupMerchantByApiKey(k);
    expect(m).not.toBeNull();
    expect(m!.address).toBe("0x" + "a".repeat(40));
  });

  it("lookupMerchantByApiKey returns null on bad key", async () => {
    expect(await lookupMerchantByApiKey("ak_live_nonexistent")).toBeNull();
  });
});
