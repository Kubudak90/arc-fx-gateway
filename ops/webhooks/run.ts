import pg from "pg";
import { createHmac, createDecipheriv } from "node:crypto";
import dns from "node:dns/promises";

const PG_URL    = need("POSTGRES_URL_NON_POOLING");
const MASTER_B64 = need("MASTER_KEY");
const TICK_MS   = Number(process.env.WEBHOOKS_TICK_MS ?? "10000");
const BATCH     = Number(process.env.WEBHOOKS_BATCH ?? "50");
const DELIVERY_TIMEOUT_MS = Number(process.env.WEBHOOKS_TIMEOUT_MS ?? "10000");
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
        and wa.terminal_reason is null
      order by wa.next_attempt
      limit $1`,
    [BATCH],
  );
  return r.rows;
}

async function markSucceeded(id: string): Promise<void> {
  await pool.query(
    "update webhook_attempts set succeeded_at = now(), next_attempt = null where id = $1",
    [id],
  );
}

async function markFailed(id: string, attempts: number, lastError: string, status: number): Promise<void> {
  const isTerminal4xx =
    status >= 400 && status < 500 && attempts >= TERMINAL_4XX_AFTER;
  if (isTerminal4xx) {
    // Audit M5 (2026-05-06): 4xx responses after TERMINAL_4XX_AFTER attempts
    // are permanently terminated. Set terminal_reason and NULL next_attempt
    // so fetchDue (which filters terminal_reason IS NULL) never re-queues
    // this row. Operator must manually clear terminal_reason to retry.
    const reason = `http_${status}`;
    await pool.query(
      `update webhook_attempts
          set attempts = $2, last_error = $3, next_attempt = null, terminal_reason = $4
        where id = $1`,
      [id, attempts, lastError, reason],
    );
  } else {
    const backoffSec = Math.min(2 ** attempts, MAX_BACKOFF_HOURS * 3600);
    await pool.query(
      `update webhook_attempts
          set attempts = $2, last_error = $3, next_attempt = now() + ($4 || ' seconds')::interval
        where id = $1`,
      [id, attempts, lastError, backoffSec],
    );
  }
}

// Audit pass 3 (2026-05-04): even though /api/merchant/bootstrap and
// /api/merchant/webhook PATCH now both run assertSafePublicUrl, the daemon
// re-validates immediately before fetch. Reasons it can still slip past
// app-side validation: existing rows from before the validator landed,
// direct DB edits, DNS rebinding between bootstrap and delivery time,
// resolver reconfig, redirects.
function isPrivateAddress(ip: string): boolean {
  const v4 = ip.match(/^(\d+)\.(\d+)\.(\d+)\.(\d+)$/);
  if (v4) {
    const a = Number(v4[1]);
    const b = Number(v4[2]);
    if (a === 0)   return true;
    if (a === 10)  return true;
    if (a === 127) return true;
    if (a === 169 && b === 254) return true;
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 192 && b === 168) return true;
    if (a === 100 && b >= 64 && b <= 127) return true;
    if (a >= 224)  return true;
    return false;
  }
  const v6 = ip.toLowerCase();
  if (v6 === "::1" || v6 === "::") return true;
  if (v6.startsWith("fe80:")) return true;
  if (v6.startsWith("fc") || v6.startsWith("fd")) return true;
  if (v6.startsWith("ff")) return true;
  if (v6.startsWith("::ffff:")) {
    return isPrivateAddress(v6.replace(/^::ffff:/, ""));
  }
  return false;
}

async function assertSafeAtDelivery(url: string): Promise<void> {
  const parsed = new URL(url);
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error("unsupported_scheme");
  }
  if (process.env.NODE_ENV === "production" && parsed.protocol !== "https:") {
    throw new Error("https_required");
  }
  const records = await dns.lookup(parsed.hostname, { all: true }).catch(() => {
    throw new Error("dns_lookup_failed");
  });
  for (const r of records) {
    if (isPrivateAddress(r.address)) {
      throw new Error(`private_address_blocked:${r.address}`);
    }
  }
}

async function deliver(row: Row): Promise<{ ok: boolean; status: number; error?: string }> {
  // Re-validate the destination right before fetch — closes DNS-rebind /
  // DB-edit / pre-validator-row edge cases.
  try {
    await assertSafeAtDelivery(row.url);
  } catch (e) {
    return { ok: false, status: 0, error: `unsafe_url:${e instanceof Error ? e.message : String(e)}` };
  }

  const secret    = decryptSecret(row.webhook_secret_iv, row.webhook_secret_enc);
  const body      = JSON.stringify(row.payload);
  const signature = sign(body, secret);

  // Manual redirect — a 3xx Location pointing at an internal IP would
  // otherwise bypass the DNS guard. Treat any 3xx as a delivery failure
  // and let the merchant fix their endpoint.
  // Timeout via AbortSignal so a slow/hung peer doesn't pin a relayer
  // tick forever.
  try {
    const res = await fetch(row.url, {
      method:   "POST",
      headers:  { "content-type": "application/json", [SIG_HEADER]: signature },
      body,
      redirect: "manual",
      signal:   AbortSignal.timeout(DELIVERY_TIMEOUT_MS),
    });
    if (res.status >= 300 && res.status < 400) {
      return { ok: false, status: res.status, error: `redirects_blocked:${res.headers.get("location") ?? ""}` };
    }
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
