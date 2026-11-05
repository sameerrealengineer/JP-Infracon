import { estimateEarning, type AttendanceStatus, type RateType } from "./attendance-domain";
import { percentOf } from "./billing-domain";

/**
 * Payroll rules: monthly wage sheet per site from approved attendance (daily workers) and
 * salary structures (monthly staff), with PF, ESI and professional tax. Money is exact paise
 * (BigInt), days are hundredths, percentages basis points.
 *
 * Statutory rates change by notification, so they are company settings with an effective date,
 * never constants in code. DEFAULT_RATES is only the starting point offered to a company:
 * - EPF wage ceiling ₹25,000 a month from 17 Sep 2026 (S.O. 5109(E), Code on Social Security
 *   Chapter III); 12% employee, 12% employer of which 8.33% goes to EPS.
 * - ESI applies up to ₹21,000 gross a month; 0.75% employee, 3.25% employer, rounded up to the
 *   next rupee.
 * - Odisha professional tax was repealed from 1 Apr 2026, so no slabs by default. Companies in
 *   other states add their state's slabs.
 * - Code on Wages: when allowances are more than half of pay, the excess counts as wages for PF;
 *   overtime is paid at twice the ordinary rate.
 * A chartered accountant should confirm the settings before the first real pay run.
 */

export type PtSlab = { uptoMinor: bigint | null; taxMinor: bigint };

export type PayrollRates = {
  effectiveFrom: string;
  pfWageCeilingMinor: bigint;
  pfEmployeeBps: number;
  pfEmployerBps: number;
  epsBps: number;
  epsCeilingMinor: bigint;
  edliBps: number;
  pfAdminBps: number;
  esiThresholdMinor: bigint;
  esiEmployeeBps: number;
  esiEmployerBps: number;
  overtimeMultiplierBps: number;
  wageShareBps: number;
  ptSlabs: PtSlab[];
};

export const DEFAULT_RATES: PayrollRates = {
  effectiveFrom: "2026-09-17",
  pfWageCeilingMinor: 2_500_000n,
  pfEmployeeBps: 1200,
  pfEmployerBps: 1200,
  epsBps: 833,
  epsCeilingMinor: 2_500_000n,
  edliBps: 50,
  pfAdminBps: 50,
  esiThresholdMinor: 2_100_000n,
  esiEmployeeBps: 75,
  esiEmployerBps: 325,
  overtimeMultiplierBps: 20_000,
  wageShareBps: 5000,
  ptSlabs: [],
};

export type PayrollError = { code: string; message: string };

export const RUN_STATUSES = [
  "Draft",
  "Submitted",
  "Approved",
  "Paid",
  "Returned",
  "Cancelled",
] as const;
export type RunStatus = (typeof RUN_STATUSES)[number];

/** maker: the action belongs to whoever prepares the run; false means a different person. */
export const RUN_TRANSITIONS = {
  submit: { from: ["Draft", "Returned"], to: "Submitted", maker: true },
  approve: { from: ["Submitted"], to: "Approved", maker: false },
  return: { from: ["Submitted"], to: "Returned", maker: false },
  cancel: { from: ["Draft", "Returned", "Submitted"], to: "Cancelled", maker: true },
  pay: { from: ["Approved"], to: "Paid", maker: true },
} as const;
export type RunAction = keyof typeof RUN_TRANSITIONS;

export const PROFILE_TRANSITIONS = {
  approve: { from: ["Pending"], to: "Active" },
  reject: { from: ["Pending"], to: "Rejected" },
} as const;

/** "2026-10" → number of days and the first/last date. */
export function monthBounds(month: string): { first: string; last: string; days: number } | null {
  const match = /^(\d{4})-(\d{2})$/.exec(month);
  if (!match) return null;
  const year = Number(match[1]);
  const m = Number(match[2]);
  if (m < 1 || m > 12 || year < 2000 || year > 2100) return null;
  const days = new Date(Date.UTC(year, m, 0)).getUTCDate();
  return { first: `${month}-01`, last: `${month}-${String(days).padStart(2, "0")}`, days };
}

/** The month before today's month, the usual one to pay. */
export function previousMonth(today: string) {
  const [y, m] = today.split("-").map(Number);
  const date = new Date(Date.UTC(y, m - 2, 1));
  return date.toISOString().slice(0, 7);
}

function divRound(a: bigint, b: bigint) {
  return (a * 2n + b) / (b * 2n);
}
/** EPFO works in whole rupees: round to the nearest rupee. */
export function roundRupee(minor: bigint) {
  return divRound(minor, 100n) * 100n;
}
/** ESIC rounds contributions up to the next rupee. */
export function ceilRupee(minor: bigint) {
  return ((minor + 99n) / 100n) * 100n;
}

/** "1.5" days → 150 hundredths. Up to 31 days, two decimals. */
export function parseDays(value: string): bigint | null {
  const text = value.trim();
  if (!/^\d{1,2}(\.\d{1,2})?$/.test(text)) return null;
  const [whole, fraction = ""] = text.split(".");
  const days = BigInt(whole) * 100n + BigInt(fraction.padEnd(2, "0"));
  return days <= 3100n ? days : null;
}

export function formatDays(hundredths: bigint) {
  const whole = hundredths / 100n;
  const fraction = hundredths % 100n;
  if (fraction === 0n) return `${whole}`;
  return `${whole}.${String(fraction).padStart(2, "0").replace(/0$/, "")}`;
}

export type AttendanceRow = {
  status: AttendanceStatus;
  rateType: RateType | null;
  rateMinor: number | null;
  regularHundredths: bigint;
  overtimeHundredths: bigint;
  overtimeApproved: boolean;
};

/**
 * Wages for a daily or hourly worker from approved attendance: base pay per day (full, half, or
 * hours on an 8 hour day) plus approved overtime at the multiplier (2× under the Code on Wages).
 */
export function attendanceWages(rows: readonly AttendanceRow[], overtimeMultiplierBps: number) {
  let daysHundredths = 0n;
  let basicMinor = 0n;
  let overtimeMinor = 0n;
  let overtimeHundredths = 0n;
  let missingRate = 0;
  let notAttendanceBased = 0;
  for (const row of rows) {
    const base = estimateEarning({ ...row, overtimeApproved: false });
    if (base.kind === "missing_rate") {
      missingRate += 1;
      continue;
    }
    if (base.kind === "not_attendance_based") {
      notAttendanceBased += 1;
      continue;
    }
    if (row.status === "Full Day") daysHundredths += 100n;
    else if (row.status === "Half Day") daysHundredths += 50n;
    else if (row.status === "Present-hours-based")
      daysHundredths += divRound(row.regularHundredths * 100n, 800n);
    basicMinor += base.minor;
    if (row.overtimeApproved && row.overtimeHundredths > 0n) {
      const plainOt = estimateEarning({ ...row, overtimeApproved: true });
      if (plainOt.kind === "amount") {
        overtimeMinor += percentOf(plainOt.overtimeMinor, overtimeMultiplierBps);
        overtimeHundredths += row.overtimeHundredths;
      }
    }
  }
  return {
    daysHundredths,
    basicMinor,
    overtimeMinor,
    overtimeHundredths,
    missingRate,
    notAttendanceBased,
  };
}

/** Monthly pay for the days paid: amount × paid days ÷ days in month. */
export function prorate(amountMinor: bigint, paidDaysHundredths: bigint, daysInMonth: number) {
  if (paidDaysHundredths >= BigInt(daysInMonth) * 100n) return amountMinor;
  return divRound(amountMinor * paidDaysHundredths, BigInt(daysInMonth) * 100n);
}

/**
 * Wages for PF under the Code on Wages: basic + DA, plus whatever part of the allowances goes
 * beyond the permitted share of total pay (50%). Overtime is not counted here.
 */
export function statutoryWage(basicMinor: bigint, allowancesMinor: bigint, wageShareBps: number) {
  const total = basicMinor + allowancesMinor;
  const allowedAllowances = total - percentOf(total, wageShareBps);
  const excess = allowancesMinor - allowedAllowances;
  return basicMinor + (excess > 0n ? excess : 0n);
}

export function pfContribution(pfWageMinor: bigint, rates: PayrollRates) {
  const pfWage = pfWageMinor < rates.pfWageCeilingMinor ? pfWageMinor : rates.pfWageCeilingMinor;
  const epsWage = pfWageMinor < rates.epsCeilingMinor ? pfWageMinor : rates.epsCeilingMinor;
  const employee = roundRupee(percentOf(pfWage, rates.pfEmployeeBps));
  const employerTotal = roundRupee(percentOf(pfWage, rates.pfEmployerBps));
  let eps = roundRupee(percentOf(epsWage, rates.epsBps));
  if (eps > employerTotal) eps = employerTotal;
  return {
    pfWageMinor: pfWage,
    employeeMinor: employee,
    employerEpfMinor: employerTotal - eps,
    employerEpsMinor: eps,
    edliAdminMinor: roundRupee(percentOf(pfWage, rates.edliBps + rates.pfAdminBps)),
  };
}

/**
 * ESI on gross pay (overtime included) when the month's wages without overtime are within the
 * threshold. ESIC fixes coverage for a six-month contribution period; this uses the month's
 * pay, so a person who crosses the threshold mid-period needs a manual check (a warning shows).
 */
export function esiContribution(
  grossMinor: bigint,
  eligibilityWageMinor: bigint,
  rates: PayrollRates,
) {
  if (eligibilityWageMinor > rates.esiThresholdMinor || grossMinor <= 0n)
    return { applies: false, employeeMinor: 0n, employerMinor: 0n };
  return {
    applies: true,
    employeeMinor: ceilRupee(percentOf(grossMinor, rates.esiEmployeeBps)),
    employerMinor: ceilRupee(percentOf(grossMinor, rates.esiEmployerBps)),
  };
}

/** Monthly professional tax from the slabs (first slab whose limit covers the gross). */
export function professionalTax(grossMinor: bigint, slabs: readonly PtSlab[]) {
  for (const slab of slabs)
    if (slab.uptoMinor === null || grossMinor <= slab.uptoMinor) return slab.taxMinor;
  return 0n;
}

/** Slabs are written one per line: "13304: 0", "25000: 125", "above: 200". */
export function parsePtSlabs(text: string): PtSlab[] | string {
  const slabs: PtSlab[] = [];
  const lines = text
    .split(/\n|;/)
    .map((line) => line.trim())
    .filter(Boolean);
  let previous = -1n;
  for (const line of lines) {
    const match = /^(above|\d+(?:\.\d{1,2})?)\s*[:=]\s*(\d+(?:\.\d{1,2})?)$/i.exec(line);
    if (!match) return `"${line}": write it like "25000: 125" or "above: 200".`;
    const toMinor = (value: string) => {
      const [whole, fraction = ""] = value.split(".");
      return BigInt(whole) * 100n + BigInt(fraction.padEnd(2, "0"));
    };
    const upto = match[1].toLowerCase() === "above" ? null : toMinor(match[1]);
    if (slabs.length && slabs[slabs.length - 1].uptoMinor === null)
      return `"above" must be the last line.`;
    if (upto !== null && upto <= previous) return "Slab limits must go up line by line.";
    if (upto !== null) previous = upto;
    slabs.push({ uptoMinor: upto, taxMinor: toMinor(match[2]) });
  }
  return slabs;
}

export function formatPtSlabs(slabs: readonly PtSlab[]) {
  const rupees = (minor: bigint) =>
    minor % 100n === 0n
      ? `${minor / 100n}`
      : `${minor / 100n}.${String(minor % 100n).padStart(2, "0")}`;
  return slabs
    .map(
      (slab) =>
        `${slab.uptoMinor === null ? "above" : rupees(slab.uptoMinor)}: ${rupees(slab.taxMinor)}`,
    )
    .join("\n");
}

export type LineInput = {
  payType: "Daily" | "Monthly";
  /** Basic + DA earned this month (already prorated or from attendance). */
  basicMinor: bigint;
  hraMinor: bigint;
  otherAllowanceMinor: bigint;
  overtimeMinor: bigint;
  pfMember: boolean;
  esiMember: boolean;
  ptApplies: boolean;
  tdsMinor: bigint;
  advanceMinor: bigint;
  otherDeductionMinor: bigint;
};

export type LineResult = {
  grossMinor: bigint;
  pfWageMinor: bigint;
  pfEmployeeMinor: bigint;
  esiEmployeeMinor: bigint;
  ptMinor: bigint;
  tdsMinor: bigint;
  advanceMinor: bigint;
  otherDeductionMinor: bigint;
  totalDeductionMinor: bigint;
  netMinor: bigint;
  employerEpfMinor: bigint;
  employerEpsMinor: bigint;
  edliAdminMinor: bigint;
  esiEmployerMinor: bigint;
  /** Gross plus employer PF, EDLI/admin and ESI: what the person costs the company. */
  costMinor: bigint;
  esiApplies: boolean;
};

export function payrollLine(input: LineInput, rates: PayrollRates): LineResult | PayrollError {
  for (const [label, value] of [
    ["Basic", input.basicMinor],
    ["HRA", input.hraMinor],
    ["Other allowance", input.otherAllowanceMinor],
    ["Overtime", input.overtimeMinor],
    ["TDS", input.tdsMinor],
    ["Advance", input.advanceMinor],
    ["Other deduction", input.otherDeductionMinor],
  ] as const)
    if (value < 0n) return { code: "NEGATIVE", message: `${label} cannot be negative.` };
  const allowances = input.hraMinor + input.otherAllowanceMinor;
  const withoutOvertime = input.basicMinor + allowances;
  const grossMinor = withoutOvertime + input.overtimeMinor;
  const wage = statutoryWage(input.basicMinor, allowances, rates.wageShareBps);
  const pf = input.pfMember
    ? pfContribution(wage, rates)
    : {
        pfWageMinor: 0n,
        employeeMinor: 0n,
        employerEpfMinor: 0n,
        employerEpsMinor: 0n,
        edliAdminMinor: 0n,
      };
  const esi = input.esiMember
    ? esiContribution(grossMinor, withoutOvertime, rates)
    : { applies: false, employeeMinor: 0n, employerMinor: 0n };
  const ptMinor = input.ptApplies ? professionalTax(grossMinor, rates.ptSlabs) : 0n;
  const totalDeductionMinor =
    pf.employeeMinor +
    esi.employeeMinor +
    ptMinor +
    input.tdsMinor +
    input.advanceMinor +
    input.otherDeductionMinor;
  const netMinor = grossMinor - totalDeductionMinor;
  if (netMinor < 0n)
    return {
      code: "DEDUCTIONS_EXCEED_PAY",
      message:
        "Deductions are more than the pay for this month. Lower the advance or other deduction.",
    };
  return {
    grossMinor,
    pfWageMinor: pf.pfWageMinor,
    pfEmployeeMinor: pf.employeeMinor,
    esiEmployeeMinor: esi.employeeMinor,
    ptMinor,
    tdsMinor: input.tdsMinor,
    advanceMinor: input.advanceMinor,
    otherDeductionMinor: input.otherDeductionMinor,
    totalDeductionMinor,
    netMinor,
    employerEpfMinor: pf.employerEpfMinor,
    employerEpsMinor: pf.employerEpsMinor,
    edliAdminMinor: pf.edliAdminMinor,
    esiEmployerMinor: esi.employerMinor,
    costMinor:
      grossMinor +
      pf.employerEpfMinor +
      pf.employerEpsMinor +
      pf.edliAdminMinor +
      esi.employerMinor,
    esiApplies: esi.applies,
  };
}

const TOTAL_KEYS = [
  "grossMinor",
  "pfEmployeeMinor",
  "esiEmployeeMinor",
  "ptMinor",
  "tdsMinor",
  "advanceMinor",
  "otherDeductionMinor",
  "totalDeductionMinor",
  "netMinor",
  "employerEpfMinor",
  "employerEpsMinor",
  "edliAdminMinor",
  "esiEmployerMinor",
  "costMinor",
] as const;
export type RunTotals = Record<(typeof TOTAL_KEYS)[number], bigint>;

export function runTotals(lines: readonly Partial<Record<keyof RunTotals, bigint>>[]): RunTotals {
  const totals = Object.fromEntries(TOTAL_KEYS.map((key) => [key, 0n])) as RunTotals;
  for (const line of lines) for (const key of TOTAL_KEYS) totals[key] += line[key] ?? 0n;
  return totals;
}

/** What the run owes the PF and ESI offices for the month. */
export function statutoryDues(totals: RunTotals) {
  return {
    pfMinor:
      totals.pfEmployeeMinor +
      totals.employerEpfMinor +
      totals.employerEpsMinor +
      totals.edliAdminMinor,
    esiMinor: totals.esiEmployeeMinor + totals.esiEmployerMinor,
    ptMinor: totals.ptMinor,
    tdsMinor: totals.tdsMinor,
  };
}

/** UAN is 12 digits; ESI IP number is 10 digits. Empty is allowed. */
export function checkIdentifiers(uan: string, esiNumber: string): PayrollError | null {
  if (uan.trim() && !/^\d{12}$/.test(uan.trim()))
    return { code: "BAD_UAN", message: "UAN must be 12 digits." };
  if (esiNumber.trim() && !/^\d{10}$/.test(esiNumber.trim()))
    return { code: "BAD_ESI", message: "ESI IP number must be 10 digits." };
  return null;
}
