import { describe, expect, it } from "vitest";
import {
  estimateEarning,
  formatHours,
  parseHours,
  validateAttendanceEntry,
  type EarningInput,
} from "./attendance-domain";

const base: EarningInput = {
  status: "Full Day",
  rateType: "daily",
  rateMinor: 60000, // ₹600/day
  regularHundredths: 800n,
  overtimeHundredths: 0n,
  overtimeApproved: false,
};

describe("parseHours", () => {
  it("parses exact hundredths and rejects bad input", () => {
    expect(parseHours("7.5")).toBe(750n);
    expect(parseHours("")).toBe(0n);
    expect(parseHours("8.25")).toBe(825n);
    expect(parseHours("-1")).toBeNull();
    expect(parseHours("8.125")).toBeNull();
    expect(parseHours("25")).toBeNull();
    expect(formatHours(750n)).toBe("7.5");
    expect(formatHours(800n)).toBe("8");
  });
});

describe("estimateEarning", () => {
  it("prices full and half days on a daily rate", () => {
    expect(estimateEarning(base)).toEqual({ kind: "amount", minor: 60000n, overtimeMinor: 0n });
    expect(estimateEarning({ ...base, status: "Half Day" })).toMatchObject({ minor: 30000n });
  });
  it("counts overtime only when approved, at the base hourly equivalent", () => {
    const withOt = { ...base, overtimeHundredths: 200n };
    expect(estimateEarning(withOt)).toMatchObject({ minor: 60000n });
    // ₹600 / 8h = ₹75/h; 2h approved = ₹150
    expect(estimateEarning({ ...withOt, overtimeApproved: true })).toEqual({
      kind: "amount",
      minor: 75000n,
      overtimeMinor: 15000n,
    });
  });
  it("prices hourly rates from hours", () => {
    expect(
      estimateEarning({ ...base, rateType: "hourly", rateMinor: 9000, regularHundredths: 750n }),
    ).toMatchObject({ minor: 67500n });
  });
  it("pays nothing for absence and flags missing or non-attendance rates", () => {
    expect(estimateEarning({ ...base, status: "Absent" })).toMatchObject({ minor: 0n });
    expect(estimateEarning({ ...base, rateMinor: null })).toEqual({ kind: "missing_rate" });
    expect(estimateEarning({ ...base, rateType: "piece" })).toEqual({
      kind: "not_attendance_based",
    });
  });
});

describe("validateAttendanceEntry", () => {
  it("accepts normal entries and rejects contradictions", () => {
    expect(
      validateAttendanceEntry({ status: "Full Day", regularHours: "8", overtimeHours: "2" }),
    ).toBeNull();
    expect(
      validateAttendanceEntry({ status: "Absent", regularHours: "8", overtimeHours: "0" }),
    ).toMatch(/Absent/);
    expect(
      validateAttendanceEntry({
        status: "Present-hours-based",
        regularHours: "",
        overtimeHours: "0",
      }),
    ).toMatch(/hours/);
    expect(
      validateAttendanceEntry({ status: "Full Day", regularHours: "20", overtimeHours: "6" }),
    ).toMatch(/24/);
  });
});
