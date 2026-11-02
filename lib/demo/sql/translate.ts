/**
 * Turns the MySQL that Drizzle writes into SQLite, so the real server modules can run on the
 * phone in the offline demo build. Only the shapes Drizzle (and the few raw `sql` fragments in
 * `server/`) produce are handled; anything else passes through unchanged.
 */

export type SqlParam = string | number | null | Uint8Array;
export type Statement = { sql: string; params: SqlParam[] };

/** MySQL `timestamp` text, as Drizzle writes it: `2026-11-02 08:57:01.123`. */
export function toMysqlTimestamp(date: Date): string {
  return date.toISOString().slice(0, -1).replace("T", " ");
}

export function normalizeParam(value: unknown): SqlParam {
  if (value === undefined || value === null) return null;
  if (value instanceof Date) return toMysqlTimestamp(value);
  if (typeof value === "boolean") return value ? 1 : 0;
  if (typeof value === "bigint") return value.toString();
  if (typeof value === "number" || typeof value === "string") return value;
  if (value instanceof Uint8Array) return value;
  return JSON.stringify(value);
}

/**
 * MySQL returns DECIMAL and SUM results as text and Drizzle's column decoders accept text, so
 * every number goes back as text. Float noise from SQLite sums (0.30000000000000004) is trimmed.
 */
export function normalizeResultValue(value: unknown): unknown {
  if (typeof value === "number") {
    if (Number.isInteger(value)) return String(value);
    return String(Number(value.toFixed(6)));
  }
  if (typeof value === "bigint") return value.toString();
  return value;
}

/** Splits `a, (b, c), 'd,e'` on top level commas. */
function splitTopLevel(text: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let quote: string | null = null;
  let start = 0;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quote) {
      if (ch === quote) quote = null;
      continue;
    }
    if (ch === "'" || ch === '"' || ch === "`") quote = ch;
    else if (ch === "(") depth++;
    else if (ch === ")") depth--;
    else if (ch === "," && depth === 0) {
      parts.push(text.slice(start, i).trim());
      start = i + 1;
    }
  }
  parts.push(text.slice(start).trim());
  return parts;
}

/** Index of the `)` that closes the `(` at `open`. */
function closingParen(text: string, open: number): number {
  let depth = 0;
  let quote: string | null = null;
  for (let i = open; i < text.length; i++) {
    const ch = text[i];
    if (quote) {
      if (ch === quote) quote = null;
      continue;
    }
    if (ch === "'" || ch === '"' || ch === "`") quote = ch;
    else if (ch === "(") depth++;
    else if (ch === ")") {
      depth--;
      if (depth === 0) return i;
    }
  }
  return -1;
}

function countPlaceholders(text: string): number {
  let count = 0;
  let quote: string | null = null;
  for (const ch of text) {
    if (quote) {
      if (ch === quote) quote = null;
      continue;
    }
    if (ch === "'" || ch === '"' || ch === "`") quote = ch;
    else if (ch === "?") count++;
  }
  return count;
}

/** `FIELD(x, 'a', 'b')` → a CASE that gives the same 1 based position. */
function rewriteField(sql: string): string {
  let out = sql;
  let index = out.search(/\bFIELD\(/i);
  while (index !== -1) {
    const open = index + "FIELD".length;
    const close = closingParen(out, open);
    if (close === -1) break;
    const [subject, ...options] = splitTopLevel(out.slice(open + 1, close));
    const cases = options.map((option, i) => `WHEN ${option} THEN ${i + 1}`).join(" ");
    const replacement = `(CASE ${subject} ${cases} ELSE 0 END)`;
    out = out.slice(0, index) + replacement + out.slice(close + 1);
    const next = out.slice(index + replacement.length).search(/\bFIELD\(/i);
    index = next === -1 ? -1 : index + replacement.length + next;
  }
  return out;
}

/**
 * Drizzle's MySQL insert lists every column and writes `default` where no value was given.
 * SQLite has no `default` keyword in VALUES, so those columns are dropped (one statement per
 * row when rows differ) and SQLite's own column defaults apply.
 */
function rewriteInsert(
  sql: string,
  params: SqlParam[],
  updatedAtColumns: TableColumns,
): Statement[] {
  const head = /^insert\s+(?:ignore\s+)?into\s+(`[^`]+`)\s*\(/i.exec(sql);
  if (!head) return [{ sql, params }];
  const ignore = /^insert\s+ignore/i.test(sql);
  const table = head[1];
  const colsOpen = head[0].length - 1;
  const colsClose = closingParen(sql, colsOpen);
  const columns = splitTopLevel(sql.slice(colsOpen + 1, colsClose));
  const valuesMatch = /^\s*values\s*/i.exec(sql.slice(colsClose + 1));
  if (!valuesMatch) return [{ sql, params }];

  let cursor = colsClose + 1 + valuesMatch[0].length;
  const rows: string[][] = [];
  while (sql[cursor] === "(") {
    const end = closingParen(sql, cursor);
    rows.push(splitTopLevel(sql.slice(cursor + 1, end)));
    cursor = end + 1;
    const comma = /^\s*,\s*/.exec(sql.slice(cursor));
    if (!comma) break;
    cursor += comma[0].length;
  }
  let tail = sql.slice(cursor).trim();
  let tailParams: SqlParam[] = [];
  const rowParamCount = rows.reduce(
    (sum, row) => sum + row.reduce((n, value) => n + countPlaceholders(value), 0),
    0,
  );
  tailParams = params.slice(rowParamCount);

  if (/^on duplicate key update\s+/i.test(tail)) {
    let assignments = tail.replace(/^on duplicate key update\s+/i, "");
    // `values(\`col\`)` in MySQL means the incoming value; SQLite calls that `excluded`.
    assignments = assignments.replace(/\bvalues\((`[^`]+`)\)/gi, "excluded.$1");
    const tableName = table.slice(1, -1);
    const stamp = updatedAtColumns[tableName] ?? [];
    for (const column of stamp)
      if (!assignments.includes(`\`${column}\``)) assignments += `, \`${column}\` = ${SQLITE_NOW}`;
    tail = `on conflict do update set ${assignments}`;
  }

  const statements: Statement[] = [];
  let paramCursor = 0;
  for (const row of rows) {
    const keptColumns: string[] = [];
    const keptValues: string[] = [];
    const rowParams: SqlParam[] = [];
    row.forEach((value, i) => {
      const count = countPlaceholders(value);
      const slice = params.slice(paramCursor, paramCursor + count);
      paramCursor += count;
      if (/^default$/i.test(value)) return;
      keptColumns.push(columns[i]);
      keptValues.push(value);
      rowParams.push(...slice);
    });
    const verb = ignore ? "insert or ignore into" : "insert into";
    const body =
      keptColumns.length === 0
        ? `${verb} ${table} default values`
        : `${verb} ${table} (${keptColumns.join(", ")}) values (${keptValues.join(", ")})`;
    statements.push({
      sql: tail ? `${body} ${tail}` : body,
      params: tail ? [...rowParams, ...tailParams] : rowParams,
    });
  }
  return statements;
}

/** Columns MySQL refreshes on every update (`ON UPDATE CURRENT_TIMESTAMP`), by table. */
export type TableColumns = Record<string, string[]>;

/** Same text shape as Drizzle's timestamps, so string comparisons keep working. */
export const SQLITE_NOW = "strftime('%Y-%m-%d %H:%M:%f', 'now')";

function addUpdateStamps(sql: string, updatedAtColumns: TableColumns): string {
  const match = /^update\s+`([^`]+)`\s+set\s+/i.exec(sql);
  if (!match) return sql;
  const stamp = updatedAtColumns[match[1]] ?? [];
  const missing = stamp.filter((column) => !new RegExp(`\`${column}\`\\s*=`).test(sql));
  if (missing.length === 0) return sql;
  const extra = missing.map((column) => `\`${column}\` = ${SQLITE_NOW}`).join(", ");
  const where = sql.search(/\swhere\s/i);
  return where === -1 ? `${sql}, ${extra}` : `${sql.slice(0, where)}, ${extra}${sql.slice(where)}`;
}

export function translateMysql(
  rawSql: string,
  rawParams: readonly unknown[],
  updatedAtColumns: TableColumns = {},
): Statement[] {
  let sql = rawSql.trim();
  const params = rawParams.map(normalizeParam);
  // Row locks: SQLite locks the whole database inside a transaction, so these can go.
  sql = sql.replace(/\s+for\s+update(\s+(nowait|skip\s+locked))?\s*$/i, "");
  sql = sql.replace(/\s+lock\s+in\s+share\s+mode\s*$/i, "");
  sql = rewriteField(sql);
  // MySQL IF(a, b, c) is SQLite iif(a, b, c).
  sql = sql.replace(/\bIF\(/g, "iif(");
  sql = sql.replace(/\bnow\(\)/gi, SQLITE_NOW);
  if (/^insert\s/i.test(sql)) return rewriteInsert(sql, params, updatedAtColumns);
  if (/^update\s/i.test(sql)) sql = addUpdateStamps(sql, updatedAtColumns);
  return [{ sql, params }];
}
