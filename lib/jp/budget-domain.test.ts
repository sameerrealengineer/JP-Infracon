import { describe, expect, it } from "vitest";
import {
  compareBudget,
  costHeadForVendor,
  formatTenths,
  marginMinor,
  validateBudgetLines,
} from "./budget-domain";

describe("validateBudgetLines", () => {
  it("cleans lines, orders them by head and totals exact paise", () => {
    const result = validateBudgetLines([
      { costHead: "Labour", amountMinor: "250000000", note: "  " },
      { costHead: "Materials", amountMinor: "1000000001" },
    ]);
    expect(result).toEqual({
      lines: [
        { costHead: "Materials", amountMinor: "1000000001", note: null },
        { costHead: "Labour", amountMinor: "250000000", note: null },
      ],
      totalMinor: "1250000001",
    });
  });

  it("rejects an empty budget, a repeated head and a zero or bad amount", () => {
    expect(validateBudgetLines([])).toMatchObject({ code: "BUDGET_INVALID" });
    expect(
      validateBudgetLines([
        { costHead: "Labour", amountMinor: "100" },
        { costHead: "Labour", amountMinor: "200" },
      ]),
    ).toMatchObject({ message: "Labour is entered twice." });
    expect(validateBudgetLines([{ costHead: "Other", amountMinor: "0" }])).toMatchObject({
      code: "BUDGET_INVALID",
    });
    expect(validateBudgetLines([{ costHead: "Other", amountMinor: "12.5" }])).toMatchObject({
      code: "BUDGET_INVALID",
    });
  });
});

describe("compareBudget", () => {
  it("shows ok, near, over and unbudgeted heads and keeps pending spend separate", () => {
    const result = compareBudget(
      [
        { costHead: "Materials", amountMinor: "100000" },
        { costHead: "Labour", amountMinor: "100000" },
        { costHead: "Subcontract", amountMinor: "100000" },
      ],
      {
        Materials: { actualMinor: 50000n, pendingMinor: 70000n },
        Labour: { actualMinor: 90000n, pendingMinor: 0n },
        Subcontract: { actualMinor: 100001n, pendingMinor: 0n },
        "Site expenses": { actualMinor: 500n, pendingMinor: 0n },
      },
    );
    const byHead = Object.fromEntries(result.heads.map((row) => [row.costHead, row]));
    expect(byHead.Materials).toMatchObject({ state: "ok", usedTenths: 500, pendingMinor: "70000" });
    expect(byHead.Labour).toMatchObject({ state: "near", usedTenths: 900 });
    expect(byHead.Subcontract).toMatchObject({ state: "over", remainingMinor: "-1" });
    expect(byHead["Site expenses"]).toMatchObject({ state: "unbudgeted", usedTenths: null });
    expect(byHead.Other).toMatchObject({ state: "none" });
    expect(result.totals).toMatchObject({
      budgetMinor: "300000",
      actualMinor: "240501",
      pendingMinor: "70000",
      remainingMinor: "59499",
      usedTenths: 802,
      state: "ok",
    });
  });
});

describe("helpers", () => {
  it("maps supplier types to cost heads", () => {
    expect(costHeadForVendor("Material Supplier")).toBe("Materials");
    expect(costHeadForVendor("Subcontractor")).toBe("Subcontract");
    expect(costHeadForVendor("Transporter")).toBe("Equipment and transport");
    expect(costHeadForVendor("Service Provider")).toBe("Other");
  });

  it("computes margin only with a contract value and formats percentages", () => {
    expect(marginMinor(null, "100")).toBeNull();
    expect(marginMinor("1000", "1500")).toBe("-500");
    expect(formatTenths(802)).toBe("80.2%");
    expect(formatTenths(1000)).toBe("100%");
    expect(formatTenths(null)).toBe("—");
  });
});
