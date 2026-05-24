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
const SIG_HEADER     = "X-Arcora-Signature";       // legacy: sha256(body)
// Audit 2026-05-24 Ops-M2 — replay protection. We dual-sign every delivery:
// the legacy header is kept verbatim so existing receivers don't break, and
// V2 (timestamp + sig-over-timestamp.body) lets receivers reject deliveries
// older than their tolerance window. WP receiver prefers V2 when present.
const SIG_HEADER_V2  = "X-Arcora-Signature-V2";    // sha256("<ts>.<body>")
const TS_HEADER      = "X-Arcora-Timestamp";       // unix seconds, ASCII

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

/** Audit 2026-05-24 Ops-M2: V2 signature binds timestamp + body so a
 *  captured webhook can't be replayed beyond the receiver's timestamp
 *  tolerance window. Dot separator matches Stripe/GitHub convention. */
function signV2(timestamp: string, body: string, secret: string): string {
  return `sha256=${createHmac("sha256", secret).update(`${timestamp}.${body}`).digest("hex")}`;
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
    // Audit #19: align with relayer's 2^attempts*30 schedule. The previous
    // `2 ** attempts` started at 2s and ramped slowly; during a multi-hour
    // outage that means fetchDue (10s tick × 50 rows) churns the table at
    // tens of writes per second. The relayer formula starts at 60s, doubles
    // to 30-min cap, capped harder by MAX_BACKOFF_HOURS.
    const backoffSec = Math.min(2 ** attempts * 30, MAX_BACKOFF_HOURS * 3600);
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

// Audit M7 (2026-05-06): dns.lookup has no native timeout. Wrap in a 3-second
// race so a stalled resolver doesn't block the daemon loop indefinitely.
async function dnsLookupWithTimeout(
  hostname: string,
  timeoutMs = 3000,
): Promise<{ address: string; family: number }[]> {
  const lookup = dns.lookup(hostname, { all: true });
  const timer = new Promise<never>((_, reject) =>
    setTimeout(() => reject(new Error("dns_timeout")), timeoutMs),
  );
  return Promise.race([lookup, timer]);
}

async function assertSafeAtDelivery(url: string): Promise<void> {
  const parsed = new URL(url);
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error("unsupported_scheme");
  }
  if (process.env.NODE_ENV === "production" && parsed.protocol !== "https:") {
    throw new Error("https_required");
  }
  const records = await dnsLookupWithTimeout(parsed.hostname).catch((e: Error) => {
    throw new Error(e.message === "dns_timeout" ? "dns_timeout" : "dns_lookup_failed");
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

  const secret      = decryptSecret(row.webhook_secret_iv, row.webhook_secret_enc);
  const body        = JSON.stringify(row.payload);
  const timestamp   = Math.floor(Date.now() / 1000).toString();
  const signature   = sign(body, secret);
  const signatureV2 = signV2(timestamp, body, secret);

  // Manual redirect — a 3xx Location pointing at an internal IP would
  // otherwise bypass the DNS guard. Treat any 3xx as a delivery failure
  // and let the merchant fix their endpoint.
  // Timeout via AbortSignal so a slow/hung peer doesn't pin a relayer
  // tick forever.
  try {
    const res = await fetch(row.url, {
      method:   "POST",
      headers:  {
        "content-type":    "application/json",
        [SIG_HEADER]:      signature,    // legacy — kept for back-compat
        [TS_HEADER]:       timestamp,    // audit Ops-M2
        [SIG_HEADER_V2]:   signatureV2,  // audit Ops-M2
      },
      body,
      redirect: "manual",
      signal:   AbortSignal.timeout(DELIVERY_TIMEOUT_MS),
    });
    // Audit 2026-05-24 Ops-M1: cap response body buffering. We only read
    // status + statusText; an unbounded body stream from a malicious or
    // misbehaving merchant endpoint would otherwise be buffered into
    // memory until DELIVERY_TIMEOUT_MS, and BATCH=50 concurrent deliveries
    // can compound that into a VPS-wide memory spike. Cancel the body
    // stream the moment we no longer need it.
    try {
      await res.body?.cancel();
    } catch {
      // Cancel is best-effort; some response shapes don't expose body
      // (e.g. 204). Ignore — we've already extracted what we need.
    }
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
