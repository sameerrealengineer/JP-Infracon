export const MAX_RATE_MINOR = 2_147_483_647;

/** Parse a decimal INR amount without floating-point arithmetic into integer paise. */
export function parseRupeesToPaise(value: string): number {
  const trimmed = value.trim();
  if (!/^(?:0|[1-9]\d{0,7})(?:\.\d{1,2})?$/.test(trimmed)) {
    throw new RangeError("Enter a valid rupee amount with up to two decimal places.");
  }
  const [rupees, paise = ""] = trimmed.split(".");
  const minor = BigInt(rupees) * 100n + BigInt(paise.padEnd(2, "0") || "0");
  if (minor <= 0n || minor > BigInt(MAX_RATE_MINOR)) {
    throw new RangeError("Rate must be greater than zero and within the supported amount range.");
  }
  return Number(minor);
}

export function formatPaiseAsRupees(value: number): string {
  if (!Number.isSafeInteger(value) || value < 0)
    throw new RangeError("Rate must be a non-negative integer in paise.");
  const rupees = Math.floor(value / 100);
  const paise = String(value % 100).padStart(2, "0");
  return `₹${rupees.toLocaleString("en-IN")}.${paise}`;
}

export function previousCalendarDate(value: string): string {
  if (!isCalendarDate(value)) throw new RangeError("Enter a valid calendar date.");
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day - 1));
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}-${String(date.getUTCDate()).padStart(2, "0")}`;
}

export function isCalendarDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

/** Effective date endpoints are inclusive calendar dates. */
export function dateRangesOverlap(
  a: { from: string; to: string | null },
  b: { from: string; to: string | null },
): boolean {
  return (a.to === null || a.to >= b.from) && (b.to === null || b.to >= a.from);
}
