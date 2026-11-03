import { normalizeMinorAmount } from "./finance-domain";

/** Cost heads a project budget is split into. Actual spend is mapped onto the same heads. */
export const COST_HEADS = [
  "Materials",
  "Labour",
  "Subcontract",
  "Equipment and transport",
  "Site expenses",
  "Other",
] as const;
export type CostHead = (typeof COST_HEADS)[number];

export const BUDGET_STATUSES = ["Proposed", "Approved", "Rejected", "Superseded"] as const;
export type BudgetStatus = (typeof BUDGET_STATUSES)[number];

/** Share of a head's budget (in tenths of a percent) at which it is shown as "near the limit". */
export const NEAR_LIMIT_TENTHS = 900n;

export type VendorType =
  | "Material Supplier"
  | "Transporter"
  | "Subcontractor"
  | "Service Provider"
  | "Other";

/** Which cost head a supplier bill counts against, from the supplier's type. */
export function costHeadForVendor(vendorType: VendorType): CostHead {
  switch (vendorType) {
    case "Material Supplier":
      return "Materials";
    case "Subcontractor":
      return "Subcontract";
    case "Transporter":
      return "Equipment and transport";
    default:
      return "Other";
  }
}

export type BudgetLineInput = { costHead: CostHead; amountMinor: string; note?: string | null };
export type BudgetError = { code: "BUDGET_INVALID"; message: string };

/**
 * Checks a proposed budget: at least one head, each head once, exact positive paise.
 * Returns the cleaned lines and their total, or an error.
 */
export function validateBudgetLines(
  lines: readonly BudgetLineInput[],
): { lines: BudgetLineInput[]; totalMinor: string } | BudgetError {
  if (lines.length === 0)
    return { code: "BUDGET_INVALID", message: "Enter an amount for at least one cost head." };
  const seen = new Set<CostHead>();
  const cleaned: BudgetLineInput[] = [];
  let total = 0n;
  for (const line of lines) {
    if (!COST_HEADS.includes(line.costHead))
      return { code: "BUDGET_INVALID", message: "Unknown cost head." };
    if (seen.has(line.costHead))
      return { code: "BUDGET_INVALID", message: `${line.costHead} is entered twice.` };
    seen.add(line.costHead);
    let amount: string;
    try {
      amount = normalizeMinorAmount(line.amountMinor);
    } catch {
      return {
        code: "BUDGET_INVALID",
        message: `Enter a positive amount for ${line.costHead}.`,
      };
    }
    total += BigInt(amount);
    const note = line.note?.trim() || null;
    cleaned.push({ costHead: line.costHead, amountMinor: amount, note });
  }
  cleaned.sort((a, b) => COST_HEADS.indexOf(a.costHead) - COST_HEADS.indexOf(b.costHead));
  return { lines: cleaned, totalMinor: total.toString() };
}

export type HeadSpend = { actualMinor: bigint; pendingMinor: bigint };
export type HeadState = "ok" | "near" | "over" | "unbudgeted" | "none";

export type HeadComparison = {
  costHead: CostHead;
  budgetMinor: string;
  actualMinor: string;
  pendingMinor: string;
  /** Budget minus approved actual spend. Negative when over budget. */
  remainingMinor: string;
  /** Approved spend as a share of the budget, in tenths of a percent; null without a budget. */
  usedTenths: number | null;
  state: HeadState;
};

function shareTenths(part: bigint, whole: bigint): number | null {
  if (whole <= 0n) return null;
  return Number((part * 1000n + whole / 2n) / whole);
}

function stateFor(budget: bigint, actual: bigint): HeadState {
  if (budget === 0n) return actual > 0n ? "unbudgeted" : "none";
  if (actual > budget) return "over";
  if (actual * 1000n >= budget * NEAR_LIMIT_TENTHS) return "near";
  return "ok";
}

/**
 * Budget against approved spend, head by head, plus totals. Spend awaiting approval is shown
 * separately and never counted as actual.
 */
export function compareBudget(
  lines: readonly { costHead: CostHead; amountMinor: string }[],
  spend: Partial<Record<CostHead, HeadSpend>>,
) {
  const budgetByHead = new Map(lines.map((line) => [line.costHead, BigInt(line.amountMinor)]));
  const heads: HeadComparison[] = COST_HEADS.map((costHead) => {
    const budget = budgetByHead.get(costHead) ?? 0n;
    const actual = spend[costHead]?.actualMinor ?? 0n;
    const pending = spend[costHead]?.pendingMinor ?? 0n;
    return {
      costHead,
      budgetMinor: budget.toString(),
      actualMinor: actual.toString(),
      pendingMinor: pending.toString(),
      remainingMinor: (budget - actual).toString(),
      usedTenths: shareTenths(actual, budget),
      state: stateFor(budget, actual),
    };
  });
  const sum = (pick: (row: HeadComparison) => string) =>
    heads.reduce((acc, row) => acc + BigInt(pick(row)), 0n);
  const budget = sum((row) => row.budgetMinor);
  const actual = sum((row) => row.actualMinor);
  return {
    heads,
    totals: {
      budgetMinor: budget.toString(),
      actualMinor: actual.toString(),
      pendingMinor: sum((row) => row.pendingMinor).toString(),
      remainingMinor: (budget - actual).toString(),
      usedTenths: shareTenths(actual, budget),
      state: stateFor(budget, actual),
    },
  };
}

/** Contract value minus an amount (budget or spend); null when no contract value is recorded. */
export function marginMinor(contractValueMinor: string | null, amountMinor: string) {
  if (contractValueMinor === null) return null;
  return (BigInt(contractValueMinor) - BigInt(amountMinor)).toString();
}

/** "12.5%" from tenths of a percent. */
export function formatTenths(tenths: number | null): string {
  if (tenths === null) return "—";
  const whole = Math.trunc(tenths / 10);
  const fraction = Math.abs(tenths % 10);
  return fraction === 0 ? `${whole}%` : `${whole}.${fraction}%`;
}
