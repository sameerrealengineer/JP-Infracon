/**
 * Keeps a list of example (SAMPLE) rows and removes them all in one step.
 *
 * The seed takes a snapshot of every business table before and after it adds example data and
 * stores the new rows in `sample_records`. Removal deletes those rows children-first (using the
 * foreign keys in the schema), with the system rows that hang off them (document passages,
 * alert deliveries, sessions of example logins). A sample row that real work now depends on
 * (for example a real payment against a sample bill) is kept and reported, never forced out.
 */
import { randomUUID } from "node:crypto";
import { gte, inArray, is } from "drizzle-orm";
import { MySqlTable, getTableConfig, type MySqlColumn } from "drizzle-orm/mysql-core";
import * as schema from "../../drizzle/schema";

/** Identity and system tables that never hold example rows. */
const SYSTEM_TABLES = new Set([
  "sample_records",
  "system_bootstrap",
  "auth_sessions",
  "login_attempts",
  "app_reports",
  "push_devices",
  "web_push_subscriptions",
  "whatsapp_bot_messages",
]);

/** System rows made automatically from a sample row; removed with it. */
const FOLLOWERS = new Set([
  "document_chunks",
  "notification_deliveries",
  "attachment_locations",
  "auth_sessions",
  "login_attempts",
  "push_devices",
  "web_push_subscriptions",
  "user_contact_preferences",
  "user_profiles",
  "presence_tracking_status",
]);

type TableInfo = {
  name: string;
  table: MySqlTable;
  pk: MySqlColumn;
  /** Foreign keys: this table's column → parent table. */
  parents: { column: MySqlColumn; parent: string }[];
};

let cached: TableInfo[] | null = null;

/** Every table in the schema with a single-column primary key, parents listed. */
export function schemaTables(): TableInfo[] {
  if (cached) return cached;
  const list: TableInfo[] = [];
  for (const value of Object.values(schema)) {
    if (!is(value, MySqlTable)) continue;
    const config = getTableConfig(value);
    const pk =
      config.columns.find((column) => column.primary) ??
      (config.primaryKeys[0]?.columns.length === 1 ? config.primaryKeys[0].columns[0] : undefined);
    if (!pk) continue;
    const parents = config.foreignKeys.flatMap((fk) => {
      const ref = fk.reference();
      if (ref.columns.length !== 1) return [];
      return [{ column: ref.columns[0]!, parent: getTableConfig(ref.foreignTable).name }];
    });
    list.push({ name: config.name, table: value, pk, parents });
  }
  cached = list;
  return list;
}

function businessTables() {
  return schemaTables().filter((info) => !SYSTEM_TABLES.has(info.name));
}

// The database handle differs between MySQL and the demo's SQLite proxy; both speak Drizzle.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Db = any;

export type Snapshot = Map<string, Set<string>>;

/** Primary keys of every business table now. */
export async function snapshot(db: Db): Promise<Snapshot> {
  const result: Snapshot = new Map();
  for (const info of businessTables()) {
    const rows: { id: unknown }[] = await db.select({ id: info.pk }).from(info.table);
    result.set(info.name, new Set(rows.map((row) => String(row.id))));
  }
  return result;
}

/** Rows present in `after` and not in `before`. */
export function newRows(before: Snapshot, after: Snapshot) {
  const rows: { tableName: string; rowId: string }[] = [];
  for (const [tableName, ids] of after) {
    const old = before.get(tableName) ?? new Set<string>();
    for (const rowId of ids) if (!old.has(rowId)) rows.push({ tableName, rowId });
  }
  return rows;
}

/** Stores rows as example data. */
export async function registerSample(db: Db, rows: { tableName: string; rowId: string }[]) {
  const known = new Set(
    (await db.select().from(schema.sampleRecords)).map(
      (row: { tableName: string; rowId: string }) => `${row.tableName}:${row.rowId}`,
    ),
  );
  const fresh: { tableName: string; rowId: string }[] = [];
  for (const row of rows) {
    const key = `${row.tableName}:${row.rowId}`;
    if (known.has(key)) continue;
    known.add(key);
    fresh.push(row);
  }
  for (let index = 0; index < fresh.length; index += 200)
    await db
      .insert(schema.sampleRecords)
      .values(fresh.slice(index, index + 200).map((row) => ({ id: randomUUID(), ...row })));
  return fresh.length;
}

/** Example rows by table, for the screen. */
export async function sampleSummary(db: Db) {
  const rows: { tableName: string }[] = await db
    .select({ tableName: schema.sampleRecords.tableName })
    .from(schema.sampleRecords);
  const byTable = new Map<string, number>();
  for (const row of rows) byTable.set(row.tableName, (byTable.get(row.tableName) ?? 0) + 1);
  return { total: rows.length, byTable: Object.fromEntries(byTable) };
}

/** Tables ordered so that children come before their parents. */
function childFirstOrder(tables: TableInfo[]) {
  const byName = new Map(tables.map((info) => [info.name, info]));
  const order: string[] = [];
  const state = new Map<string, "visiting" | "done">();
  // A parent is placed after all tables that point at it (reverse topological order).
  const childrenOf = new Map<string, string[]>();
  for (const info of tables)
    for (const { parent } of info.parents)
      if (parent !== info.name)
        childrenOf.set(parent, [...(childrenOf.get(parent) ?? []), info.name]);
  const visit = (name: string) => {
    if (state.get(name)) return;
    state.set(name, "visiting");
    for (const child of childrenOf.get(name) ?? []) if (byName.has(child)) visit(child);
    state.set(name, "done");
    order.push(name);
  };
  for (const info of tables) visit(info.name);
  return order;
}

/**
 * Deletes every example row it can. Returns how many went and how many stayed because real
 * records depend on them.
 */
export async function removeSample(db: Db) {
  const registry: { id: string; tableName: string; rowId: string }[] = await db
    .select()
    .from(schema.sampleRecords);
  const tables = schemaTables();
  const byName = new Map(tables.map((info) => [info.name, info]));
  const pending = new Map<string, Set<string>>();
  for (const row of registry) {
    if (!byName.has(row.tableName)) continue;
    const set = pending.get(row.tableName) ?? new Set<string>();
    set.add(row.rowId);
    pending.set(row.tableName, set);
  }
  const order = childFirstOrder(tables);
  const removed = new Map<string, Set<string>>();

  const deleteIds = async (info: TableInfo, ids: string[]) => {
    if (!ids.length) return [] as string[];
    const typed = ids.map((rowId) => (info.pk.dataType === "number" ? Number(rowId) : rowId));
    try {
      await db.delete(info.table).where(inArray(info.pk, typed));
      return ids;
    } catch {
      const done: string[] = [];
      for (const [index, rowId] of ids.entries())
        try {
          await db.delete(info.table).where(inArray(info.pk, [typed[index]]));
          done.push(rowId);
        } catch {
          /* still referenced; try again on the next pass */
        }
      return done;
    }
  };

  // System rows that follow a sample parent (passages of a sample document, sessions of an
  // example login) go first.
  for (const info of tables) {
    if (!FOLLOWERS.has(info.name)) continue;
    for (const { column, parent } of info.parents) {
      const parentIds = [...(pending.get(parent) ?? [])];
      if (!parentIds.length) continue;
      const parentPk = byName.get(parent)?.pk;
      const typed = parentIds.map((rowId) =>
        parentPk?.dataType === "number" ? Number(rowId) : rowId,
      );
      for (let index = 0; index < typed.length; index += 200)
        try {
          await db.delete(info.table).where(inArray(column, typed.slice(index, index + 200)));
        } catch {
          /* nothing to remove, or still referenced */
        }
    }
  }

  for (let pass = 0; pass < 8; pass += 1) {
    let progress = 0;
    for (const name of order) {
      const ids = pending.get(name);
      const info = byName.get(name);
      if (!ids?.size || !info) continue;
      const list = [...ids];
      for (let index = 0; index < list.length; index += 200) {
        const done = await deleteIds(info, list.slice(index, index + 200));
        for (const rowId of done) {
          ids.delete(rowId);
          const set = removed.get(name) ?? new Set<string>();
          set.add(rowId);
          removed.set(name, set);
        }
        progress += done.length;
      }
    }
    if (!progress || [...pending.values()].every((set) => set.size === 0)) break;
  }

  // Forget what is gone; what stays remains listed.
  const goneKeys = new Set<string>();
  for (const [name, ids] of removed) for (const rowId of ids) goneKeys.add(`${name}:${rowId}`);
  const goneRegistry = registry
    .filter((row) => goneKeys.has(`${row.tableName}:${row.rowId}`) || !byName.has(row.tableName))
    .map((row) => row.id);
  for (let index = 0; index < goneRegistry.length; index += 200)
    await db
      .delete(schema.sampleRecords)
      .where(inArray(schema.sampleRecords.id, goneRegistry.slice(index, index + 200)));

  const kept: Record<string, number> = {};
  for (const [name, ids] of pending) if (ids.size) kept[name] = ids.size;
  return {
    removed: [...removed.values()].reduce((sum, set) => sum + set.size, 0),
    kept: Object.values(kept).reduce((sum, count) => sum + count, 0),
    keptByTable: kept,
  };
}

/**
 * Business rows made at or after `since` (tables with a createdAt column). Used to list the
 * rows of an earlier seed run that stopped before it could list them.
 */
export async function rowsCreatedSince(db: Db, since: Date) {
  const rows: { tableName: string; rowId: string }[] = [];
  for (const info of businessTables()) {
    const config = getTableConfig(info.table);
    const created = config.columns.find(
      (column) => column.name === "createdAt" || column.name === "occurredAt",
    );
    if (!created) continue;
    const found: { id: unknown }[] = await db
      .select({ id: info.pk })
      .from(info.table)
      .where(gte(created, since));
    for (const row of found) rows.push({ tableName: info.name, rowId: String(row.id) });
  }
  return rows;
}
