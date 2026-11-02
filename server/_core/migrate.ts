import path from "node:path";
import { drizzle } from "drizzle-orm/mysql2";
import { migrate } from "drizzle-orm/mysql2/migrator";

/**
 * Applies the SQL migrations in /drizzle that this database has not seen yet (self-hosted
 * deployments). Never enable RUN_MIGRATIONS against a database you have not backed up.
 */
export async function runMigrations() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set");
  const db = drizzle(url);
  const folder = process.env.MIGRATIONS_DIR || path.resolve(process.cwd(), "drizzle");
  console.log("[api] applying database migrations");
  await migrate(db, { migrationsFolder: folder });
  console.log("[api] migrations up to date");
  await db.$client.end?.();
}
