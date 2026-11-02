import { createRequire } from "node:module";
import type { SqlDriver } from "../sql/engine";
import type { SqlParam } from "../sql/translate";

/** In-memory SQLite through Node's built in module, for tests of the offline demo backend. */
export function createNodeDriver(): SqlDriver {
  // Loaded at run time: Vite does not know the newer node:sqlite built in.
  const { DatabaseSync } = createRequire(import.meta.url)(
    "node:sqlite",
  ) as typeof import("node:sqlite");
  const db = new DatabaseSync(":memory:");
  const bind = (params: SqlParam[]) => params as (string | number | null | Uint8Array)[];
  return {
    async all(sql, params) {
      const statement = db.prepare(sql);
      statement.setReturnArrays(true);
      return statement.all(...bind(params)) as unknown as unknown[][];
    },
    async run(sql, params) {
      const result = db.prepare(sql).run(...bind(params));
      return { changes: Number(result.changes), lastInsertRowId: Number(result.lastInsertRowid) };
    },
    async exec(sql) {
      db.exec(sql);
    },
  };
}
