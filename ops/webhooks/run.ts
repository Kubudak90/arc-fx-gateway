import pg from "pg";
import { createHmac, createDecipheriv } from "node:crypto";

const PG_URL    = need("POSTGRES_URL_NON_POOLING");
const MASTER_B64 = need("MASTER_KEY");
const TICK_MS   = Number(process.env.WEBHOOKS_TICK_MS ?? "10000");
const BATCH     = Number(process.env.WEBHOOKS_BATCH ?? "50");
const MAX_BACKOFF_HOURS  = 24;
const TERMINAL_4XX_AFTER = 3;
const SIG_HEADER = "X-Arcora-Signature";

function need(k: string): string {
  const v = process.env[k];
  if (!v) throw new Error(`missing env ${k}`);
  return v;
}

const MASTER_KEY = (() => {
  const buf = Buffer.from(MASTER_B64, "base64");
  if (buf.length !== 32) throw new Error("MASTER_KEY must be 32 bytes (base64)");
  return buf;
})();

function decryptSecret(iv: Buffer, ciphertext: Buffer): string {
  const TAG_LEN = 16;
  const tag  = ciphertext.subarray(ciphertext.length - TAG_LEN);
  const data = ciphertext.subarray(0, ciphertext.length - TAG_LEN);
  const decipher = createDecipheriv("aes-256-gcm", MASTER_KEY, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(data), decipher.final()]).toString("utf8");
}

function sign(body: string, secret: string): string {
  return `sha256=${createHmac("sha256", secret).update(body).digest("hex")}`;
}

const pool = new pg.Pool({ connectionString: PG_URL, ssl: { rejectUnauthorized: false } });

type Row = {
  id: string;
  invoice_id: string;
  url: string;
  payload: unknown;
  attempts: number;
  webhook_secret_enc: Buffer;
  webhook_secret_iv: Buffer;
};

async function fetchDue(): Promise<Row[]> {
  const r = await pool.query<Row>(
    `select wa.id, wa.invoice_id, wa.url, wa.payload, wa.attempts,
            m.webhook_secret_enc, m.webhook_secret_iv
       from webhook_attempts wa
       join invoices  i on i.id = wa.invoice_id
       join merchants m on m.id = i.merchant_id
      where wa.succeeded_at is null
        and wa.next_attempt <= now()
      order by wa.next_attempt
      limit $1`,
    [BATCH],
  );
  return r.rows;
}

async function markSucceeded(id: string): Promise<void> {
  await pool.query(
    "update webhook_attempts set succeeded_at = now() where id = $1",
    [id],
  );
}

async function markFailed(id: string, attempts: number, lastError: string, status: number): Promise<void> {
  const isTerminal4xx =
    status >= 400 && status < 500 && attempts >= TERMINAL_4XX_AFTER;
  const backoffSec = isTerminal4xx
    ? MAX_BACKOFF_HOURS * 3600
    : Math.min(2 ** attempts, MAX_BACKOFF_HOURS * 3600);
  await pool.query(
    `update webhook_attempts
        set attempts = $2, last_error = $3, next_attempt = now() + ($4 || ' seconds')::interval
      where id = $1`,
    [id, attempts, lastError, backoffSec],
  );
}

async function deliver(row: Row): Promise<{ ok: boolean; status: number; error?: string }> {
  const secret    = decryptSecret(row.webhook_secret_iv, row.webhook_secret_enc);
  const body      = JSON.stringify(row.payload);
  const signature = sign(body, secret);
  try {
    const res = await fetch(row.url, {
      method:  "POST",
      headers: { "content-type": "application/json", [SIG_HEADER]: signature },
      body,
    });
    return { ok: res.ok, status: res.status, error: res.ok ? undefined : `${res.status} ${res.statusText}` };
  } catch (e) {
    return { ok: false, status: 0, error: e instanceof Error ? e.message : "network" };
  }
}

async function tick(): Promise<{ scanned: number; delivered: number; failed: number }> {
  const rows = await fetchDue();
  let delivered = 0, failed = 0;
  for (const row of rows) {
    const r = await deliver(row);
    if (r.ok) { await markSucceeded(row.id); delivered++; }
    else      { await markFailed(row.id, row.attempts + 1, r.error ?? "unknown", r.status); failed++; }
  }
  return { scanned: rows.length, delivered, failed };
}

async function main() {
  console.log(JSON.stringify({ msg: "webhooks.start", tickMs: TICK_MS, batch: BATCH }));
  const stop = async () => { await pool.end().catch(() => {}); process.exit(0); };
  process.on("SIGINT", stop);
  process.on("SIGTERM", stop);

  while (true) {
    try {
      const r = await tick();
      if (r.scanned > 0) {
        console.log(JSON.stringify({ ts: new Date().toISOString(), ...r }));
      }
    } catch (e) {
      console.error(JSON.stringify({
        ts: new Date().toISOString(), msg: "tick.error",
        error: e instanceof Error ? e.message : String(e),
      }));
    }
    await new Promise<void>(r => setTimeout(r, TICK_MS));
  }
}

main();
