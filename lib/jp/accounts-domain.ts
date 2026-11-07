/**
 * Accounts rules: statutory dues (PF, ESI, professional tax, TDS) against the deposits accounts
 * records, due dates, a monthly GST summary (output on client bills vs input on supplier bills)
 * and project profit and loss. Money is exact paise (BigInt). These are management figures for
 * the company's own books; returns (GSTR, ECR, 26Q) are still filed by the accountant.
 */

export const DUE_KINDS = ["PF", "ESI", "PT", "TDS salary", "TDS contractor"] as const;
export type DueKind = (typeof DUE_KINDS)[number];

export type AccountsError = { code: string; message: string };

function nextMonthDay(period: string, day: number) {
  const [y, m] = period.split("-").map(Number);
  const date = new Date(Date.UTC(y, m, day));
  return date.toISOString().slice(0, 10);
}

/**
 * Due date for a month's dues. PF (ECR) and ESI: 15th of the next month. TDS: 7th of the next
 * month, except March which is due on 30 April. Professional tax differs by state, so the end of
 * the next month is shown as a reminder only.
 */
export function dueDate(kind: DueKind, period: string): string {
  if (kind === "PF" || kind === "ESI") return nextMonthDay(period, 15);
  if (kind === "TDS salary" || kind === "TDS contractor")
    return period.endsWith("-03") ? `${period.slice(0, 4)}-04-30` : nextMonthDay(period, 7);
  const [y, m] = period.split("-").map(Number);
  return new Date(Date.UTC(y, m + 1, 0)).toISOString().slice(0, 10);
}

export type DueRow = { kind: DueKind; period: string; amountMinor: bigint };
export type DepositRow = { kind: DueKind; period: string; amountMinor: bigint };

export type DueLine = {
  kind: DueKind;
  period: string;
  dueMinor: bigint;
  depositedMinor: bigint;
  outstandingMinor: bigint;
  dueDate: string;
  state: "Paid" | "Due" | "Overdue" | "Excess";
};

/** Dues per kind and month, less deposits; newest month first, overdue items before others. */
export function duesAgainstDeposits(
  dues: readonly DueRow[],
  deposits: readonly DepositRow[],
  today: string,
): DueLine[] {
  const map = new Map<string, DueLine>();
  const get = (kind: DueKind, period: string) => {
    const key = `${kind}|${period}`;
    let line = map.get(key);
    if (!line) {
      line = {
        kind,
        period,
        dueMinor: 0n,
        depositedMinor: 0n,
        outstandingMinor: 0n,
        dueDate: dueDate(kind, period),
        state: "Paid",
      };
      map.set(key, line);
    }
    return line;
  };
  for (const due of dues) get(due.kind, due.period).dueMinor += due.amountMinor;
  for (const deposit of deposits)
    get(deposit.kind, deposit.period).depositedMinor += deposit.amountMinor;
  const lines = [...map.values()].filter((line) => line.dueMinor > 0n || line.depositedMinor > 0n);
  for (const line of lines) {
    line.outstandingMinor = line.dueMinor - line.depositedMinor;
    line.state =
      line.outstandingMinor < 0n
        ? "Excess"
        : line.outstandingMinor === 0n
          ? "Paid"
          : today > line.dueDate
            ? "Overdue"
            : "Due";
  }
  const rank = { Overdue: 0, Due: 1, Excess: 2, Paid: 3 } as const;
  return lines.sort(
    (a, b) =>
      rank[a.state] - rank[b.state] ||
      b.period.localeCompare(a.period) ||
      DUE_KINDS.indexOf(a.kind) - DUE_KINDS.indexOf(b.kind),
  );
}

/** A deposit must be positive, for a past or current month, and carry a challan reference. */
export function checkDeposit(args: {
  amountMinor: bigint;
  period: string;
  paidOn: string;
  challan: string;
  today: string;
}): AccountsError | null {
  if (args.amountMinor <= 0n) return { code: "AMOUNT", message: "Enter the amount deposited." };
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(args.period))
    return { code: "PERIOD", message: "Choose the month the deposit is for." };
  if (args.period > args.today.slice(0, 7))
    return { code: "PERIOD", message: "The month cannot be in the future." };
  if (args.paidOn > args.today)
    return { code: "DATE", message: "The paid date cannot be in the future." };
  if (args.paidOn < `${args.period}-01`)
    return { code: "DATE", message: "The paid date cannot be before the month it is for." };
  if (args.challan.trim().length < 3)
    return { code: "CHALLAN", message: "Enter the challan or TRRN number from the receipt." };
  return null;
}

export type GstMonth = {
  month: string;
  outputMinor: bigint;
  inputMinor: bigint;
  netMinor: bigint;
};

/**
 * GST per month: output tax on approved client bills, input tax on approved supplier bills
 * (including subcontract bills). Net = output − input; a negative net is credit carried forward.
 * Input credit actually allowed depends on GSTR-2B, so this is an estimate for planning.
 */
export function gstSummary(
  output: readonly { date: string; taxMinor: bigint }[],
  input: readonly { date: string; taxMinor: bigint }[],
): GstMonth[] {
  const map = new Map<string, GstMonth>();
  const get = (date: string) => {
    const month = date.slice(0, 7);
    let row = map.get(month);
    if (!row) {
      row = { month, outputMinor: 0n, inputMinor: 0n, netMinor: 0n };
      map.set(month, row);
    }
    return row;
  };
  for (const row of output) get(row.date).outputMinor += row.taxMinor;
  for (const row of input) get(row.date).inputMinor += row.taxMinor;
  const months = [...map.values()].sort((a, b) => b.month.localeCompare(a.month));
  for (const month of months) month.netMinor = month.outputMinor - month.inputMinor;
  return months;
}

export const COST_HEADS = [
  "Material",
  "Subcontract",
  "Labour",
  "Staff",
  "Petty cash",
  "Other",
] as const;
export type CostHead = (typeof COST_HEADS)[number];

export type ProjectPnl = {
  revenueMinor: bigint;
  costs: Record<CostHead, bigint>;
  totalCostMinor: bigint;
  profitMinor: bigint;
  /** Profit as basis points of revenue, or null with no revenue. */
  marginBps: number | null;
};

/**
 * Project profit: billed work value (before GST) less cost before GST. Supplier bills count at
 * their taxable value because GST paid is input credit. Labour counts approved payroll; attendance
 * not yet in a payroll run is reported separately, never mixed in.
 */
export function projectPnl(
  revenueMinor: bigint,
  costs: Partial<Record<CostHead, bigint>>,
): ProjectPnl {
  const full = Object.fromEntries(COST_HEADS.map((head) => [head, costs[head] ?? 0n])) as Record<
    CostHead,
    bigint
  >;
  const totalCostMinor = COST_HEADS.reduce((sum, head) => sum + full[head], 0n);
  const profitMinor = revenueMinor - totalCostMinor;
  const marginBps = revenueMinor > 0n ? Number((profitMinor * 10_000n) / revenueMinor) : null;
  return { revenueMinor, costs: full, totalCostMinor, profitMinor, marginBps };
}

/** Supplier type → cost head for P&L. */
export function costHeadForSupplier(vendorType: string | null | undefined): CostHead {
  if (vendorType === "Subcontractor") return "Subcontract";
  if (vendorType === "Material Supplier") return "Material";
  return "Other";
}
