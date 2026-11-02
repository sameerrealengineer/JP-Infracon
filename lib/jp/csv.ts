/** CSV building for exports. Untrusted text is quoted and cannot run as a spreadsheet formula. */

export type CsvValue = string | number | bigint | boolean | Date | null | undefined;

export function csvCell(value: CsvValue): string {
  if (value === null || value === undefined) return "";
  let text =
    value instanceof Date
      ? Number.isNaN(value.getTime())
        ? ""
        : value.toISOString()
      : String(value);
  // Spreadsheet apps execute cells starting with these characters; prefix them so they stay text.
  if (/^[=+\-@\t\r]/.test(text) && !/^-?\d+(\.\d+)?$/.test(text)) text = `'${text}`;
  return /[",\r\n]/.test(text) || text !== text.trim() ? `"${text.replaceAll('"', '""')}"` : text;
}

export function buildCsv(
  meta: Record<string, string>,
  header: readonly string[],
  rows: readonly CsvValue[][],
): string {
  const lines = [
    ...Object.entries(meta).map(([key, value]) => `${csvCell(`# ${key}`)},${csvCell(value)}`),
    "",
    header.map(csvCell).join(","),
    ...rows.map((row) => row.map(csvCell).join(",")),
  ];
  // BOM so Excel opens UTF-8 (Hindi/Odia names, ₹) correctly.
  return `﻿${lines.join("\r\n")}\r\n`;
}

/** Paise string → "1234.50" (exact, no floating point). */
export function paiseToDecimal(value: string | bigint | null | undefined): string {
  if (value === null || value === undefined || value === "") return "";
  const minor = BigInt(value);
  const negative = minor < 0n;
  const abs = negative ? -minor : minor;
  return `${negative ? "-" : ""}${abs / 100n}.${String(abs % 100n).padStart(2, "0")}`;
}

export function exportFileName(kind: string, generatedAt: Date): string {
  const stamp = generatedAt.toISOString().slice(0, 16).replace(/[:T]/g, "-");
  return `jp-infracon-${kind}-${stamp}.csv`;
}
