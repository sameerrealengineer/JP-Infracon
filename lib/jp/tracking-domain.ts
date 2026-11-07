/**
 * Team tracking: one month of attendance, site presence (GPS) and daily reports per person,
 * summed exactly (hours in hundredths, days in halves) so the dashboard never rounds by itself.
 */

import type { AttendanceStatus } from "./attendance-domain";

const IST_OFFSET_MS = 330 * 60_000;

/** First and last date of a month ("2026-11" → 2026-11-01 … 2026-11-30), or null if invalid. */
export function monthRange(month: string): { from: string; to: string } | null {
  const match = /^(\d{4})-(\d{2})$/.exec(month);
  if (!match) return null;
  const year = Number(match[1]);
  const index = Number(match[2]) - 1;
  if (index < 0 || index > 11 || year < 2000 || year > 2100) return null;
  const last = new Date(Date.UTC(year, index + 1, 0)).getUTCDate();
  return { from: `${month}-01`, to: `${month}-${String(last).padStart(2, "0")}` };
}

/** The UTC instants that bound a month in India time, for timestamp queries. */
export function monthInstants(month: string): { start: Date; end: Date } | null {
  const range = monthRange(month);
  if (!range) return null;
  const start = new Date(Date.parse(`${range.from}T00:00:00Z`) - IST_OFFSET_MS);
  const end = new Date(Date.parse(`${range.to}T23:59:59.999Z`) - IST_OFFSET_MS);
  return { start, end };
}

/** India date ("YYYY-MM-DD") of an instant. */
export function istDate(at: Date) {
  return new Date(at.getTime() + IST_OFFSET_MS).toISOString().slice(0, 10);
}

/** The month before ("2026-01" → "2025-12") and after. */
export function shiftMonth(month: string, by: number) {
  const [year, m] = month.split("-").map(Number);
  return new Date(Date.UTC(year, m - 1 + by, 1)).toISOString().slice(0, 7);
}

export type TrackedAttendance = {
  personId: string;
  status: AttendanceStatus;
  regularHundredths: bigint;
  overtimeHundredths: bigint;
  overtimeApproved: boolean;
  /** Approved by a reviewer (counts as final). */
  approved: boolean;
};

export type AttendanceSummary = {
  /** Present days in halves: a Full Day is 2, a Half Day 1, an hours-based day 2. */
  presentHalfDays: number;
  absentDays: number;
  leaveDays: number;
  /** Days with any attendance mark. */
  markedDays: number;
  regularHundredths: bigint;
  overtimeHundredths: bigint;
  overtimePendingHundredths: bigint;
  /** Marks still waiting for a reviewer. */
  pendingRows: number;
};

export function emptyAttendance(): AttendanceSummary {
  return {
    presentHalfDays: 0,
    absentDays: 0,
    leaveDays: 0,
    markedDays: 0,
    regularHundredths: 0n,
    overtimeHundredths: 0n,
    overtimePendingHundredths: 0n,
    pendingRows: 0,
  };
}

/** One summary per person from their attendance rows in the month. */
export function summarizeMonthAttendance(rows: readonly TrackedAttendance[]) {
  const byPerson = new Map<string, AttendanceSummary>();
  for (const row of rows) {
    const sum = byPerson.get(row.personId) ?? emptyAttendance();
    sum.markedDays += 1;
    if (row.status === "Full Day" || row.status === "Present-hours-based") sum.presentHalfDays += 2;
    else if (row.status === "Half Day") sum.presentHalfDays += 1;
    else if (row.status === "Absent") sum.absentDays += 1;
    else if (row.status === "Leave") sum.leaveDays += 1;
    sum.regularHundredths += row.regularHundredths;
    sum.overtimeHundredths += row.overtimeHundredths;
    if (!row.overtimeApproved) sum.overtimePendingHundredths += row.overtimeHundredths;
    if (!row.approved) sum.pendingRows += 1;
    byPerson.set(row.personId, sum);
  }
  return byPerson;
}

/** "11.5" from 23 half days. */
export function formatHalfDays(halves: number) {
  return halves % 2 === 0 ? String(halves / 2) : `${Math.floor(halves / 2)}.5`;
}

/** Share of marked days the person was present, in whole percent (null when nothing marked). */
export function attendancePercent(sum: AttendanceSummary) {
  if (sum.markedDays === 0) return null;
  return Math.round((sum.presentHalfDays * 50) / sum.markedDays);
}

export type PresenceEvent = { userId: number; eventType: "Arrived" | "Left"; occurredAt: Date };

export type PresenceSummary = {
  /** India dates with at least one arrival. */
  daysOnSite: number;
  lastEvent: "Arrived" | "Left" | null;
  lastAt: Date | null;
  /** The latest event is an arrival today (India time). */
  onSiteNow: boolean;
  /** First arrival today (India time), if any. */
  arrivedTodayAt: Date | null;
};

/** One presence summary per phone user from their arrival/departure events. */
export function summarizePresence(events: readonly PresenceEvent[], now: Date) {
  const today = istDate(now);
  const byUser = new Map<number, PresenceSummary & { days: Set<string> }>();
  const sorted = [...events].sort((a, b) => a.occurredAt.getTime() - b.occurredAt.getTime());
  for (const event of sorted) {
    const sum = byUser.get(event.userId) ?? {
      daysOnSite: 0,
      lastEvent: null,
      lastAt: null,
      onSiteNow: false,
      arrivedTodayAt: null,
      days: new Set<string>(),
    };
    const day = istDate(event.occurredAt);
    if (event.eventType === "Arrived") {
      sum.days.add(day);
      if (day === today && !sum.arrivedTodayAt) sum.arrivedTodayAt = event.occurredAt;
    }
    sum.lastEvent = event.eventType;
    sum.lastAt = event.occurredAt;
    byUser.set(event.userId, sum);
  }
  const result = new Map<number, PresenceSummary>();
  for (const [userId, sum] of byUser)
    result.set(userId, {
      daysOnSite: sum.days.size,
      lastEvent: sum.lastEvent,
      lastAt: sum.lastAt,
      onSiteNow:
        sum.lastEvent === "Arrived" && sum.lastAt !== null && istDate(sum.lastAt) === today,
      arrivedTodayAt: sum.arrivedTodayAt,
    });
  return result;
}

export type ReportCount = { submitted: number; approved: number; returned: number; drafts: number };

/** Daily reports per writer: drafts are counted apart and never as submitted. */
export function countReports(rows: readonly { createdBy: number; status: string }[]) {
  const byUser = new Map<number, ReportCount>();
  for (const row of rows) {
    const count = byUser.get(row.createdBy) ?? {
      submitted: 0,
      approved: 0,
      returned: 0,
      drafts: 0,
    };
    if (row.status === "Draft") count.drafts += 1;
    else {
      count.submitted += 1;
      if (row.status === "Approved") count.approved += 1;
      if (row.status === "Returned for Correction") count.returned += 1;
    }
    byUser.set(row.createdBy, count);
  }
  return byUser;
}

export type TaskCount = { open: number; done: number; overdue: number };

/** Tasks per responsible person: done, still open, and open past their planned end. */
export function countTasks(
  rows: readonly { assigneeUserId: number | null; status: string; plannedEnd: string }[],
  today: string,
) {
  const byUser = new Map<number, TaskCount>();
  for (const row of rows) {
    if (row.assigneeUserId === null || row.status === "Cancelled") continue;
    const count = byUser.get(row.assigneeUserId) ?? { open: 0, done: 0, overdue: 0 };
    if (row.status === "Completed") count.done += 1;
    else {
      count.open += 1;
      if (row.plannedEnd < today) count.overdue += 1;
    }
    byUser.set(row.assigneeUserId, count);
  }
  return byUser;
}
