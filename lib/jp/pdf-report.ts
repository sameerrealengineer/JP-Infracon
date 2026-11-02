/** Printable HTML (for PDF) of an export table, in the JP Infracon house style. Text is escaped. */

export function escapeHtml(value: unknown): string {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

export function buildReportHtml(input: {
  title: string;
  meta: Record<string, string>;
  header: readonly string[];
  rows: readonly (readonly string[])[];
}): string {
  const metaRows = Object.entries(input.meta)
    .map(([key, value]) => `<tr><th>${escapeHtml(key)}</th><td>${escapeHtml(value)}</td></tr>`)
    .join("");
  const head = input.header.map((cell) => `<th>${escapeHtml(cell)}</th>`).join("");
  const body = input.rows
    .map((row) => `<tr>${row.map((cell) => `<td>${escapeHtml(cell)}</td>`).join("")}</tr>`)
    .join("");
  return `<!doctype html><html><head><meta charset="utf-8" />
<title>${escapeHtml(input.title)}</title>
<style>
  @page { size: A4 landscape; margin: 14mm; }
  body { font-family: "Noto Sans", "Noto Sans Devanagari", "Noto Sans Oriya", Arial, sans-serif; color: #0E1A26; font-size: 9pt; }
  header { border-bottom: 3px solid #B08A3E; padding-bottom: 8px; margin-bottom: 10px; }
  .brand { font-family: Georgia, "Times New Roman", serif; font-size: 20pt; color: #16324F; letter-spacing: 2px; }
  .title { font-size: 12pt; font-weight: 700; margin-top: 4px; }
  table { border-collapse: collapse; width: 100%; }
  .meta th { text-align: left; color: #68717D; font-weight: 600; padding: 1px 10px 1px 0; width: 120px; }
  .meta td { padding: 1px 0; }
  .data { margin-top: 12px; }
  .data th { background: #16324F; color: #fff; text-align: left; padding: 5px; font-size: 8pt; }
  .data td { border-bottom: 1px solid #E5DFD3; padding: 4px 5px; vertical-align: top; }
  .data tr:nth-child(even) td { background: #F8F5EE; }
  footer { margin-top: 12px; color: #68717D; font-size: 7.5pt; }
</style></head><body>
<header><div class="brand">JP INFRACON</div><div class="title">${escapeHtml(input.title)}</div></header>
<table class="meta">${metaRows}</table>
<table class="data"><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table>
<footer>Generated from JP Infracon records. Internal ledger entries are not bank transactions.</footer>
</body></html>`;
}
