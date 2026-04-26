import { Pool } from "pg";
import * as bcryptjs from "bcryptjs";
import { randomBytes, createCipheriv } from "node:crypto";

// bcryptjs may export as default or as named exports depending on module resolution
const bcrypt = (bcryptjs as any).default ?? bcryptjs;

const URL = process.env.POSTGRES_URL ?? "postgres://postgres:postgres@localhost:5432/arcfx";

/** Encrypt a webhook secret using AES-256-GCM with the MASTER_KEY env var. */
function encryptSecret(plaintext: string): { iv: Buffer; ciphertext: Buffer } {
  const masterKey = process.env.MASTER_KEY;
  if (!masterKey) throw new Error("MASTER_KEY missing from env");
  const key = Buffer.from(masterKey, "base64");
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const enc = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = (cipher as any).getAuthTag();
  return { iv, ciphertext: Buffer.concat([enc, tag]) };
}

export function newPool() {
  return new Pool({ connectionString: URL });
}

export async function clearAll() {
  const pool = newPool();
  await pool.query("DELETE FROM webhook_attempts");
  await pool.query("DELETE FROM invoices");
  await pool.query("DELETE FROM merchants");
  await pool.query("DELETE FROM siwe_nonces");
  await pool.query("DELETE FROM indexer_state");
  await pool.end();
}

export async function seedMerchant(opts: {
  address?: string;
  apiKey?: string;
  webhookUrl?: string | null;
} = {}): Promise<{ merchantId: string; apiKey: string; address: string }> {
  const pool = newPool();
  const apiKey = opts.apiKey ?? "ak_live_test_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx";
  const apiKeyHash = await bcrypt.hash(apiKey, 10);
  const address = opts.address ?? "0xe8E5AAa3d8c705A07de02aADF98CE31F20A5754b";
  const { iv: webhookIv, ciphertext: webhookEnc } = encryptSecret("webhook_secret_placeholder");
  const result = await pool.query(
    `INSERT INTO merchants (address, payout_token, webhook_url, api_key_hash, webhook_secret_enc, webhook_secret_iv)
     VALUES ($1, $2, $3, $4, $5, $6)
     RETURNING id`,
    [address, "0x3600000000000000000000000000000000000000", opts.webhookUrl ?? null,
     apiKeyHash, webhookEnc, webhookIv],
  );
  await pool.end();
  return { merchantId: result.rows[0].id, apiKey, address };
}

export async function seedInvoice(opts: {
  merchantId: string;
  status?: "created" | "paid" | "expired";
  expiresAtSecondsFromNow?: number;
}): Promise<string> {
  const pool = newPool();
  const id = "0x" + Buffer.from(crypto.randomUUID().replace(/-/g, "")).toString("hex").slice(0, 64);
  await pool.query(
    `INSERT INTO invoices (id, merchant_id, pay_in_token, amount_out, expires_at, status, success_url)
     VALUES ($1, $2, $3, $4, NOW() + ($5 || ' seconds')::interval, $6, $7)`,
    [id, opts.merchantId, "0x89B50855Aa3bE2F677cD6303Cec089B5F319D72a", "49990000",
     opts.expiresAtSecondsFromNow ?? 1800, opts.status ?? "created",
     "http://localhost:4000/?paid=1"],
  );
  await pool.end();
  return id;
}
