import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import * as schema from "./schema";

type SslConfig = boolean | { rejectUnauthorized: boolean };

/** True for Supabase's connection-pooler hosts, whose TLS endpoint presents a
 *  private CA chain that Node's default verify-full rejects. */
function isSupabasePooler(hostname: string): boolean {
  return hostname === "pooler.supabase.com" || hostname.endsWith(".pooler.supabase.com");
}

/**
 * Build pool config from POSTGRES_URL. Behavior:
 *
 *   • No `sslmode` (or `disable`): SSL is left off. Local-dev / CI path
 *     against plain Postgres, which would otherwise fail with "the server
 *     does not support SSL connections" if we forced a handshake.
 *
 *   • Supabase pooler host (`*.pooler.supabase.com`): SSL on with relaxed
 *     chain verification (`rejectUnauthorized:false`). The pooler terminates
 *     TLS with a private CA chain that pg's default `verify-full` rejects
 *     (SELF_SIGNED_CERT_IN_CHAIN); relaxing keeps the channel encrypted while
 *     tolerating that chain.
 *
 *   • Any other host with a non-disable `sslmode`: SSL on with FULL
 *     verification (`rejectUnauthorized:true`) — hostname + CA chain are
 *     checked against the system trust store.
 *
 * Audit M-2 (2026-05-31): the relaxed path used to apply to EVERY non-disable
 * host, structurally disabling cert verification for any DB endpoint and
 * opening a self-signed-MITM path on app↔Postgres traffic (API-key hashes,
 * encrypted server-wallet PKs, webhook secrets). It is now scoped to the
 * pooler host only. Stronger still would be to bundle the pooler CA and pass
 * `ssl: { ca, rejectUnauthorized: true }`; left as a follow-up.
 */
export function buildPoolConfig(): { connectionString?: string; ssl?: SslConfig } {
  const raw = process.env.POSTGRES_URL;
  if (!raw) return {};
  try {
    const u = new URL(raw);
    const sslmode = u.searchParams.get("sslmode");
    u.searchParams.delete("sslmode");
    if (!sslmode || sslmode === "disable") {
      return { connectionString: u.toString(), ssl: false };
    }
    return {
      connectionString: u.toString(),
      ssl: { rejectUnauthorized: !isSupabasePooler(u.hostname) },
    };
  } catch {
    return { connectionString: raw };
  }
}

let _pool: Pool | undefined;
export function getPool(): Pool {
  if (!_pool) {
    _pool = new Pool(buildPoolConfig());
  }
  return _pool;
}

export const db = drizzle(getPool(), { schema });
export { schema };
