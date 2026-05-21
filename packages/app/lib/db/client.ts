import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import * as schema from "./schema";

/**
 * Build pool config from POSTGRES_URL. Behavior:
 *
 *   • If the URL declares `sslmode` (any value except `disable`), we strip
 *     the param and pass `ssl: { rejectUnauthorized: false }`. pg's default
 *     would otherwise treat `sslmode=require` as `verify-full`, which
 *     Supabase's pooler rejects with SELF_SIGNED_CERT_IN_CHAIN because the
 *     pooler uses a private CA chain. Stripping the param keeps encryption
 *     on (via the explicit `ssl`) and relaxes chain verification.
 *
 *   • If the URL omits `sslmode` (or sets it to `disable`), SSL is left
 *     off. This is the local-dev / CI path against plain Postgres, which
 *     would otherwise fail with "the server does not support SSL
 *     connections" if we forced an SSL handshake.
 */
export function buildPoolConfig(): { connectionString?: string; ssl?: { rejectUnauthorized: false } | false } {
  const raw = process.env.POSTGRES_URL;
  if (!raw) return {};
  try {
    const u = new URL(raw);
    const sslmode = u.searchParams.get("sslmode");
    u.searchParams.delete("sslmode");
    if (!sslmode || sslmode === "disable") {
      return { connectionString: u.toString(), ssl: false };
    }
    return { connectionString: u.toString(), ssl: { rejectUnauthorized: false } };
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
