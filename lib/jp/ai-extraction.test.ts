import { describe, expect, it } from "vitest";
import { cleanRupees, normalizeBill, normalizeIssueFields, parseModelJson } from "./ai-extraction";

describe("cleanRupees", () => {
  it("strips symbols and rounds to paise", () => {
    expect(cleanRupees("₹1,23,456.789")).toBe("123456.79");
    expect(cleanRupees("Rs. 500")).toBe("500.00");
    expect(cleanRupees("five hundred")).toBe("");
  });
});

describe("normalizeBill", () => {
  it("cleans fields and accepts a consistent bill", () => {
    const bill = normalizeBill({
      supplierName: " Odisha Cement Traders ",
      invoiceNumber: "OCT / 2026 / 118",
      invoiceDate: "2026-10-30",
      lines: [{ description: "OPC 53 cement", quantity: "50", unit: "Bag", amount: "19,000" }],
      taxTotal: "3420",
      otherCharges: "500",
      grandTotal: "22920",
    });
    expect(bill.invoiceNumber).toBe("OCT/2026/118");
    expect(bill.lines[0]).toEqual({
      description: "OPC 53 cement",
      quantity: "50",
      unitCode: "Bag",
      lineTotalRupees: "19000.00",
    });
    expect(bill.warnings).toEqual([]);
  });
  it("warns about mismatched totals, unreadable fields and bad dates", () => {
    const bill = normalizeBill({
      supplierName: "X",
      invoiceNumber: "",
      invoiceDate: "30/10/2026",
      dueDate: "2026-10-01",
      lines: [{ description: "Steel", quantity: "abc", unit: "MT", amount: "1000" }],
      taxTotal: "0",
      grandTotal: "5000",
    });
    expect(bill.warnings.join(" ")).toMatch(/quantity unclear/);
    expect(bill.warnings.join(" ")).toMatch(/Invoice number/);
    expect(bill.warnings.join(" ")).toMatch(/do not match/);
    expect(bill.invoiceDate).toBe("");
  });
});

describe("issues and parsing", () => {
  it("keeps only known categories and severities", () => {
    expect(
      normalizeIssueFields({ category: "Safety Hazard", severity: "Extreme", title: "Open pit" }),
    ).toMatchObject({
      category: "Safety Hazard",
      severity: null,
      title: "Open pit",
    });
  });
  it("parses fenced or chatty JSON", () => {
    expect(parseModelJson('Here you go:\n```json\n{"a":1}\n```')).toEqual({ a: 1 });
    expect(parseModelJson('{"b":2} thanks')).toEqual({ b: 2 });
    expect(() => parseModelJson("no data")).toThrow();
  });
});
