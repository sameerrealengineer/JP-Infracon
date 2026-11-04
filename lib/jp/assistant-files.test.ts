import { strToU8, zipSync } from "fflate";
import { describe, expect, it } from "vitest";
import {
  base64Bytes,
  checkAssistantFileSizes,
  isFileError,
  prepareAssistantFile,
} from "./assistant-files";

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);
const PDF = strToU8("%PDF-1.7\n1 0 obj\n<<>>\nendobj\n");

describe("assistant files", () => {
  it("sends photos and PDFs to the AI as they are, by their bytes not their name", () => {
    const photo = prepareAssistantFile("site.pdf", PNG);
    expect(isFileError(photo)).toBe(false);
    expect(photo).toMatchObject({ kind: "inline", contentType: "image/png" });
    expect(prepareAssistantFile("drawing.pdf", PDF)).toMatchObject({
      kind: "inline",
      contentType: "application/pdf",
    });
  });

  it("turns Word, Excel and CSV into text", () => {
    const docx = zipSync({
      "word/document.xml": strToU8(
        "<w:document><w:body><w:p><w:r><w:t>BOQ item 4: M25 concrete</w:t></w:r></w:p></w:body></w:document>",
      ),
    });
    expect(prepareAssistantFile("boq.docx", docx)).toMatchObject({
      kind: "text",
      text: "BOQ item 4: M25 concrete",
    });
    expect(prepareAssistantFile("rates.csv", strToU8("item,rate\ncement,410"))).toMatchObject({
      kind: "text",
      text: "item,rate\ncement,410",
    });
  });

  it("refuses unknown files, and explains CAD drawings", () => {
    expect(prepareAssistantFile("plan.dwg", strToU8("AC1032 binary"))).toMatchObject({
      code: "UNSUPPORTED",
      message: expect.stringContaining("Export the drawing as PDF"),
    });
    expect(prepareAssistantFile("notes.exe", new Uint8Array([0x4d, 0x5a, 1, 2]))).toMatchObject({
      code: "UNSUPPORTED",
    });
    expect(prepareAssistantFile("empty.csv", new Uint8Array())).toMatchObject({ code: "EMPTY" });
  });

  it("limits count and size before decoding", () => {
    expect(base64Bytes("QUJD")).toBe(3);
    expect(base64Bytes("QUI=")).toBe(2);
    const big = "A".repeat(Math.ceil((11 * 1024 * 1024 * 4) / 3));
    expect(checkAssistantFileSizes([{ name: "big.pdf", base64: big }])?.code).toBe("TOO_LARGE");
    const four = Array.from({ length: 4 }, (_, i) => ({ name: `${i}.png`, base64: "QUJD" }));
    expect(checkAssistantFileSizes(four)?.code).toBe("TOO_MANY");
    expect(checkAssistantFileSizes(four.slice(0, 3))).toBeNull();
  });
});
