import { readFileSync } from "node:fs";
import path from "node:path";
import { drizzle } from "drizzle-orm/mysql2";
import { migrate } from "drizzle-orm/mysql2/migrator";
import mysql from "mysql2/promise";

/**
 * Applies the SQL migrations in /drizzle that this database has not seen yet (self-hosted
 * deployments). Never enable RUN_MIGRATIONS against a database you have not backed up.
 */
export async function runMigrations() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set");
  const folder = process.env.MIGRATIONS_DIR || path.resolve(process.cwd(), "drizzle");
  await repairPartialMigration(url, folder);
  const db = drizzle(url);
  console.log("[api] applying database migrations");
  await migrate(db, { migrationsFolder: folder });
  console.log("[api] migrations up to date");
  await db.$client.end?.();
}

type JournalEntry = { idx: number; when: number; tag: string };

/** Table names a migration creates, and tables it changes without creating them. */
export function migrationTables(sql: string) {
  const created = [...sql.matchAll(/CREATE TABLE\s+`([^`]+)`/gi)].map((match) => match[1]);
  const touched = [...sql.matchAll(/ALTER TABLE\s+`([^`]+)`/gi)].map((match) => match[1]);
  const otherDdl = /\bDROP\s+(TABLE|INDEX|COLUMN)\b|\bRENAME\b/i.test(sql);
  return {
    created,
    changesExisting: otherDdl || touched.some((name) => !created.includes(name)),
  };
}

/**
 * MySQL cannot roll back table changes, so a migration that failed halfway leaves some of its new
 * tables behind and the next start fails on "table already exists". When the next pending
 * migration only creates new tables, some of them already exist, and every one of those is
 * empty, they are dropped so the migration can run again from the start. Anything else (data in
 * a table, or a migration that changes existing tables) stops with a clear message instead.
 */
async function repairPartialMigration(url: string, folder: string) {
  const journal = JSON.parse(readFileSync(path.join(folder, "meta", "_journal.json"), "utf8")) as {
    entries: JournalEntry[];
  };
  const connection = await mysql.createConnection(url);
  try {
    const [tables] = (await connection.query(
      "SELECT table_name AS name FROM information_schema.tables WHERE table_schema = DATABASE()",
    )) as unknown as [{ name: string }[]];
    const existing = new Set(tables.map((row) => row.name));
    if (!existing.has("__drizzle_migrations")) return;
    const [rows] = (await connection.query(
      "SELECT MAX(created_at) AS last FROM `__drizzle_migrations`",
    )) as unknown as [{ last: number | string | null }[]];
    const last = Number(rows[0]?.last ?? 0);
    const next = journal.entries
      .filter((entry) => entry.when > last)
      .sort((a, b) => a.when - b.when)[0];
    if (!next) return;
    const sql = readFileSync(path.join(folder, `${next.tag}.sql`), "utf8");
    const { created, changesExisting } = migrationTables(sql);
    const leftOver = created.filter((name) => existing.has(name));
    if (!leftOver.length) return;
    if (changesExisting)
      throw new Error(
        `Migration ${next.tag} was partly applied and also changes existing tables; fix it by hand from a backup.`,
      );
    for (const name of leftOver) {
      const [count] = (await connection.query(
        `SELECT COUNT(*) AS n FROM \`${name}\``,
      )) as unknown as [{ n: number }[]];
      if (Number(count[0]?.n ?? 0) > 0)
        throw new Error(
          `Migration ${next.tag} was partly applied and table ${name} already has data; nothing was removed. Fix it by hand from a backup.`,
        );
    }
    console.log(
      `[api] migration ${next.tag} was partly applied earlier; removing its empty tables (${leftOver.join(", ")}) and running it again`,
    );
    await connection.query("SET FOREIGN_KEY_CHECKS = 0");
    try {
      for (const name of leftOver) await connection.query(`DROP TABLE \`${name}\``);
    } finally {
      await connection.query("SET FOREIGN_KEY_CHECKS = 1");
    }
  } finally {
    await connection.end();
  }
}
