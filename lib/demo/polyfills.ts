/**
 * What the server modules expect from Node, for the offline demo on the phone. Imported first by
 * `lib/demo/backend.ts`, before any server module loads (credential-auth uses Buffer at load).
 */
import { Buffer } from "buffer";
import { MySqlDateTime, MySqlTimestamp } from "drizzle-orm/mysql-core";

const globals = globalThis as { Buffer?: typeof Buffer };
if (!globals.Buffer) globals.Buffer = Buffer;

/** `2026-11-02 08:57:01.123` (MySQL text, UTC) to a Date, without relying on Date parsing. */
export function parseMysqlTimestamp(value: string | Date): Date {
  if (value instanceof Date) return value;
  const match = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,6}))?/.exec(value);
  if (!match) return new Date(value);
  const [, y, mo, d, h, mi, s, frac = "0"] = match;
  const ms = Number(frac.padEnd(3, "0").slice(0, 3));
  return new Date(
    Date.UTC(Number(y), Number(mo) - 1, Number(d), Number(h), Number(mi), Number(s), ms),
  );
}

// Drizzle reads timestamps with `new Date("2026-11-02 08:57:01.123+0000")`, a format Hermes
// may not parse. Read them explicitly instead.
for (const column of [MySqlTimestamp, MySqlDateTime]) {
  (
    column.prototype as unknown as { mapFromDriverValue: (value: string) => Date }
  ).mapFromDriverValue = parseMysqlTimestamp;
}
