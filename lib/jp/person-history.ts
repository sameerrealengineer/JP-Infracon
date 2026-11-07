import {
  estimateEarning,
  parseHours,
  type AttendanceStatus,
  type RateType,
} from "./attendance-domain";

/**
 * A person's work history across sites: attendance and estimated earnings per site, and the
 * feedback recorded about them. Money is exact paise as strings; nothing here is a payment.
 */

export const FEEDBACK_KINDS = [
  "Quality",
  "Default",
  "Safety",
  "Praise",
  "Payment dispute",
] as const;
export type FeedbackKind = (typeof FEEDBACK_KINDS)[number];

export type FeedbackInput = { kind: FeedbackKind; rating?: number | null; note: string };

/** Checks one feedback entry. Ratings are 1–5 stars and only for Quality. */
export function validateFeedback(
  input: FeedbackInput,
): { code: "RATING" | "NOTE"; message: string } | null {
  const note = input.note.trim();
  if (note.length < 3)
    return { code: "NOTE", message: "Write what happened (at least a few words)." };
  if (input.kind === "Quality") {
    if (!Number.isInteger(input.rating) || (input.rating ?? 0) < 1 || (input.rating ?? 0) > 5)
      return { code: "RATING", message: "Give a quality rating from 1 to 5 stars." };
  } else if (input.rating !== null && input.rating !== undefined)
    return { code: "RATING", message: "Only Quality entries carry a star rating." };
  return null;
}

export type AttendanceRow = {
  siteId: string;
  workDate: string;
  status: AttendanceStatus;
  regularHours: string;
  overtimeHours: string;
  overtimeApproved: boolean;
  rateType: RateType | null;
  rateMinor: number | null;
};

export type SiteWorkSummary = {
  siteId: string;
  daysPresent: number;
  daysAbsent: number;
  firstDate: string | null;
  lastDate: string | null;
  regularHundredths: string;
  overtimeHundredths: string;
  /** Estimated from attendance and rates; null when no rate could be applied. */
  estimatedEarningsMinor: string | null;
  rowsWithoutRate: number;
};

/** Attendance totals per site, in the order sites first appear. */
export function summarizeAttendance(rows: readonly AttendanceRow[]): SiteWorkSummary[] {
  const bySite = new Map<
    string,
    SiteWorkSummary & { regular: bigint; overtime: bigint; earned: bigint; priced: number }
  >();
  for (const row of rows) {
    let entry = bySite.get(row.siteId);
    if (!entry) {
      entry = {
        siteId: row.siteId,
        daysPresent: 0,
        daysAbsent: 0,
        firstDate: null,
        lastDate: null,
        regularHundredths: "0",
        overtimeHundredths: "0",
        estimatedEarningsMinor: null,
        rowsWithoutRate: 0,
        regular: 0n,
        overtime: 0n,
        earned: 0n,
        priced: 0,
      };
      bySite.set(row.siteId, entry);
    }
    const absent = row.status === "Absent" || row.status === "Leave";
    if (absent) entry.daysAbsent += 1;
    else entry.daysPresent += 1;
    if (!entry.firstDate || row.workDate < entry.firstDate) entry.firstDate = row.workDate;
    if (!entry.lastDate || row.workDate > entry.lastDate) entry.lastDate = row.workDate;
    const regular = parseHours(row.regularHours) ?? 0n;
    const overtime = parseHours(row.overtimeHours) ?? 0n;
    if (!absent) {
      entry.regular += regular;
      if (row.overtimeApproved) entry.overtime += overtime;
    }
    const earning = estimateEarning({
      status: row.status,
      rateType: row.rateType,
      rateMinor: row.rateMinor,
      regularHundredths: regular,
      overtimeHundredths: overtime,
      overtimeApproved: row.overtimeApproved,
    });
    if (earning.kind === "amount") {
      entry.earned += earning.minor;
      entry.priced += 1;
    } else entry.rowsWithoutRate += 1;
  }
  return [...bySite.values()].map(({ regular, overtime, earned, priced, ...rest }) => ({
    ...rest,
    regularHundredths: regular.toString(),
    overtimeHundredths: overtime.toString(),
    estimatedEarningsMinor: priced > 0 ? earned.toString() : null,
  }));
}

/** Average stars (one decimal) and counts per kind. */
export function summarizeFeedback(
  entries: readonly { kind: FeedbackKind; rating: number | null }[],
) {
  const counts = Object.fromEntries(FEEDBACK_KINDS.map((kind) => [kind, 0])) as Record<
    FeedbackKind,
    number
  >;
  let stars = 0;
  let rated = 0;
  for (const entry of entries) {
    counts[entry.kind] += 1;
    if (entry.kind === "Quality" && entry.rating) {
      stars += entry.rating;
      rated += 1;
    }
  }
  return {
    averageRating: rated ? Math.round((stars / rated) * 10) / 10 : null,
    ratedCount: rated,
    counts,
  };
}

/** Adds exact paise strings. */
export function sumMinor(values: readonly (string | null | undefined)[]) {
  return values.reduce((total, value) => total + BigInt(value || "0"), 0n).toString();
}
