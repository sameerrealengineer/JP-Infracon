import { describe, expect, it } from "vitest";
import { annualTaxNewRegime, suggestedMonthlyTds } from "./salary-tds";

const rupees = (value: number) => BigInt(value) * 100n;

describe("salary TDS suggestion (new regime)", () => {
  it("is nil up to ₹12 lakh taxable income", () => {
    expect(suggestedMonthlyTds(rupees(30_000))).toBe(0n);
    expect(suggestedMonthlyTds(rupees(106_250))).toBe(0n); // 12.75 lakh gross, 12 lakh taxable
  });

  it("works out the slabs and cess above it", () => {
    // 1.2 lakh a month: taxable 13.65 lakh, tax 84,750, cess 3,390, monthly 7,345.
    expect(annualTaxNewRegime(rupees(1_365_000))).toBe(rupees(84_750));
    expect(suggestedMonthlyTds(rupees(120_000))).toBe(rupees(7_345));
  });

  it("gives marginal relief just above ₹12 lakh", () => {
    // Taxable 12.1 lakh: slab tax 61,500 but relief caps it at 10,000.
    expect(annualTaxNewRegime(rupees(1_210_000))).toBe(rupees(10_000));
  });

  it("uses 30% above ₹24 lakh", () => {
    expect(annualTaxNewRegime(rupees(3_000_000))).toBe(rupees(300_000 + 180_000));
  });
});
