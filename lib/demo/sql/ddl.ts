import { is, SQL } from "drizzle-orm";
import { getTableConfig, MySqlTable, type MySqlColumn } from "drizzle-orm/mysql-core";
import * as schema from "../../../drizzle/schema";
import { SQLITE_NOW, type TableColumns } from "./translate";

/** Every table in `drizzle/schema.ts`. */
export function schemaTables(): MySqlTable[] {
  return Object.values(schema as Record<string, unknown>).filter((value): value is MySqlTable =>
    is(value, MySqlTable),
  );
}

function quote(name: string) {
  return `\`${name.replace(/`/g, "``")}\``;
}

function sqliteType(column: MySqlColumn): string {
  const type = column.getSQLType().toLowerCase();
  if (/^(int|bigint|smallint|tinyint|mediumint|serial)/.test(type)) return "INTEGER";
  if (/^(decimal|double|float|real|numeric)/.test(type)) return "NUMERIC";
  if (/^(blob|binary|varbinary)/.test(type)) return "BLOB";
  return "TEXT";
}

function defaultClause(column: MySqlColumn): string {
  if (!column.hasDefault || column.default === undefined) return "";
  const value: unknown = column.default;
  if (is(value, SQL)) {
    // Drizzle's defaultNow() is the only SQL default in the schema.
    return ` DEFAULT (${SQLITE_NOW})`;
  }
  if (value === null) return " DEFAULT NULL";
  if (typeof value === "number") return ` DEFAULT ${value}`;
  if (typeof value === "boolean") return ` DEFAULT ${value ? 1 : 0}`;
  return ` DEFAULT '${String(value).replace(/'/g, "''")}'`;
}

/** SQLite CREATE statements matching the MySQL schema (no foreign keys or checks, like MySQL here). */
export function createSchemaStatements(): string[] {
  const statements: string[] = [];
  for (const table of schemaTables()) {
    const config = getTableConfig(table);
    const compositeKey = config.primaryKeys[0]?.columns.map((column) => column.name);
    const lines = config.columns.map((column) => {
      let line = `${quote(column.name)} ${sqliteType(column)}`;
      if (column.primary && !compositeKey) {
        line +=
          (column as unknown as { autoIncrement?: boolean }).autoIncrement &&
          sqliteType(column) === "INTEGER"
            ? " PRIMARY KEY AUTOINCREMENT"
            : " PRIMARY KEY";
      }
      if (column.notNull && !column.primary) line += " NOT NULL";
      return line + defaultClause(column);
    });
    if (compositeKey) lines.push(`PRIMARY KEY (${compositeKey.map(quote).join(", ")})`);
    statements.push(
      `CREATE TABLE IF NOT EXISTS ${quote(config.name)} (\n  ${lines.join(",\n  ")}\n)`,
    );

    const uniques: { name: string; columns: string[] }[] = [];
    for (const column of config.columns)
      if (column.isUnique)
        uniques.push({
          name: column.uniqueName ?? `${config.name}_${column.name}_unique`,
          columns: [column.name],
        });
    for (const constraint of config.uniqueConstraints)
      uniques.push({
        name: constraint.name ?? `${config.name}_unique_${uniques.length}`,
        columns: constraint.columns.map((column) => column.name),
      });
    for (const index of config.indexes) {
      const columns = index.config.columns
        .map((column) => (is(column, SQL) ? null : (column as MySqlColumn).name))
        .filter((name): name is string => Boolean(name));
      if (columns.length === 0) continue;
      const unique = index.config.unique ? "UNIQUE " : "";
      statements.push(
        `CREATE ${unique}INDEX IF NOT EXISTS ${quote(`${config.name}__${index.config.name}`)} ON ${quote(config.name)} (${columns.map(quote).join(", ")})`,
      );
    }
    for (const unique of uniques)
      statements.push(
        `CREATE UNIQUE INDEX IF NOT EXISTS ${quote(`${config.name}__${unique.name}`)} ON ${quote(config.name)} (${unique.columns.map(quote).join(", ")})`,
      );
  }
  return statements;
}

/** Columns declared with `.onUpdateNow()`, which MySQL refreshes on every update. */
export function onUpdateNowColumns(): TableColumns {
  const result: TableColumns = {};
  for (const table of schemaTables()) {
    const config = getTableConfig(table);
    const stamped = config.columns
      .filter((column) => (column as unknown as { hasOnUpdateNow?: boolean }).hasOnUpdateNow)
      .map((column) => column.name);
    if (stamped.length) result[config.name] = stamped;
  }
  return result;
}
