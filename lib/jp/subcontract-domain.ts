import { lineAmountMinor, parseQuantity, percentOf } from "./billing-domain";

/**
 * Subcontract rules: work orders (the subcontractor's BOQ), the measurement book (nos × L × B
 * × D, with deductions), RA bills built from checked measurements, retention, TDS and recovery
 * of the mobilisation advance. Money is exact paise (BigInt), quantities exact thousandths,
 * percentages in basis points.
 */

export const WO_STATUSES = [
  "Draft",
  "Submitted",
  "Approved",
  "Rejected",
  "Cancelled",
  "Closed",
] as const;
export type WoStatus = (typeof WO_STATUSES)[number];

export const WO_TRANSITIONS = {
  submit: { from: ["Draft", "Rejected"], to: "Submitted", maker: true },
  approve: { from: ["Submitted"], to: "Approved", maker: false },
  reject: { from: ["Submitted"], to: "Rejected", maker: false },
  cancel: { from: ["Draft", "Rejected", "Submitted"], to: "Cancelled", maker: true },
  close: { from: ["Approved"], to: "Closed", maker: false },
} as const;
export type WoAction = keyof typeof WO_TRANSITIONS;

export const SUB_BILL_TRANSITIONS = {
  submit: { from: ["Draft", "Rejected"], to: "Submitted", maker: true },
  approve: { from: ["Submitted"], to: "Approved", maker: false },
  reject: { from: ["Submitted"], to: "Rejected", maker: false },
  cancel: { from: ["Draft", "Rejected", "Submitted"], to: "Cancelled", maker: true },
} as const;
export type SubBillAction = keyof typeof SUB_BILL_TRANSITIONS;

export type Dimensions = {
  nos?: string | null;
  length?: string | null;
  breadth?: string | null;
  depth?: string | null;
};

/**
 * Measured quantity in thousandths: the product of the dimensions given (nos × L × B × D),
 * rounded to 3 decimals. Leave out what does not apply (running metre: nos × L).
 * Returns an error message instead when a value is not a positive number.
 */
export function measuredQuantity(dims: Dimensions): bigint | string {
  const parts: bigint[] = [];
  for (const [label, raw] of [
    ["Nos", dims.nos],
    ["Length", dims.length],
    ["Breadth", dims.breadth],
    ["Depth", dims.depth],
  ] as const) {
    if (raw === null || raw === undefined || raw.trim() === "") continue;
    const value = parseQuantity(raw);
    if (value === null) return `${label}: enter a number more than 0, up to 3 decimals.`;
    parts.push(value);
  }
  if (!parts.length) return "Enter at least one measurement.";
  let product = parts[0];
  let scale = 1n;
  for (const part of parts.slice(1)) {
    product *= part;
    scale *= 1000n;
  }
  const half = scale / 2n;
  const result = (product + half) / scale;
  return result > 0n ? result : "The measured quantity rounds to 0.";
}

/**
 * Measurement book entries for one item cannot take the total past the work-order quantity.
 * Extra work needs an amended work order (variation), not a silent over-measurement.
 */
export function checkMeasurement(args: {
  description: string;
  orderedThousandths: bigint;
  measuredSoFarThousandths: bigint;
  quantityThousandths: bigint;
}): { code: "OVER_DEDUCTION" | "OVER_ORDER"; message: string } | null {
  const after = args.measuredSoFarThousandths + args.quantityThousandths;
  if (after < 0n)
    return {
      code: "OVER_DEDUCTION",
      message: `${args.description}: the deduction is more than what was measured.`,
    };
  if (after > args.orderedThousandths)
    return {
      code: "OVER_ORDER",
      message: `${args.description}: this takes the measured total past the work-order quantity. Amend the work order for extra work.`,
    };
  return null;
}

/** RA bill amounts. GST, retention and TDS are all worked on the value of work done. */
export function subBillTotals(args: {
  workValueMinor: bigint;
  gstBps: number;
  retentionBps: number;
  tdsBps: number;
  advanceRecoveryMinor: bigint;
  otherDeductionMinor: bigint;
}) {
  const gst = percentOf(args.workValueMinor, args.gstBps);
  const retention = percentOf(args.workValueMinor, args.retentionBps);
  const tds = percentOf(args.workValueMinor, args.tdsBps);
  const net =
    args.workValueMinor +
    gst -
    retention -
    tds -
    args.advanceRecoveryMinor -
    args.otherDeductionMinor;
  return {
    workValueMinor: args.workValueMinor,
    gstMinor: gst,
    retentionMinor: retention,
    tdsMinor: tds,
    advanceRecoveryMinor: args.advanceRecoveryMinor,
    otherDeductionMinor: args.otherDeductionMinor,
    netPayableMinor: net,
  };
}

/**
 * Advance to recover in this bill: the agreed share of the work value, never more than is
 * still outstanding, and on the last bill whatever is left can be taken in full.
 */
export function advanceRecovery(args: {
  advanceMinor: bigint;
  recoveredSoFarMinor: bigint;
  workValueMinor: bigint;
  recoveryBps: number;
}) {
  const outstanding = args.advanceMinor - args.recoveredSoFarMinor;
  if (outstanding <= 0n) return 0n;
  const share = percentOf(args.workValueMinor, args.recoveryBps);
  return share < outstanding ? share : outstanding;
}

/** Bill lines from checked measurements: quantity per item this bill, at the work-order rate. */
export function billLinesFrom(
  items: readonly { id: string; rateMinor: bigint }[],
  measurements: readonly { itemId: string; quantityThousandths: bigint }[],
) {
  const byItem = new Map<string, bigint>();
  for (const m of measurements)
    byItem.set(m.itemId, (byItem.get(m.itemId) ?? 0n) + m.quantityThousandths);
  const lines: {
    itemId: string;
    quantityThousandths: bigint;
    rateMinor: bigint;
    amountMinor: bigint;
  }[] = [];
  for (const item of items) {
    const quantity = byItem.get(item.id);
    if (!quantity) continue;
    lines.push({
      itemId: item.id,
      quantityThousandths: quantity,
      rateMinor: item.rateMinor,
      amountMinor: lineAmountMinor(quantity, item.rateMinor),
    });
  }
  return lines;
}

/** Work-order value and how much is done, billed and held back. */
export function workOrderPosition(args: {
  items: readonly { quantityThousandths: bigint; rateMinor: bigint; measuredThousandths: bigint }[];
  approvedBills: readonly {
    workValueMinor: bigint;
    retentionMinor: bigint;
    netPayableMinor: bigint;
  }[];
  retentionReleasedMinor: bigint;
}) {
  let value = 0n;
  let done = 0n;
  for (const item of args.items) {
    value += lineAmountMinor(item.quantityThousandths, item.rateMinor);
    done += lineAmountMinor(item.measuredThousandths, item.rateMinor);
  }
  const billed = args.approvedBills.reduce((sum, bill) => sum + bill.workValueMinor, 0n);
  const retention = args.approvedBills.reduce((sum, bill) => sum + bill.retentionMinor, 0n);
  const payable = args.approvedBills.reduce((sum, bill) => sum + bill.netPayableMinor, 0n);
  const progressBps = value > 0n ? Number((done * 10_000n) / value) : 0;
  return {
    valueMinor: value,
    measuredValueMinor: done,
    billedValueMinor: billed,
    netPayableMinor: payable,
    retentionHeldMinor: retention - args.retentionReleasedMinor,
    progressBps: Math.min(progressBps, 10_000),
  };
}
