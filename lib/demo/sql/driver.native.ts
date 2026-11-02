import * as SQLite from "expo-sqlite";
import type { SqlDriver } from "./engine";
import type { SqlParam } from "./translate";

/** The demo database file on the phone. Deleting the app's data starts the demo afresh. */
export async function openDemoDriver(): Promise<SqlDriver> {
  const db = await SQLite.openDatabaseAsync("jp-infracon-demo.db");
  await db.execAsync("PRAGMA journal_mode = WAL");
  const bind = (params: SqlParam[]) => params as SQLite.SQLiteBindValue[];
  return {
    async all(sql, params) {
      const statement = await db.prepareAsync(sql);
      try {
        const result = await statement.executeForRawResultAsync(bind(params));
        return (await result.getAllAsync()) as unknown[][];
      } finally {
        await statement.finalizeAsync();
      }
    },
    async run(sql, params) {
      const result = await db.runAsync(sql, bind(params));
      return { changes: result.changes, lastInsertRowId: result.lastInsertRowId };
    },
    async exec(sql) {
      await db.execAsync(sql);
    },
  };
}
