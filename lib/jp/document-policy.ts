import { sniffContentType } from "./attachment-policy";

/**
 * Project document rules: categories, accepted file types, and the pieces of search
 * (splitting text into passages, similarity and keyword scores, hybrid ranking).
 * Search follows DigUp's approach: a meaning (vector) match, with exact keyword hits boosting
 * results so invoice numbers, GSTINs and drawing numbers still rank first.
 */

export const DOCUMENT_CATEGORIES = [
  "Agreements and work orders",
  "Drawings",
  "BOQ and estimates",
  "Bills and invoices",
  "GST and tax",
  "Measurements",
  "Site photos",
  "Inspection and quality",
  "Safety",
  "Government approvals",
  "Completion certificates",
  "Other project documents",
] as const;
export type DocumentCategory = (typeof DOCUMENT_CATEGORIES)[number];

export const MAX_DOCUMENT_BYTES = 15 * 1024 * 1024;

export const documentContentTypes = {
  "application/pdf": "pdf",
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": "docx",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": "xlsx",
  "text/csv": "csv",
} as const;
export type DocumentContentType = keyof typeof documentContentTypes;

function containsAscii(bytes: Uint8Array, text: string): boolean {
  const needle = Array.from(text, (char) => char.charCodeAt(0));
  outer: for (let i = 0; i <= bytes.length - needle.length; i += 1) {
    for (let j = 0; j < needle.length; j += 1) if (bytes[i + j] !== needle[j]) continue outer;
    return true;
  }
  return false;
}

function looksLikeText(bytes: Uint8Array): boolean {
  if (bytes.length === 0) return false;
  const sample = bytes.subarray(0, Math.min(bytes.length, 4096));
  if (sample.includes(0)) return false;
  try {
    new TextDecoder("utf-8", { fatal: true }).decode(sample.subarray(0, sample.length - 4));
    return true;
  } catch {
    return false;
  }
}

/**
 * The real type of an uploaded document from its bytes (and, for CSV, its name).
 * Office files are ZIP archives told apart by the part names inside them.
 */
export function sniffDocumentType(bytes: Uint8Array, fileName: string): DocumentContentType | null {
  const known = sniffContentType(bytes);
  if (known) return known;
  const isZip = bytes.length > 4 && bytes[0] === 0x50 && bytes[1] === 0x4b && bytes[2] === 0x03;
  if (isZip) {
    if (containsAscii(bytes, "word/document.xml"))
      return "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
    if (containsAscii(bytes, "xl/workbook.xml"))
      return "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
    return null;
  }
  if (/\.csv$/i.test(fileName.trim()) && looksLikeText(bytes)) return "text/csv";
  return null;
}

export function safeDocumentName(name: string, contentType: DocumentContentType): string {
  const base = name.split(/[\\/]/).pop() ?? "document";
  const cleaned = base
    .replace(/[^\w.\- ]+/g, "_")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 120);
  const withoutExt = cleaned.replace(/\.[^.]*$/, "") || "document";
  return `${withoutExt}.${documentContentTypes[contentType]}`;
}

/** "Slab, Block-A ,  slab" → ["slab", "block-a"] (lowercase, unique, at most 10). */
export function normalizeTags(value: string | readonly string[]): string[] {
  const parts = Array.isArray(value) ? value : String(value).split(/[,;\n]/);
  const tags: string[] = [];
  for (const part of parts) {
    const tag = part.trim().toLowerCase().replace(/\s+/g, " ").slice(0, 40);
    if (tag && !tags.includes(tag)) tags.push(tag);
    if (tags.length === 10) break;
  }
  return tags;
}

/**
 * Splits text into passages of about `size` characters, breaking at paragraph or sentence ends
 * where possible, with a small overlap so a phrase cut at a boundary is still found.
 */
export function chunkText(text: string, size = 1200, overlap = 150): string[] {
  const clean = text
    .replace(/\r/g, "")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  if (!clean) return [];
  const chunks: string[] = [];
  let start = 0;
  while (start < clean.length) {
    let end = Math.min(clean.length, start + size);
    if (end < clean.length) {
      const window = clean.slice(start, end);
      const breakAt = Math.max(
        window.lastIndexOf("\n\n"),
        window.lastIndexOf(". "),
        window.lastIndexOf("\n"),
      );
      if (breakAt > size * 0.5) end = start + breakAt + 1;
    }
    const piece = clean.slice(start, end).trim();
    if (piece) chunks.push(piece);
    if (end >= clean.length) break;
    start = Math.max(end - overlap, start + 1);
  }
  return chunks;
}

export function cosineSimilarity(a: readonly number[], b: readonly number[]): number {
  if (a.length === 0 || a.length !== b.length) return 0;
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i += 1) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  return normA && normB ? dot / Math.sqrt(normA * normB) : 0;
}

function tokens(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^\p{L}\p{N}/-]+/u)
    .filter((token) => token.length >= 2);
}

/**
 * 0..1: the share of query words found in the text, plus boosts for the whole phrase and for
 * code-like words (with digits, such as an invoice number or GSTIN) found exactly.
 */
export function keywordScore(query: string, text: string): number {
  const words = [...new Set(tokens(query))];
  if (words.length === 0) return 0;
  const haystack = text.toLowerCase();
  const found = words.filter((word) => haystack.includes(word));
  let score = found.length / words.length;
  const phrase = query.trim().toLowerCase();
  if (words.length > 1 && phrase.length > 3 && haystack.includes(phrase)) score += 0.3;
  if (found.some((word) => /\d/.test(word) && word.length >= 4)) score += 0.4;
  return Math.min(score, 1.5) / 1.5;
}

/** Meaning match when available, with keyword hits boosting it; keyword only otherwise. */
export function hybridScore(vector: number | null, keyword: number): number {
  return vector === null ? keyword : 0.7 * Math.max(vector, 0) + 0.3 * keyword;
}

export type ScoredPassage = { documentId: string; content: string; score: number };

/** Best passage per document, best documents first, dropping weak matches. */
export function rankDocuments(
  passages: readonly ScoredPassage[],
  limit = 20,
  minimum = 0.2,
): ScoredPassage[] {
  const best = new Map<string, ScoredPassage>();
  for (const passage of passages) {
    if (passage.score < minimum) continue;
    const current = best.get(passage.documentId);
    if (!current || passage.score > current.score) best.set(passage.documentId, passage);
  }
  return [...best.values()].sort((a, b) => b.score - a.score).slice(0, limit);
}

/** A short excerpt around the first query word found, for showing why a document matched. */
export function snippet(text: string, query: string, length = 180): string {
  const lower = text.toLowerCase();
  const hit = tokens(query)
    .map((word) => lower.indexOf(word))
    .filter((index) => index >= 0)
    .sort((a, b) => a - b)[0];
  const start = hit === undefined ? 0 : Math.max(0, hit - Math.floor(length / 3));
  const piece = text
    .slice(start, start + length)
    .replace(/\s+/g, " ")
    .trim();
  return `${start > 0 ? "…" : ""}${piece}${start + length < text.length ? "…" : ""}`;
}
