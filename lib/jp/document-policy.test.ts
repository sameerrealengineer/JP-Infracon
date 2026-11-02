import { zipSync, strToU8 } from "fflate";
import { describe, expect, it } from "vitest";

import {
  chunkText,
  cosineSimilarity,
  hybridScore,
  keywordScore,
  normalizeTags,
  rankDocuments,
  safeDocumentName,
  sniffDocumentType,
  snippet,
} from "./document-policy";

describe("sniffDocumentType", () => {
  it("recognises PDFs and photos by their bytes", () => {
    expect(sniffDocumentType(strToU8("%PDF-1.7 ..."), "x.bin")).toBe("application/pdf");
    expect(sniffDocumentType(new Uint8Array([0xff, 0xd8, 0xff, 0xe0]), "a.pdf")).toBe("image/jpeg");
  });

  it("tells Word and Excel files apart from their contents", () => {
    const docx = zipSync({ "word/document.xml": strToU8("<w:document/>") });
    const xlsx = zipSync({ "xl/workbook.xml": strToU8("<workbook/>") });
    const other = zipSync({ "readme.txt": strToU8("hi") });
    expect(sniffDocumentType(docx, "a.docx")).toContain("wordprocessingml");
    expect(sniffDocumentType(xlsx, "a.xlsx")).toContain("spreadsheetml");
    expect(sniffDocumentType(other, "a.zip")).toBeNull();
  });

  it("accepts CSV only for text named .csv", () => {
    expect(sniffDocumentType(strToU8("item,qty\ncement,10\n"), "boq.csv")).toBe("text/csv");
    expect(sniffDocumentType(strToU8("item,qty"), "boq.txt")).toBeNull();
    expect(sniffDocumentType(new Uint8Array([0x41, 0x00, 0x42]), "x.csv")).toBeNull();
  });
});

describe("names and tags", () => {
  it("strips paths and fixes the extension to the real type", () => {
    expect(safeDocumentName("../../etc/Bill #12.exe", "application/pdf")).toBe("Bill _12.pdf");
  });

  it("normalises tags", () => {
    expect(normalizeTags("Slab, Block-A ,  slab\nGrid 3")).toEqual(["slab", "block-a", "grid 3"]);
    expect(normalizeTags(Array.from({ length: 15 }, (_, i) => `t${i}`))).toHaveLength(10);
  });
});

describe("chunkText", () => {
  it("returns nothing for empty text and one chunk for short text", () => {
    expect(chunkText("  ")).toEqual([]);
    expect(chunkText("Short note.")).toEqual(["Short note."]);
  });

  it("splits long text at sentence ends with overlap", () => {
    const text = Array.from({ length: 60 }, (_, i) => `Sentence number ${i} about the slab.`).join(
      " ",
    );
    const chunks = chunkText(text, 300, 50);
    expect(chunks.length).toBeGreaterThan(5);
    for (const chunk of chunks) expect(chunk.length).toBeLessThanOrEqual(300);
    expect(chunks.join(" ")).toContain("Sentence number 59");
  });
});

describe("scores", () => {
  it("measures vector similarity", () => {
    expect(cosineSimilarity([1, 0], [1, 0])).toBe(1);
    expect(cosineSimilarity([1, 0], [0, 1])).toBe(0);
    expect(cosineSimilarity([1], [1, 2])).toBe(0);
  });

  it("boosts exact codes such as invoice numbers", () => {
    const text = "Tax invoice INV-2026-0042 from Odisha Cement for 120 bags";
    expect(keywordScore("INV-2026-0042", text)).toBeGreaterThan(keywordScore("cement bags", text));
    expect(keywordScore("steel", text)).toBe(0);
  });

  it("uses keywords alone when there is no vector score", () => {
    expect(hybridScore(null, 0.5)).toBe(0.5);
    expect(hybridScore(0.9, 0)).toBeCloseTo(0.63);
  });

  it("keeps the best passage per document", () => {
    const ranked = rankDocuments([
      { documentId: "a", content: "a1", score: 0.3 },
      { documentId: "a", content: "a2", score: 0.8 },
      { documentId: "b", content: "b1", score: 0.5 },
      { documentId: "c", content: "c1", score: 0.1 },
    ]);
    expect(ranked.map((row) => [row.documentId, row.content])).toEqual([
      ["a", "a2"],
      ["b", "b1"],
    ]);
  });

  it("shows an excerpt around the match", () => {
    const text = `${"x ".repeat(200)}structural drawing for slab ${"y ".repeat(200)}`;
    const piece = snippet(text, "structural drawing");
    expect(piece).toContain("structural drawing");
    expect(piece.startsWith("…")).toBe(true);
  });
});
