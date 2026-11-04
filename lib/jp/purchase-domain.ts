import { lineAmountMinor, percentOf } from "./billing-domain";

/**
 * Purchase rules: purchase order totals (GST per line), how much has arrived against each line,
 * quote comparison, and matching a supplier bill against what was ordered and received.
 * Money is exact paise (BigInt), quantities exact thousandths, GST in basis points.
 */

export const PO_STATUSES = [
  "Draft",
  "Submitted",
  "Approved",
  "Rejected",
  "Cancelled",
  "Closed",
] as const;
export type PoStatus = (typeof PO_STATUSES)[number];

export type PoLine = { quantityThousandths: bigint; rateMinor: bigint; gstBps: number };

export function poTotals(lines: readonly PoLine[]) {
  let subtotal = 0n;
  let gst = 0n;
  for (const line of lines) {
    const amount = lineAmountMinor(line.quantityThousandths, line.rateMinor);
    subtotal += amount;
    gst += percentOf(amount, line.gstBps);
  }
  return { subtotalMinor: subtotal, gstMinor: gst, totalMinor: subtotal + gst };
}

/** What a transition needs: which statuses it starts from, the result, and who may do it. */
export const PO_TRANSITIONS = {
  submit: { from: ["Draft", "Rejected"], to: "Submitted", maker: true },
  approve: { from: ["Submitted"], to: "Approved", maker: false },
  reject: { from: ["Submitted"], to: "Rejected", maker: false },
  cancel: { from: ["Draft", "Rejected", "Submitted"], to: "Cancelled", maker: true },
  close: { from: ["Approved"], to: "Closed", maker: false },
} as const;
export type PoAction = keyof typeof PO_TRANSITIONS;

export type ReceiptState = "Not received" | "Part received" | "Received";

/** Received against ordered, per line and for the whole order. */
export function receiptState(
  lines: readonly { orderedThousandths: bigint; receivedThousandths: bigint }[],
): ReceiptState {
  if (lines.every((line) => line.receivedThousandths <= 0n)) return "Not received";
  return lines.every((line) => line.receivedThousandths >= line.orderedThousandths)
    ? "Received"
    : "Part received";
}

/** A delivery cannot accept more than is still due on the line. */
export function checkDelivery(args: {
  description: string;
  orderedThousandths: bigint;
  alreadyReceivedThousandths: bigint;
  acceptedThousandths: bigint;
  rejectedThousandths: bigint;
  rejectReason?: string | null;
}): { code: string; message: string } | null {
  if (args.acceptedThousandths < 0n || args.rejectedThousandths < 0n)
    return { code: "NEGATIVE", message: `${args.description}: quantities cannot be negative.` };
  if (args.acceptedThousandths === 0n && args.rejectedThousandths === 0n)
    return { code: "EMPTY", message: `${args.description}: enter what arrived.` };
  if (args.rejectedThousandths > 0n && !args.rejectReason?.trim())
    return { code: "REASON", message: `${args.description}: say why material was rejected.` };
  const due = args.orderedThousandths - args.alreadyReceivedThousandths;
  if (args.acceptedThousandths > due)
    return {
      code: "OVER_ORDER",
      message: `${args.description}: accepting more than the ${due < 0n ? 0n : due / 1000n} still due on the order. Raise a new or amended PO.`,
    };
  return null;
}

/** Marks the lowest of several quotes. */
export function lowestQuote<T extends { totalMinor: bigint }>(quotes: readonly T[]) {
  if (!quotes.length) return null;
  return quotes.reduce((low, quote) => (quote.totalMinor < low.totalMinor ? quote : low));
}

export type MatchState = "No bill yet" | "Matches" | "Billed more than received" | "Billed less";

/**
 * Three-way match: the value of what was received (at PO rates, with GST) against the bills
 * linked to the order. A small difference (₹1 or 0.5%) counts as a match for rounding.
 */
export function matchBills(args: {
  lines: readonly (PoLine & { receivedThousandths: bigint })[];
  billedMinor: bigint;
  hasBills: boolean;
}) {
  const receivedValue = poTotals(
    args.lines.map((line) => ({ ...line, quantityThousandths: line.receivedThousandths })),
  ).totalMinor;
  const difference = args.billedMinor - receivedValue;
  const tolerance = receivedValue / 200n > 100n ? receivedValue / 200n : 100n;
  const state: MatchState = !args.hasBills
    ? "No bill yet"
    : difference > tolerance
      ? "Billed more than received"
      : difference < -tolerance
        ? "Billed less"
        : "Matches";
  return {
    receivedValueMinor: receivedValue,
    billedMinor: args.billedMinor,
    differenceMinor: difference,
    state,
  };
}

/** Thousandths to the decimal text the inventory ledger stores ("12.500"). */
export function toLedgerQuantity(thousandths: bigint) {
  const whole = thousandths / 1000n;
  const fraction = (thousandths % 1000n).toString().padStart(3, "0");
  return `${whole}.${fraction}`;
}
