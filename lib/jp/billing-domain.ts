/**
 * CRM and client billing rules: lead stages, quotation and RA bill amounts, GST, retention and
 * TDS, cumulative quantities against the contract, and what a client still owes.
 * Money is exact integer paise (BigInt); quantities are exact thousandths; rates of tax and
 * deduction are basis points (1% = 100 bps). The server computes every total; the client
 * never sends one. These are internal records, not a GST return or e-invoice.
 */

export const LEAD_STAGES = [
  "New",
  "Contacted",
  "Site visit",
  "Quotation sent",
  "Negotiation",
  "Won",
  "Lost",
] as const;
export type LeadStage = (typeof LEAD_STAGES)[number];

export const LEAD_SOURCES = [
  "Referral",
  "Tender",
  "Walk-in",
  "Phone",
  "WhatsApp",
  "Website",
  "Existing client",
  "Other",
] as const;

export const ACTIVITY_KINDS = [
  "Call",
  "Site visit",
  "Meeting",
  "WhatsApp",
  "Email",
  "Note",
] as const;

export const CLIENT_TYPES = [
  "Government",
  "Private company",
  "Individual",
  "Builder",
  "Other",
] as const;

export type BillingError = { code: string; message: string };

/** Open leads may move to any stage; a Won or Lost lead is closed and can only be reopened. */
export function leadStageChange(from: LeadStage, to: LeadStage, reason?: string | null) {
  if (from === to) return { code: "SAME_STAGE", message: "The lead is already at this stage." };
  if ((from === "Won" || from === "Lost") && to !== "Contacted")
    return { code: "CLOSED", message: "A closed lead can only be reopened (moved to Contacted)." };
  if (to === "Lost" && !reason?.trim())
    return { code: "REASON", message: "Say why the lead was lost." };
  return null;
}

/** Parses a quantity like "12.5" into thousandths; positive, at most 3 decimals. */
export function parseQuantity(value: string): bigint | null {
  const text = value.trim();
  if (!/^\d{1,12}(\.\d{1,3})?$/.test(text)) return null;
  const [whole, fraction = ""] = text.split(".");
  const result = BigInt(whole) * 1000n + BigInt(fraction.padEnd(3, "0"));
  return result > 0n ? result : null;
}

export function formatQuantity(thousandths: bigint | string): string {
  const value = BigInt(thousandths);
  const negative = value < 0n;
  const abs = negative ? -value : value;
  const whole = abs / 1000n;
  const fraction = (abs % 1000n).toString().padStart(3, "0").replace(/0+$/, "");
  return `${negative ? "-" : ""}${whole}${fraction ? `.${fraction}` : ""}`;
}

/** Parses a percentage like "18" or "2.5" into basis points (0–100%). */
export function parsePercentBps(value: string): number | null {
  const text = value.trim();
  if (!/^\d{1,3}(\.\d{1,2})?$/.test(text)) return null;
  const [whole, fraction = ""] = text.split(".");
  const bps = Number(whole) * 100 + Number(fraction.padEnd(2, "0"));
  return bps <= 10_000 ? bps : null;
}

export function formatPercent(bps: number) {
  const whole = Math.floor(bps / 100);
  const fraction = (bps % 100).toString().padStart(2, "0").replace(/0+$/, "");
  return `${whole}${fraction ? `.${fraction}` : ""}%`;
}

/** Rounds a/b to the nearest whole unit, halves away from zero. */
function divRound(a: bigint, b: bigint) {
  const half = b / 2n;
  return a >= 0n ? (a + half) / b : -((-a + half) / b);
}

/** Line amount in paise: quantity (thousandths) × rate (paise per unit), rounded. */
export function lineAmountMinor(quantityThousandths: bigint, rateMinor: bigint) {
  return divRound(quantityThousandths * rateMinor, 1000n);
}

export function percentOf(amountMinor: bigint, bps: number) {
  return divRound(amountMinor * BigInt(bps), 10_000n);
}

export type MoneyLine = { quantityThousandths: bigint; rateMinor: bigint };

/** Quotation: lines, then GST on the subtotal. */
export function quotationTotals(lines: readonly MoneyLine[], gstBps: number) {
  const subtotal = lines.reduce(
    (sum, line) => sum + lineAmountMinor(line.quantityThousandths, line.rateMinor),
    0n,
  );
  const gst = percentOf(subtotal, gstBps);
  return { subtotalMinor: subtotal, gstMinor: gst, totalMinor: subtotal + gst };
}

/**
 * Running-account (RA) bill: work value this bill, GST on it, then deductions the client keeps:
 * retention (on work value), TDS (on work value, not on GST) and any other deduction.
 * Net receivable is what the client should pay for this bill.
 */
export function billTotals(args: {
  lines: readonly MoneyLine[];
  gstBps: number;
  retentionBps: number;
  tdsBps: number;
  otherDeductionMinor: bigint;
}) {
  const work = args.lines.reduce(
    (sum, line) => sum + lineAmountMinor(line.quantityThousandths, line.rateMinor),
    0n,
  );
  const gst = percentOf(work, args.gstBps);
  const gross = work + gst;
  const retention = percentOf(work, args.retentionBps);
  const tds = percentOf(work, args.tdsBps);
  const net = gross - retention - tds - args.otherDeductionMinor;
  return {
    workValueMinor: work,
    gstMinor: gst,
    grossMinor: gross,
    retentionMinor: retention,
    tdsMinor: tds,
    otherDeductionMinor: args.otherDeductionMinor,
    netReceivableMinor: net,
  };
}

/** A bill line cannot take a contract item past its contract quantity. */
export function checkCumulativeQuantity(args: {
  description: string;
  contractQuantity: bigint;
  previouslyBilled: bigint;
  thisBill: bigint;
}): BillingError | null {
  const after = args.previouslyBilled + args.thisBill;
  if (after > args.contractQuantity)
    return {
      code: "OVER_CONTRACT",
      message: `${args.description}: billing ${formatQuantity(args.thisBill)} would take it to ${formatQuantity(after)}, above the contract quantity ${formatQuantity(args.contractQuantity)}.`,
    };
  return null;
}

export const BILL_STATUSES = ["Draft", "Submitted", "Approved", "Rejected", "Cancelled"] as const;
export type BillStatus = (typeof BILL_STATUSES)[number];

/** What the client still owes on an approved bill, and how it reads. */
export function billPaymentState(netReceivableMinor: bigint, receivedMinor: bigint) {
  const outstanding = netReceivableMinor - receivedMinor;
  return {
    receivedMinor,
    outstandingMinor: outstanding < 0n ? 0n : outstanding,
    excessMinor: outstanding < 0n ? -outstanding : 0n,
    paymentStatus:
      receivedMinor <= 0n
        ? ("Unpaid" as const)
        : outstanding > 0n
          ? ("Part paid" as const)
          : ("Paid" as const),
  };
}

/** A receipt cannot be more than what is still outstanding on the bill. */
export function checkReceipt(amountMinor: bigint, outstandingMinor: bigint): BillingError | null {
  if (amountMinor <= 0n) return { code: "AMOUNT", message: "Enter the amount received." };
  if (amountMinor > outstandingMinor)
    return {
      code: "OVER_RECEIPT",
      message: "This is more than what is outstanding on the bill. Check the amount.",
    };
  return null;
}

/** Days since the bill date, grouped for an ageing report. */
export function ageingBucket(billDate: string, today: string) {
  const days = Math.floor(
    (Date.parse(`${today}T00:00:00Z`) - Date.parse(`${billDate}T00:00:00Z`)) / 86_400_000,
  );
  if (days <= 30) return "0–30 days" as const;
  if (days <= 60) return "31–60 days" as const;
  if (days <= 90) return "61–90 days" as const;
  return "Over 90 days" as const;
}

/** Next number in a series like QT-2026-0007 or RA-PATIA-03. */
export function nextNumber(prefix: string, existing: readonly string[], width = 4) {
  let max = 0;
  for (const value of existing) {
    if (!value.startsWith(prefix)) continue;
    const n = Number(value.slice(prefix.length));
    if (Number.isInteger(n) && n > max) max = n;
  }
  return `${prefix}${String(max + 1).padStart(width, "0")}`;
}
