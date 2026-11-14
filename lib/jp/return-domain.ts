/** Purchase returns: line amounts in exact paise, totals, status changes. */
import { parseStockQuantity } from "./inventory-domain";

export const RETURN_SETTLEMENTS = ["Refund", "Credit note", "Replacement"] as const;
export type ReturnSettlement = (typeof RETURN_SETTLEMENTS)[number];
export type ReturnStatus = "Submitted" | "Approved" | "Rejected" | "Settled" | "Cancelled";

/** Rupees text ("1250.50") to paise; null when not a valid amount. */
export function rupeesToPaise(value: string): bigint | null {
  const match = /^(\d{1,13})(?:\.(\d{1,2}))?$/.exec(value.trim());
  if (!match) return null;
  return BigInt(match[1]!) * 100n + BigInt((match[2] ?? "").padEnd(2, "0") || "0");
}

/** quantity (up to 3 decimals) × rate in paise, rounded half up to whole paise. */
export function lineAmountMinor(quantity: string, rateMinor: bigint): bigint {
  const thousandths = parseStockQuantity(quantity);
  return (thousandths * rateMinor + 500n) / 1000n;
}

export function returnTotalMinor(lines: { quantity: string; rateMinor: bigint }[]): bigint {
  return lines.reduce((sum, line) => sum + lineAmountMinor(line.quantity, line.rateMinor), 0n);
}

const NEXT: Record<ReturnStatus, readonly ReturnStatus[]> = {
  Submitted: ["Approved", "Rejected", "Cancelled"],
  Approved: ["Settled"],
  Rejected: [],
  Settled: [],
  Cancelled: [],
};

export function canMoveReturn(from: ReturnStatus, to: ReturnStatus): boolean {
  return NEXT[from].includes(to);
}

/** "PR-RET-<SITE>-NNN". */
export function returnNumber(siteCode: string, sequence: number): string {
  return `RET-${siteCode}-${String(sequence).padStart(3, "0")}`;
}
