/**
 * One-shot: bind a real API key + webhook secret stub to the v0.8 merchant
 * row created by the e2e tests, so /api/invoices?engine=v8 has something
 * usable. Prints the API key once — copy it for the curl test, we don't
 * store it again.
 */
import "dotenv/config";
import pg from "pg";
import bcrypt from "bcryptjs";
import { randomBytes } from "node:crypto";

const DATABASE_URL = process.env.DATABASE_URL_UNPOOLED ?? process.env.DATABASE_URL;
if (!DATABASE_URL) throw new Error("missing DATABASE_URL");

const MERCHANT_ADDR = "0xe8e5aaa3d8c705a07de02aadf98ce31f20a5754b";

function generateKey(): string {
  const ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  const b = randomBytes(56);
  let out = "ak_live_";
  for (let i = 0; i < 56; i++) out += ALPHABET[b[i]! % ALPHABET.length];
  return out;
}

async function main() {
  const client = new pg.Client({ connectionString: DATABASE_URL, ssl: { rejectUnauthorized: false } });
  await client.connect();
  try {
    const r = await client.query<{ id: string; payout_token: string }>(
      "select id, payout_token from merchants where lower(address) = $1 limit 1",
      [MERCHANT_ADDR],
    );
    if (r.rowCount === 0) {
      console.error("merchant row not found — run ops/relayer/e2e-test.ts once to bootstrap");
      process.exit(1);
    }
    const merchantId = r.rows[0]!.id;
    const key  = generateKey();
    const hash = await bcrypt.hash(key, 10);

    // 32-byte placeholder webhook secret + 12-byte placeholder IV. Webhook
    // delivery for v0.8 isn't wired into demo merchants yet; this just
    // satisfies the NOT NULL columns so the row is queryable.
    const stubSecret = randomBytes(32);
    const stubIv     = randomBytes(12);

    await client.query(
      `update merchants
          set api_key_hash       = $2,
              webhook_secret_enc = $3::bytea,
              webhook_secret_iv  = $4::bytea
        where id = $1`,
      [merchantId, hash, stubSecret, stubIv],
    );

    console.log("merchant.id:", merchantId);
    console.log("merchant.address:", MERCHANT_ADDR);
    console.log("payout_token:", r.rows[0]!.payout_token);
    console.log("\nAPI KEY (save this — it is not retrievable later):");
    console.log(key);
  } finally {
    await client.end();
  }
}

main().catch(e => { console.error(e); process.exit(1); });
