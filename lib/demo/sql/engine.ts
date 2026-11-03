import { drizzle } from "drizzle-orm/mysql-proxy";
import { addMissingColumnStatements, createSchemaStatements, onUpdateNowColumns } from "./ddl";
import { normalizeResultValue, translateMysql, type SqlParam } from "./translate";

/** The few calls the demo needs from a SQLite connection (expo-sqlite on the phone, node:sqlite in tests). */
export type SqlDriver = {
  all(sql: string, params: SqlParam[]): Promise<unknown[][]>;
  run(sql: string, params: SqlParam[]): Promise<{ changes: number; lastInsertRowId: number }>;
  exec(sql: string): Promise<void>;
};

export type DemoDb = ReturnType<typeof drizzle>;

function duplicateError(error: unknown): unknown {
  const message = error instanceof Error ? error.message : String(error);
  if (!/UNIQUE constraint failed/i.test(message)) return error;
  const wrapped = new Error(`Duplicate entry (${message})`) as Error & { code: string };
  wrapped.code = "ER_DUP_ENTRY";
  return wrapped;
}

/**
 * A Drizzle MySQL database whose queries run on SQLite. The real `server/` modules use it
 * unchanged: MySQL text is translated per query, and transactions use BEGIN/COMMIT (the proxy
 * driver has no transactions of its own).
 *
 * There is one connection. Server code sometimes queries through the shared `db`, or opens
 * another transaction, while a transaction is open (on MySQL that is a second connection). A
 * lock would freeze, so that work joins the open transaction. One person uses the phone at a
 * time, so this is safe for the demo.
 */
export function createDemoDb(driver: SqlDriver): DemoDb {
  const stamps = onUpdateNowColumns();
  let open: Promise<unknown> | null = null;

  const callback = async (sql: string, params: unknown[], method: "all" | "execute") => {
    const statements = translateMysql(sql, params, stamps);
    try {
      if (method === "all") {
        const last = statements[statements.length - 1];
        const rows = await driver.all(last.sql, last.params);
        return { rows: rows.map((row) => row.map(normalizeResultValue)) };
      }
      let affectedRows = 0;
      let insertId = 0;
      for (const [index, statement] of statements.entries()) {
        const result = await driver.run(statement.sql, statement.params);
        affectedRows += result.changes;
        if (index === 0) insertId = result.lastInsertRowId;
      }
      return { rows: [{ insertId, affectedRows }] };
    } catch (error) {
      throw duplicateError(error);
    }
  };

  const db = drizzle(callback as never);

  const transaction = async <T>(run: (tx: DemoDb) => Promise<T>): Promise<T> => {
    if (open) return run(db);
    const work = (async () => {
      await driver.exec("BEGIN IMMEDIATE");
      try {
        const result = await run(db);
        await driver.exec("COMMIT");
        return result;
      } catch (error) {
        await driver.exec("ROLLBACK").catch(() => undefined);
        throw error;
      }
    })();
    open = work;
    try {
      return await work;
    } finally {
      open = null;
    }
  };

  Object.assign(db, {
    transaction,
    rollback: () => {
      throw new Error("Rollback");
    },
  });
  return db;
}

/** Creates every table and index the schema declares (safe to run on each start). */
export async function ensureSchema(driver: SqlDriver): Promise<void> {
  const statements = createSchemaStatements();
  const tables = statements.filter((statement) => statement.startsWith("CREATE TABLE"));
  for (const statement of tables) await driver.exec(statement);
  // Tables created by an older app version may lack newer columns; add them before indexes.
  const existing: Record<string, Set<string>> = {};
  for (const [name] of (await driver.all(
    "SELECT name FROM sqlite_master WHERE type = 'table'",
    [],
  )) as [string][]) {
    const columns = (await driver.all(`PRAGMA table_info(\`${name}\`)`, [])) as unknown[][];
    existing[name] = new Set(columns.map((row) => String(row[1])));
  }
  for (const statement of addMissingColumnStatements(existing)) await driver.exec(statement);
  for (const statement of statements)
    if (!statement.startsWith("CREATE TABLE")) await driver.exec(statement);
}
