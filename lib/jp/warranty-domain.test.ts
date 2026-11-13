import { describe, expect, it } from "vitest";
import { daysLeft, endAfter, warrantyDateProblem, warrantyState } from "./warranty-domain";

describe("warranty domain", () => {
  it("counts days left", () => {
    expect(daysLeft("2026-12-14", "2026-11-14")).toBe(30);
    expect(daysLeft("2026-11-13", "2026-11-14")).toBe(-1);
  });

  it("marks expiring within 30 days, expired after the end, closed when closed", () => {
    expect(warrantyState({ endDate: "2027-11-14", status: "Active" }, "2026-11-14")).toBe("Active");
    expect(warrantyState({ endDate: "2026-12-10", status: "Active" }, "2026-11-14")).toBe(
      "Expiring",
    );
    expect(warrantyState({ endDate: "2026-11-01", status: "Active" }, "2026-11-14")).toBe(
      "Expired",
    );
    expect(warrantyState({ endDate: "2030-01-01", status: "Closed" }, "2026-11-14")).toBe("Closed");
  });

  it("works out the end date from years", () => {
    expect(endAfter("2026-11-10", 10)).toBe("2036-11-09");
    expect(endAfter("2026-11-10", 0, 12)).toBe("2027-11-09");
  });

  it("checks dates", () => {
    expect(warrantyDateProblem("2026-11-10", "2026-11-01")).toMatch(/before it starts/);
    expect(warrantyDateProblem("10-11-2026", "2027-11-01")).toMatch(/dates like/);
    expect(warrantyDateProblem("2026-11-10", "2036-11-09")).toBeNull();
  });
});
