import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import * as schema from "./schema";

let _pool: Pool | undefined;
export function getPool(): Pool {
  if (!_pool) {
    _pool = new Pool({
      connectionString: process.env.POSTGRES_URL,
      // Supabase pooler endpoint (and AWS RDS in general) presents a chain
      // rooted in a private CA that node's default trust store rejects with
      // SELF_SIGNED_CERT_IN_CHAIN. Encryption is still required (the
      // connection string carries `sslmode=require`); only chain verification
      // is relaxed. Matches Supabase's documented Node.js / pg setup.
      ssl: { rejectUnauthorized: false },
    });
  }
  return _pool;
}

export const db = drizzle(getPool(), { schema });
export { schema };
