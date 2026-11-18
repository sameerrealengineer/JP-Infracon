/**
 * Tenders, guarantees and time extensions for a works contractor. Money is exact paise strings
 * (BigInt); dates are YYYY-MM-DD in India time. Guarantees (EMD, performance guarantee, security
 * deposit, advance BG) are money locked with a bank or the department until released.
 */

export const TENDER_STATUSES = [
  "Preparing",
  "Submitted",
  "Opened",
  "Won",
  "Lost",
  "Withdrawn",
  "Cancelled",
] as const;
export type TenderStatus = (typeof TENDER_STATUSES)[number];

/** Which status a tender may move to next. */
const NEXT: Record<TenderStatus, readonly TenderStatus[]> = {
  Preparing: ["Submitted", "Withdrawn", "Cancelled"],
  Submitted: ["Opened", "Withdrawn", "Cancelled"],
  Opened: ["Won", "Lost", "Cancelled"],
  Won: [],
  Lost: [],
  Withdrawn: [],
  Cancelled: [],
};

export function tenderMoveProblem(from: string, to: string): string | null {
  if (
    !TENDER_STATUSES.includes(from as TenderStatus) ||
    !TENDER_STATUSES.includes(to as TenderStatus)
  )
    return "Unknown tender status.";
  return NEXT[from as TenderStatus].includes(to as TenderStatus)
    ? null
    : `A ${from.toLowerCase()} tender cannot be marked ${to.toLowerCase()}.`;
}

export const GUARANTEE_KINDS = [
  "EMD",
  "Performance guarantee",
  "Security deposit",
  "Mobilisation advance BG",
  "Other guarantee",
] as const;
export const GUARANTEE_INSTRUMENTS = [
  "Bank guarantee",
  "FDR",
  "Demand draft",
  "Online (e-payment)",
  "Deducted from bill",
  "Cash",
] as const;

export type GuaranteeState = "Active" | "Expiring" | "Expired" | "Released" | "Encashed";

const DAY = 86_400_000;
const toDay = (iso: string) => Math.floor(Date.parse(`${iso}T00:00:00Z`) / DAY);

/** Days from today to a date (negative when past). */
export function daysUntil(date: string, today: string) {
  return toDay(date) - toDay(today);
}

/** A guarantee is Expiring within 30 days of its expiry, Expired after it (until released). */
export function guaranteeState(
  row: { status: string; expiryDate: string | null },
  today: string,
): GuaranteeState {
  if (row.status === "Released") return "Released";
  if (row.status === "Encashed") return "Encashed";
  if (!row.expiryDate) return "Active";
  const left = daysUntil(row.expiryDate, today);
  if (left < 0) return "Expired";
  if (left <= 30) return "Expiring";
  return "Active";
}

/** Money still locked: guarantees not released or encashed, by kind (paise strings). */
export function lockedByKind(
  rows: readonly { kind: string; status: string; amountMinor: string }[],
) {
  const out = new Map<string, bigint>();
  for (const row of rows)
    if (row.status === "Active")
      out.set(row.kind, (out.get(row.kind) ?? 0n) + BigInt(row.amountMinor));
  return [...out.entries()].map(([kind, amount]) => ({ kind, amountMinor: amount.toString() }));
}

export function guaranteeProblem(input: {
  kind: string;
  instrument: string;
  amountMinor: bigint;
  issueDate: string;
  expiryDate: string | null;
}): string | null {
  if (!GUARANTEE_KINDS.includes(input.kind as never)) return "Choose the guarantee type.";
  if (!GUARANTEE_INSTRUMENTS.includes(input.instrument as never)) return "Choose how it was given.";
  if (input.amountMinor <= 0n) return "Enter the amount.";
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.issueDate)) return "Enter the issue date.";
  if (input.expiryDate && input.expiryDate < input.issueDate)
    return "The expiry date is before the issue date.";
  if (input.instrument === "Bank guarantee" && !input.expiryDate)
    return "A bank guarantee needs its expiry date.";
  return null;
}

/** New completion date after granted extensions (calendar days added). */
export function extendedCompletion(stipulated: string, grantedDays: readonly number[]) {
  const total = grantedDays.reduce((sum, days) => sum + Math.max(0, Math.round(days)), 0);
  return new Date((toDay(stipulated) + total) * DAY).toISOString().slice(0, 10);
}

/** TND-2026-001 */
export function tenderCode(year: number, sequence: number) {
  return `TND-${year}-${String(sequence).padStart(3, "0")}`;
}

/** Quoted percent above (+) or below (−) the estimate, to two decimals; null without both. */
export function quotedPercent(estimateMinor: string | null, quotedMinor: string | null) {
  if (!estimateMinor || !quotedMinor) return null;
  const estimate = BigInt(estimateMinor);
  if (estimate <= 0n) return null;
  const diff = (BigInt(quotedMinor) - estimate) * 10000n;
  const bps =
    diff >= 0n ? (diff + estimate / 2n) / estimate : -((-diff + estimate / 2n) / estimate);
  return Number(bps) / 100;
}
