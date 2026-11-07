import { describe, expect, it } from "vitest";

import { summarizeLabour } from "./dlr-domain";

const row = (
  trade: string | null,
  status: string,
  regularHours: string | number,
  overtimeHours: string | number = "0.00",
  approved = false,
) => ({ trade, status, regularHours, overtimeHours, approved });

describe("summarizeLabour", () => {
  it("counts people by trade and adds hours exactly", () => {
    const summary = summarizeLabour([
      row("Mason", "Full Day", "8.00", "1.50", true),
      row("Mason", "Half Day", "4.00"),
      row("Helper", "Full Day", 8, "0.25", true),
      row("Helper", "Absent", "0.00"),
      row(null, "Present-hours-based", "6.5"),
      row("Electrician", "Leave", "0"),
    ]);
    expect(summary.trades).toEqual([
      {
        trade: "Electrician",
        fullDay: 0,
        halfDay: 0,
        hoursBased: 0,
        absent: 0,
        leave: 1,
        regularHours: "0",
        overtimeHours: "0",
      },
      {
        trade: "Helper",
        fullDay: 1,
        halfDay: 0,
        hoursBased: 0,
        absent: 1,
        leave: 0,
        regularHours: "8",
        overtimeHours: "0.25",
      },
      {
        trade: "Mason",
        fullDay: 1,
        halfDay: 1,
        hoursBased: 0,
        absent: 0,
        leave: 0,
        regularHours: "12",
        overtimeHours: "1.5",
      },
      {
        trade: "Other",
        fullDay: 0,
        halfDay: 0,
        hoursBased: 1,
        absent: 0,
        leave: 0,
        regularHours: "6.5",
        overtimeHours: "0",
      },
    ]);
    expect(summary.totals).toEqual({
      marked: 6,
      onSite: 4,
      absentOrLeave: 2,
      regularHours: "26.5",
      overtimeHours: "1.75",
      approved: 2,
      pending: 4,
    });
  });

  it("does not count hours for someone marked absent", () => {
    expect(summarizeLabour([row("Helper", "Absent", "8")]).totals.regularHours).toBe("0");
  });

  it("is empty when no attendance is marked", () => {
    expect(summarizeLabour([])).toEqual({
      trades: [],
      totals: {
        marked: 0,
        onSite: 0,
        absentOrLeave: 0,
        regularHours: "0",
        overtimeHours: "0",
        approved: 0,
        pending: 0,
      },
    });
  });
});
