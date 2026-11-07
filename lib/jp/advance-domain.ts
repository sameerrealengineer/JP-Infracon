/**
 * Worker advance ledger and the worker's money position ("how much was paid, how much is
 * still due"). Money is exact paise (BigInt). An advance is counted once: given when approved,
 * recovered through pay-run deductions (approved or paid runs) or a cash repayment.
 */

export type AdvanceError = { code: string; message: string };

export const ADVANCE_ENTRY_TYPES = ["Advance", "Repayment"] as const;
export type AdvanceEntryType = (typeof ADVANCE_ENTRY_TYPES)[number];

export type LedgerEntry = {
  entryType: AdvanceEntryType;
  status: string;
  amountMinor: bigint;
  installmentMinor: bigint;
  entryDate: string;
};

export type RunDeduction = {
  runId: string;
  status: string;
  advanceMinor: bigint;
};

/**
 * Advance position for one person on one site.
 * - given: approved advances
 * - repaid: approved cash repayments
 * - recovered: deductions in approved or paid pay runs
 * - pending: deductions in draft or submitted pay runs (not recovered yet, but already planned)
 * - outstanding: given − repaid − recovered
 */
export function advancePosition(
  entries: readonly LedgerEntry[],
  deductions: readonly RunDeduction[],
) {
  let given = 0n;
  let repaid = 0n;
  for (const entry of entries) {
    if (entry.status !== "Approved") continue;
    if (entry.entryType === "Advance") given += entry.amountMinor;
    else repaid += entry.amountMinor;
  }
  let recovered = 0n;
  let pending = 0n;
  for (const row of deductions) {
    if (row.status === "Approved" || row.status === "Paid") recovered += row.advanceMinor;
    else if (row.status === "Draft" || row.status === "Submitted" || row.status === "Returned")
      pending += row.advanceMinor;
  }
  const outstanding = given - repaid - recovered;
  return { given, repaid, recovered, pending, outstanding };
}

/**
 * What a pay run may still deduct for the person: outstanding less what other open runs already
 * plan to deduct. Never negative.
 */
export function recoverableNow(
  entries: readonly LedgerEntry[],
  deductions: readonly RunDeduction[],
  currentRunId: string | null,
) {
  const others = deductions.filter((row) => row.runId !== currentRunId);
  const position = advancePosition(entries, others);
  const left = position.outstanding - position.pending;
  return left > 0n ? left : 0n;
}

/**
 * The deduction a new pay run proposes: the installment of the latest approved advance (or the
 * whole amount when no installment was set), capped at what is still recoverable.
 */
export function suggestedDeduction(entries: readonly LedgerEntry[], recoverable: bigint) {
  if (recoverable <= 0n) return 0n;
  const advances = entries
    .filter((entry) => entry.entryType === "Advance" && entry.status === "Approved")
    .sort((a, b) => b.entryDate.localeCompare(a.entryDate));
  const installment = advances[0]?.installmentMinor ?? 0n;
  if (installment <= 0n) return recoverable;
  return installment < recoverable ? installment : recoverable;
}

export function checkAdvanceEntry(args: {
  entryType: AdvanceEntryType;
  amountMinor: bigint;
  installmentMinor: bigint;
  entryDate: string;
  today: string;
  reason: string;
  outstandingMinor: bigint;
}): AdvanceError | null {
  if (args.amountMinor <= 0n) return { code: "AMOUNT", message: "Enter the amount." };
  if (args.entryDate > args.today)
    return { code: "DATE", message: "The date cannot be in the future." };
  if (args.reason.trim().length < 3)
    return { code: "REASON", message: "Say what the money is for." };
  if (args.entryType === "Advance") {
    if (args.installmentMinor < 0n)
      return { code: "INSTALLMENT", message: "The monthly recovery cannot be negative." };
    if (args.installmentMinor > args.amountMinor)
      return {
        code: "INSTALLMENT",
        message: "The monthly recovery cannot be more than the advance.",
      };
  } else if (args.amountMinor > args.outstandingMinor) {
    return {
      code: "OVER_REPAYMENT",
      message: "The repayment is more than the advance still to recover.",
    };
  }
  return null;
}

export type PayRunShare = {
  status: string;
  grossMinor: bigint;
  netMinor: bigint;
  month: string;
  paidOn: string | null;
};

/**
 * The person's money position on a site: wages earned and paid through pay runs, wages approved
 * but not yet paid, attendance not yet in any pay run (an estimate), and the advance balance.
 */
export function workerPosition(args: {
  runs: readonly PayRunShare[];
  unpaidAttendanceMinor: bigint;
  entries: readonly LedgerEntry[];
  deductions: readonly RunDeduction[];
}) {
  let earnedNet = 0n;
  let paid = 0n;
  let approvedUnpaid = 0n;
  let lastPaidOn: string | null = null;
  for (const run of args.runs) {
    if (run.status !== "Approved" && run.status !== "Paid") continue;
    earnedNet += run.netMinor;
    if (run.status === "Paid") {
      paid += run.netMinor;
      if (run.paidOn && (!lastPaidOn || run.paidOn > lastPaidOn)) lastPaidOn = run.paidOn;
    } else approvedUnpaid += run.netMinor;
  }
  const advance = advancePosition(args.entries, args.deductions);
  return {
    earnedNetMinor: earnedNet,
    paidMinor: paid,
    approvedUnpaidMinor: approvedUnpaid,
    notInPayRunMinor: args.unpaidAttendanceMinor,
    /** Wages still to pay: approved runs not paid plus attendance not yet in a run. */
    dueMinor: approvedUnpaid + args.unpaidAttendanceMinor,
    advanceGivenMinor: advance.given,
    advanceRecoveredMinor: advance.recovered + advance.repaid,
    advanceOutstandingMinor: advance.outstanding,
    lastPaidOn,
  };
}
