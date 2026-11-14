/** Leave applications: types, length in half days, overlap and date checks. */
export const LEAVE_TYPES = ["Casual", "Sick", "Earned", "Unpaid", "Other"] as const;
export type LeaveType = (typeof LEAVE_TYPES)[number];

const toTime = (date: string) => Date.parse(`${date}T00:00:00Z`);
const isDate = (value: string) => /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(toTime(value));

/** Length in half days: every calendar day counts 2, a single half day counts 1. */
export function leaveHalfDays(fromDate: string, toDate: string, halfDay: boolean): number {
  const days = Math.round((toTime(toDate) - toTime(fromDate)) / 86_400_000) + 1;
  if (halfDay) return 1;
  return days * 2;
}

/** "2 days", "½ day", "1½ days". */
export function leaveLengthText(halfDays: number): string {
  const whole = Math.floor(halfDays / 2);
  const half = halfDays % 2 === 1;
  if (!whole) return "½ day";
  return `${whole}${half ? "½" : ""} day${whole === 1 && !half ? "" : "s"}`;
}

/** A problem with the request, or null. */
export function leaveProblem(input: {
  fromDate: string;
  toDate: string;
  halfDay: boolean;
  reason: string;
}): string | null {
  if (!isDate(input.fromDate) || !isDate(input.toDate)) return "Use dates like 2026-11-14.";
  if (toTime(input.toDate) < toTime(input.fromDate)) return "The leave ends before it starts.";
  if (input.halfDay && input.fromDate !== input.toDate)
    return "A half day must start and end on the same day.";
  if ((toTime(input.toDate) - toTime(input.fromDate)) / 86_400_000 > 90)
    return "Apply for at most 90 days at a time.";
  if (input.reason.trim().length < 3) return "Give a short reason.";
  return null;
}

/** True when two date ranges share at least one day. */
export function rangesOverlap(
  a: { fromDate: string; toDate: string },
  b: { fromDate: string; toDate: string },
): boolean {
  return a.fromDate <= b.toDate && b.fromDate <= a.toDate;
}
