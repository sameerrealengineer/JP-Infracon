import { describe, expect, it } from "vitest";
import {
  summarizeAttendance,
  summarizeFeedback,
  sumMinor,
  validateFeedback,
  type AttendanceRow,
} from "./person-history";

const row = (over: Partial<AttendanceRow>): AttendanceRow => ({
  siteId: "A",
  workDate: "2026-10-01",
  status: "Full Day",
  regularHours: "8",
  overtimeHours: "0",
  overtimeApproved: false,
  rateType: "daily",
  rateMinor: 80000,
  ...over,
});

describe("person history", () => {
  it("totals attendance and estimated earnings per site in exact paise", () => {
    const summary = summarizeAttendance([
      row({ workDate: "2026-10-02" }),
      row({ workDate: "2026-10-01", status: "Half Day", regularHours: "4" }),
      row({ workDate: "2026-10-03", status: "Absent", regularHours: "0" }),
      row({ workDate: "2026-10-04", overtimeHours: "2", overtimeApproved: true }),
      row({ siteId: "B", workDate: "2026-09-10", rateType: null, rateMinor: null }),
    ]);
    expect(summary[0]).toMatchObject({
      siteId: "A",
      daysPresent: 3,
      daysAbsent: 1,
      firstDate: "2026-10-01",
      lastDate: "2026-10-04",
      regularHundredths: "2000",
      overtimeHundredths: "200",
      // 800 + 400 + 0 + (800 + 2h × 100) rupees
      estimatedEarningsMinor: "220000",
    });
    expect(summary[1]).toMatchObject({
      siteId: "B",
      estimatedEarningsMinor: null,
      rowsWithoutRate: 1,
    });
  });

  it("validates feedback: stars only for quality, a real note always", () => {
    expect(validateFeedback({ kind: "Quality", rating: 4, note: "Neat plaster" })).toBeNull();
    expect(validateFeedback({ kind: "Quality", rating: 6, note: "Neat plaster" })?.code).toBe(
      "RATING",
    );
    expect(validateFeedback({ kind: "Default", rating: 2, note: "Left mid job" })?.code).toBe(
      "RATING",
    );
    expect(validateFeedback({ kind: "Default", note: "  " })?.code).toBe("NOTE");
  });

  it("averages quality stars and counts kinds", () => {
    expect(
      summarizeFeedback([
        { kind: "Quality", rating: 4 },
        { kind: "Quality", rating: 5 },
        { kind: "Default", rating: null },
      ]),
    ).toMatchObject({ averageRating: 4.5, ratedCount: 2, counts: { Quality: 2, Default: 1 } });
    expect(summarizeFeedback([]).averageRating).toBeNull();
  });

  it("adds paise strings exactly", () => {
    expect(sumMinor(["9007199254740993", "7", null])).toBe("9007199254741000");
  });
});
