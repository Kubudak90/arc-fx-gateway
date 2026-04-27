import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import * as schema from "./schema";

let _pool: Pool | undefined;
export function getPool(): Pool {
  if (!_pool) {
    _pool = new Pool({ connectionString: process.env.POSTGRES_URL });
  }
  return _pool;
}

export const db = drizzle(getPool(), { schema });
export { schema };
