import { strFromU8, unzipSync } from "fflate";

import type { DocumentContentType } from "./document-policy";

/**
 * Plain text from Word, Excel and CSV files, without any AI service, so these documents are
 * searchable by keyword even when no AI key is set. PDFs and photos need the AI reader.
 */

const MAX_TEXT = 400_000;

function decodeXml(text: string): string {
  return text
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, code: string) => String.fromCharCode(Number(code)))
    .replace(/&amp;/g, "&");
}

function readZip(bytes: Uint8Array, wanted: (name: string) => boolean): Record<string, string> {
  const files = unzipSync(bytes, {
    filter: (file) => wanted(file.name) && file.originalSize < 20e6,
  });
  return Object.fromEntries(Object.entries(files).map(([name, data]) => [name, strFromU8(data)]));
}

function wordText(bytes: Uint8Array): string {
  const xml = readZip(bytes, (name) => name === "word/document.xml")["word/document.xml"] ?? "";
  return decodeXml(
    xml
      .replace(/<w:tab\/>/g, "\t")
      .replace(/<\/w:p>/g, "\n")
      .replace(/<w:br[^>]*\/>/g, "\n")
      .replace(/<[^>]+>/g, ""),
  );
}

function sheetText(bytes: Uint8Array): string {
  const parts = readZip(
    bytes,
    (name) => name === "xl/sharedStrings.xml" || /^xl\/worksheets\/sheet\d+\.xml$/.test(name),
  );
  const shared = [...(parts["xl/sharedStrings.xml"] ?? "").matchAll(/<si>([\s\S]*?)<\/si>/g)].map(
    (match) => decodeXml(match[1].replace(/<[^>]+>/g, "")),
  );
  const sheets = Object.keys(parts)
    .filter((name) => name.startsWith("xl/worksheets/"))
    .sort((a, b) => Number(a.match(/\d+/)?.[0]) - Number(b.match(/\d+/)?.[0]));
  const lines: string[] = [];
  for (const name of sheets) {
    for (const row of parts[name].matchAll(/<row[^>]*>([\s\S]*?)<\/row>/g)) {
      const cells = [...row[1].matchAll(/<c([^>]*)>([\s\S]*?)<\/c>/g)].map((cell) => {
        const value = cell[2].match(/<v>([\s\S]*?)<\/v>/)?.[1] ?? "";
        const inline = cell[2].match(/<t[^>]*>([\s\S]*?)<\/t>/)?.[1];
        if (/t="s"/.test(cell[1])) return shared[Number(value)] ?? "";
        return decodeXml(inline ?? value);
      });
      const line = cells.filter(Boolean).join(" | ");
      if (line) lines.push(line);
    }
  }
  return lines.join("\n");
}

/** Text for keyword search and AI reading; empty for types that need the AI reader. */
export function extractDocumentText(bytes: Uint8Array, contentType: DocumentContentType): string {
  try {
    let text = "";
    if (
      contentType === "text/csv" ||
      contentType === "text/plain" ||
      contentType === "image/vnd.dxf"
    )
      text = strFromU8(bytes);
    else if (contentType.includes("wordprocessingml")) text = wordText(bytes);
    else if (contentType.includes("spreadsheetml")) text = sheetText(bytes);
    return text.replace(/\u0000/g, "").slice(0, MAX_TEXT);
  } catch {
    return "";
  }
}
