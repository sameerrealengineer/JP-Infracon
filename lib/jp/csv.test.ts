import { describe, expect, it } from "vitest";
import { buildCsv, csvCell, exportFileName, paiseToDecimal } from "./csv";

describe("csvCell", () => {
  it("quotes commas, quotes and new lines", () => {
    expect(csvCell('Cement, "OPC"')).toBe('"Cement, ""OPC"""');
    expect(csvCell("line1\nline2")).toBe('"line1\nline2"');
  });
  it("neutralises formula injection but keeps negative numbers", () => {
    expect(csvCell('=HYPERLINK("x")')).toBe('"\'=HYPERLINK(""x"")"');
    expect(csvCell("@SUM(A1)")).toBe("'@SUM(A1)");
    expect(csvCell("-12.50")).toBe("-12.50");
    expect(csvCell("+91 98765")).toBe("'+91 98765");
  });
  it("handles empty values and dates", () => {
    expect(csvCell(null)).toBe("");
    expect(csvCell(new Date("2026-11-02T00:00:00.000Z"))).toBe("2026-11-02T00:00:00.000Z");
  });
});

describe("buildCsv and helpers", () => {
  it("writes metadata, header and rows with a BOM", () => {
    const csv = buildCsv({ Organisation: "JP Infracon" }, ["A", "B"], [["x", 1]]);
    expect(csv.startsWith("﻿# Organisation,JP Infracon\r\n\r\nA,B\r\nx,1")).toBe(true);
  });
  it("converts paise exactly", () => {
    expect(paiseToDecimal("123450")).toBe("1234.50");
    expect(paiseToDecimal("5")).toBe("0.05");
    expect(paiseToDecimal("-250")).toBe("-2.50");
    expect(paiseToDecimal(null)).toBe("");
  });
  it("names files by kind and time", () => {
    expect(exportFileName("issues", new Date("2026-11-02T09:05:00Z"))).toBe(
      "jp-infracon-issues-2026-11-02-09-05.csv",
    );
  });
});
