import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";

const databaseUrl = process.env.DATABASE_URL;

type GlobalWithPool = typeof globalThis & {
  __earthJukeboxPostgresqlPool?: Pool;
};

const globalForDb = globalThis as GlobalWithPool;

/**
 * PostgreSQL is optional for local development. When DATABASE_URL is absent,
 * the API uses the in-memory cache implemented in src/lib/server/cache.ts.
 */
export const pool: Pool | null = databaseUrl
  ? globalForDb.__earthJukeboxPostgresqlPool ?? new Pool({ connectionString: databaseUrl })
  : null;

if (pool && process.env.NODE_ENV !== "production") {
  globalForDb.__earthJukeboxPostgresqlPool = pool;
}

export const db = pool ? drizzle(pool) : null;
