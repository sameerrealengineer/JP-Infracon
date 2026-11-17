/**
 * Hindrance register rules (CPWD / State PWD practice): each hindrance has a cause, a start and
 * (once over) an end date, and whether it stopped the work fully or partly. The extension of
 * time (EOT) claim counts calendar days of full-stop hindrances, with overlapping periods counted
 * once; partial hindrances are listed apart for the engineer-in-charge to assess.
 */

export const HINDRANCE_CATEGORIES = [
  "Site not handed over",
  "Drawings or decisions pending",
  "Change in scope",
  "Department material not supplied",
  "Payment delay",
  "Rain or flood",
  "Public or land dispute",
  "Utility shifting (power, water, road)",
  "Statutory permission pending",
  "Other",
] as const;
export type HindranceCategory = (typeof HINDRANCE_CATEGORIES)[number];

const DAY = 86_400_000;
const toDay = (iso: string) => Math.floor(Date.parse(`${iso}T00:00:00Z`) / DAY);

/** Inclusive calendar days of one hindrance; an open one runs to today. */
export function hindranceDays(startDate: string, endDate: string | null, today: string) {
  const end = endDate ?? today;
  if (end < startDate) return 0;
  return toDay(end) - toDay(startDate) + 1;
}

/** Calendar days covered by a set of periods, overlaps counted once. */
export function mergedDays(
  periods: readonly { startDate: string; endDate: string | null }[],
  today: string,
) {
  const spans = periods
    .map((p) => [toDay(p.startDate), toDay(p.endDate ?? today)] as const)
    .filter(([a, b]) => b >= a)
    .sort((x, y) => x[0] - y[0]);
  let total = 0;
  let curStart = -Infinity;
  let curEnd = -Infinity;
  for (const [a, b] of spans) {
    if (a > curEnd + 1) {
      if (curEnd >= curStart && Number.isFinite(curStart)) total += curEnd - curStart + 1;
      curStart = a;
      curEnd = b;
    } else curEnd = Math.max(curEnd, b);
  }
  if (Number.isFinite(curStart)) total += curEnd - curStart + 1;
  return total;
}

/** EOT claim summary for a site's hindrances. */
export function eotSummary(
  rows: readonly { startDate: string; endDate: string | null; affectsWork: string }[],
  today: string,
) {
  const full = rows.filter((row) => row.affectsWork === "Full stop");
  const partial = rows.filter((row) => row.affectsWork !== "Full stop");
  return {
    fullStopDays: mergedDays(full, today),
    partialDays: mergedDays(partial, today),
    open: rows.filter((row) => row.endDate === null).length,
  };
}

export function hindranceProblem(input: {
  category: string;
  description: string;
  startDate: string;
  endDate: string | null;
  today: string;
}): string | null {
  if (!HINDRANCE_CATEGORIES.includes(input.category as HindranceCategory))
    return "Choose what caused the hindrance.";
  if (input.description.trim().length < 5) return "Describe the hindrance in a few words.";
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.startDate)) return "Enter the start date.";
  if (input.startDate > input.today) return "The start date cannot be in the future.";
  if (input.endDate && input.endDate < input.startDate)
    return "The end date is before the start date.";
  if (input.endDate && input.endDate > input.today) return "The end date cannot be in the future.";
  return null;
}

/** HIN-SITECODE-001 */
export function hindranceCode(siteCode: string, sequence: number) {
  return `HIN-${siteCode}-${String(sequence).padStart(3, "0")}`;
}
