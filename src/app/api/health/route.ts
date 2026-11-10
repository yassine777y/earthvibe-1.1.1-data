import { db } from "@/db";
import { sql } from "drizzle-orm";

export const dynamic = "force-dynamic";

export async function GET() {
  // PostgreSQL is optional: local development can use the in-memory cache.
  if (!db) return Response.json({ ok: true, storage: "memory" });

  try {
    await db.execute(sql`select 1`);
    return Response.json({ ok: true, storage: "postgres" });
  } catch {
    // Match the cache's documented fallback behaviour when the DB is offline.
    return Response.json({ ok: true, storage: "memory", warning: "database_unavailable" });
  }
}
