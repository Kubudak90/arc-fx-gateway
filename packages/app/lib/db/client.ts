import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import * as schema from "./schema";

/**
 * Strip `sslmode` from the connection-string query so our explicit `ssl`
 * option below wins. Current pg-connection-string treats `sslmode=require`
 * as an alias of `verify-full` and overrides any explicit `ssl` option —
 * which Supabase's pooler (private CA chain) then rejects with
 * SELF_SIGNED_CERT_IN_CHAIN. Removing the URL param keeps encryption on
 * (via the explicit `ssl`) and lets us relax chain verification.
 */
function buildConnectionString(): string | undefined {
  const raw = process.env.POSTGRES_URL;
  if (!raw) return undefined;
  try {
    const u = new URL(raw);
    u.searchParams.delete("sslmode");
    return u.toString();
  } catch {
    return raw;
  }
}

let _pool: Pool | undefined;
export function getPool(): Pool {
  if (!_pool) {
    _pool = new Pool({
      connectionString: buildConnectionString(),
      ssl: { rejectUnauthorized: false },
    });
  }
  return _pool;
}

export const db = drizzle(getPool(), { schema });
export { schema };
