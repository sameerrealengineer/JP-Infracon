/** Warranty dates and state: active, expiring soon (30 days), expired or closed. */
export const WARRANTY_CATEGORIES = [
  "Equipment",
  "Doors and windows",
  "Electrical",
  "Plumbing",
  "Waterproofing",
  "Painting and coating",
  "Structure",
  "Defect liability",
  "Other",
] as const;

export const EXPIRING_DAYS = 30;

export type WarrantyState = "Active" | "Expiring" | "Expired" | "Closed";

const DAY = 86_400_000;
const toTime = (date: string) => Date.parse(`${date}T00:00:00Z`);

export function daysLeft(endDate: string, today: string): number {
  return Math.round((toTime(endDate) - toTime(today)) / DAY);
}

export function warrantyState(
  warranty: { endDate: string; status: "Active" | "Closed" },
  today: string,
): WarrantyState {
  if (warranty.status === "Closed") return "Closed";
  const left = daysLeft(warranty.endDate, today);
  if (left < 0) return "Expired";
  if (left <= EXPIRING_DAYS) return "Expiring";
  return "Active";
}

/** The end date `years` and `months` after a start date (same day of month). */
export function endAfter(startDate: string, years: number, months = 0): string {
  const date = new Date(`${startDate}T12:00:00Z`);
  date.setUTCMonth(date.getUTCMonth() + years * 12 + months);
  date.setUTCDate(date.getUTCDate() - 1);
  return date.toISOString().slice(0, 10);
}

/** A problem with the dates, or null. */
export function warrantyDateProblem(startDate: string, endDate: string): string | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(startDate) || !/^\d{4}-\d{2}-\d{2}$/.test(endDate))
    return "Use dates like 2026-11-14.";
  if (toTime(endDate) < toTime(startDate)) return "The warranty ends before it starts.";
  if (daysLeft(endDate, startDate) > 30 * 366)
    return "A warranty longer than 30 years looks wrong.";
  return null;
}
