import { describe, expect, it } from "vitest";
import { dateRangesOverlap, formatPaiseAsRupees, isCalendarDate, parseRupeesToPaise, previousCalendarDate } from "./workforce-domain";

describe("workforce effective dates and rate amounts", () => {
  it("converts INR strings to integer paise without floating point", () => {
    expect(parseRupeesToPaise("1500")).toBe(150000);
    expect(parseRupeesToPaise("0.5")).toBe(50);
    expect(parseRupeesToPaise("125.07")).toBe(12507);
    expect(formatPaiseAsRupees(12507)).toBe("₹125.07");
  });

  it("rejects zero, malformed precision, and amounts exceeding database integer range", () => {
    for (const value of ["0", "-1", "01", "1.001", "1e3", "21474837"]) {
      expect(() => parseRupeesToPaise(value)).toThrow(RangeError);
    }
  });

  it("treats effective endpoints as inclusive and preserves non-overlapping ranges", () => {
    expect(dateRangesOverlap({ from: "2026-01-01", to: null }, { from: "2026-01-02", to: null })).toBe(true);
    expect(dateRangesOverlap({ from: "2026-01-01", to: "2026-01-31" }, { from: "2026-02-01", to: null })).toBe(false);
    expect(dateRangesOverlap({ from: "2026-01-01", to: "2026-01-31" }, { from: "2026-01-31", to: null })).toBe(true);
  });

  it("validates real calendar dates and closes a prior rate on the previous calendar day", () => {
    expect(isCalendarDate("2024-02-29")).toBe(true);
    expect(isCalendarDate("2025-02-29")).toBe(false);
    expect(previousCalendarDate("2026-01-01")).toBe("2025-12-31");
  });
});
