import { describe, expect, it } from "vitest";
import {
  attendancePercent,
  countReports,
  countTasks,
  formatHalfDays,
  istDate,
  monthInstants,
  monthRange,
  shiftMonth,
  summarizeMonthAttendance,
  summarizePresence,
} from "./tracking-domain";

describe("tracking domain", () => {
  it("bounds a month, including February in a leap year, and refuses bad input", () => {
    expect(monthRange("2026-11")).toEqual({ from: "2026-11-01", to: "2026-11-30" });
    expect(monthRange("2028-02")).toEqual({ from: "2028-02-01", to: "2028-02-29" });
    expect(monthRange("2026-13")).toBeNull();
    expect(monthRange("26-11")).toBeNull();
    expect(shiftMonth("2026-01", -1)).toBe("2025-12");
    expect(shiftMonth("2026-12", 1)).toBe("2027-01");
  });

  it("uses India time for month edges and dates", () => {
    const edges = monthInstants("2026-11")!;
    expect(edges.start.toISOString()).toBe("2026-10-31T18:30:00.000Z");
    expect(edges.end.toISOString()).toBe("2026-11-30T18:29:59.999Z");
    // 20:00 UTC on 5 Nov is 01:30 on 6 Nov in India.
    expect(istDate(new Date("2026-11-05T20:00:00Z"))).toBe("2026-11-06");
  });

  it("adds days in halves and hours exactly, with pending overtime and reviews apart", () => {
    const row = (
      status: string,
      regular: bigint,
      overtime: bigint,
      otOk: boolean,
      ok: boolean,
    ) => ({
      personId: "p1",
      status: status as "Full Day",
      regularHundredths: regular,
      overtimeHundredths: overtime,
      overtimeApproved: otOk,
      approved: ok,
    });
    const sum = summarizeMonthAttendance([
      row("Full Day", 800n, 200n, true, true),
      row("Half Day", 400n, 0n, true, true),
      row("Absent", 0n, 0n, true, true),
      row("Leave", 0n, 0n, true, false),
      row("Present-hours-based", 650n, 150n, false, false),
    ]).get("p1")!;
    expect(sum.presentHalfDays).toBe(5);
    expect(formatHalfDays(sum.presentHalfDays)).toBe("2.5");
    expect(sum.absentDays).toBe(1);
    expect(sum.leaveDays).toBe(1);
    expect(sum.markedDays).toBe(5);
    expect(sum.regularHundredths).toBe(1850n);
    expect(sum.overtimeHundredths).toBe(350n);
    expect(sum.overtimePendingHundredths).toBe(150n);
    expect(sum.pendingRows).toBe(2);
    expect(attendancePercent(sum)).toBe(50);
  });

  it("knows who is on site now and how many days they came", () => {
    const now = new Date("2026-11-06T06:00:00Z"); // 11:30 India time
    const at = (iso: string) => new Date(iso);
    const presence = summarizePresence(
      [
        { userId: 1, eventType: "Arrived", occurredAt: at("2026-11-05T03:00:00Z") },
        { userId: 1, eventType: "Left", occurredAt: at("2026-11-05T12:00:00Z") },
        { userId: 1, eventType: "Arrived", occurredAt: at("2026-11-06T03:30:00Z") },
        { userId: 2, eventType: "Arrived", occurredAt: at("2026-11-04T03:00:00Z") },
        { userId: 2, eventType: "Left", occurredAt: at("2026-11-06T04:00:00Z") },
      ],
      now,
    );
    expect(presence.get(1)).toMatchObject({ daysOnSite: 2, lastEvent: "Arrived", onSiteNow: true });
    expect(presence.get(1)!.arrivedTodayAt?.toISOString()).toBe("2026-11-06T03:30:00.000Z");
    expect(presence.get(2)).toMatchObject({ daysOnSite: 1, lastEvent: "Left", onSiteNow: false });
    // Arrived yesterday and never left: not "on site now".
    const stale = summarizePresence(
      [{ userId: 3, eventType: "Arrived", occurredAt: at("2026-11-05T03:00:00Z") }],
      now,
    );
    expect(stale.get(3)!.onSiteNow).toBe(false);
  });

  it("counts reports by writer and never counts drafts as submitted", () => {
    const counts = countReports([
      { createdBy: 7, status: "Draft" },
      { createdBy: 7, status: "Submitted" },
      { createdBy: 7, status: "Approved" },
      { createdBy: 7, status: "Returned for Correction" },
    ]).get(7);
    expect(counts).toEqual({ submitted: 3, approved: 1, returned: 1, drafts: 1 });
  });

  it("counts each person's tasks and which are late", () => {
    const counts = countTasks(
      [
        { assigneeUserId: 5, status: "Completed", plannedEnd: "2026-11-01" },
        { assigneeUserId: 5, status: "In Progress", plannedEnd: "2026-11-01" },
        { assigneeUserId: 5, status: "Planned", plannedEnd: "2026-11-30" },
        { assigneeUserId: 5, status: "Cancelled", plannedEnd: "2026-11-01" },
        { assigneeUserId: null, status: "Planned", plannedEnd: "2026-11-01" },
      ],
      "2026-11-06",
    );
    expect(counts.get(5)).toEqual({ open: 2, done: 1, overdue: 1 });
    expect(counts.size).toBe(1);
  });
});
