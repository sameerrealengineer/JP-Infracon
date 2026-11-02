import { strToU8, zipSync } from "fflate";
import { describe, expect, it } from "vitest";

import { extractDocumentText } from "./document-text";

const WORD = "application/vnd.openxmlformats-officedocument.wordprocessingml.document" as const;
const EXCEL = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" as const;

describe("extractDocumentText", () => {
  it("reads paragraphs from a Word file", () => {
    const docx = zipSync({
      "word/document.xml": strToU8(
        '<w:document><w:body><w:p><w:r><w:t>Work order WO-17</w:t></w:r></w:p><w:p><w:r><w:t xml:space="preserve">Slab &amp; beams</w:t></w:r></w:p></w:body></w:document>',
      ),
    });
    expect(extractDocumentText(docx, WORD)).toBe("Work order WO-17\nSlab & beams\n");
  });

  it("reads rows from an Excel file with shared strings", () => {
    const xlsx = zipSync({
      "xl/sharedStrings.xml": strToU8("<sst><si><t>Item</t></si><si><t>Cement</t></si></sst>"),
      "xl/worksheets/sheet1.xml": strToU8(
        '<worksheet><sheetData><row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1" t="inlineStr"><is><t>Qty</t></is></c></row><row r="2"><c r="A2" t="s"><v>1</v></c><c r="B2"><v>120</v></c></row></sheetData></worksheet>',
      ),
    });
    expect(extractDocumentText(xlsx, EXCEL)).toBe("Item | Qty\nCement | 120");
  });

  it("returns CSV as text and nothing for broken files", () => {
    expect(extractDocumentText(strToU8("a,b\n1,2"), "text/csv")).toBe("a,b\n1,2");
    expect(extractDocumentText(strToU8("not a zip"), WORD)).toBe("");
    expect(extractDocumentText(strToU8("%PDF-"), "application/pdf")).toBe("");
  });
});
