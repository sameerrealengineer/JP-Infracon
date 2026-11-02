/** What an administrator can hand over to a named person, and for how long. */

export const delegationBundles = {
  site_operations: {
    label: "Site operations",
    detail:
      "Reports, material, schedule, stock, attendance, issues, workforce — including approvals",
    keys: [
      "dpr.view",
      "dpr.create",
      "dpr.submit",
      "dpr.review",
      "dlr.view",
      "dlr.create",
      "dlr.submit",
      "dlr.review",
      "material.request.view",
      "material.request",
      "material.review",
      "task.view",
      "task.manage",
      "task.status.update",
      "inventory.view",
      "inventory.transact",
      "inventory.review",
      "attendance.view",
      "attendance.mark",
      "attendance.approve",
      "issue.view",
      "issue.create",
      "issue.manage",
      "issue.close",
      "workforce.view",
      "workforce.manage",
      "workforce.review",
    ],
  },
  finance: {
    label: "Bills & payments",
    detail: "Supplier invoices, payment approval and posting, petty cash",
    keys: [
      "vendor.view",
      "finance.invoice.view",
      "finance.invoice.create",
      "finance.invoice.submit",
      "finance.invoice.review",
      "finance.payment.view",
      "finance.payment.create",
      "finance.payment.submit",
      "finance.payment.review",
      "finance.payment.post",
      "finance.cash.view",
      "finance.cash.movement.create",
      "finance.cash.movement.submit",
      "finance.cash.movement.review",
      "finance.cash.movement.post",
    ],
  },
  self_approval: {
    label: "Approve own work",
    detail: "Skip the second-person check on items they raised themselves",
    keys: ["approval.self"],
  },
} as const;

export type DelegationBundle = keyof typeof delegationBundles;
export const delegationBundleIds = Object.keys(delegationBundles) as DelegationBundle[];

export const delegationDurations = {
  "1h": { label: "1 hour", hours: 1 },
  "4h": { label: "4 hours", hours: 4 },
  "1d": { label: "1 day", hours: 24 },
  "2d": { label: "2 days", hours: 48 },
  "1w": { label: "1 week", hours: 24 * 7 },
  "1m": { label: "1 month", hours: 24 * 30 },
  project: { label: "Until revoked", hours: null },
} as const;
export type DelegationDuration = keyof typeof delegationDurations;

export function delegationKeys(bundles: readonly DelegationBundle[]): string[] {
  return [...new Set(bundles.flatMap((bundle) => [...delegationBundles[bundle].keys]))];
}

export function delegationEnd(duration: DelegationDuration, from: Date): Date | null {
  const hours = delegationDurations[duration].hours;
  return hours === null ? null : new Date(from.getTime() + hours * 3_600_000);
}

export type DelegationState = "Scheduled" | "Active" | "Expired" | "Revoked";

export function delegationState(
  row: {
    status: "Active" | "Revoked";
    effectiveFrom: Date | string;
    effectiveTo: Date | string | null;
  },
  now = new Date(),
): DelegationState {
  if (row.status === "Revoked") return "Revoked";
  if (new Date(row.effectiveFrom) > now) return "Scheduled";
  if (row.effectiveTo && new Date(row.effectiveTo) < now) return "Expired";
  return "Active";
}

/** "2 days 3 hours left" style text for the remaining time. */
export function timeLeft(effectiveTo: Date | string | null, now = new Date()): string {
  if (!effectiveTo) return "until revoked";
  const ms = new Date(effectiveTo).getTime() - now.getTime();
  if (ms <= 0) return "ended";
  const hours = Math.floor(ms / 3_600_000);
  const days = Math.floor(hours / 24);
  if (days > 0)
    return `${days} day${days === 1 ? "" : "s"}${hours % 24 ? ` ${hours % 24} h` : ""} left`;
  if (hours > 0) return `${hours} h ${Math.floor((ms % 3_600_000) / 60_000)} min left`;
  return `${Math.max(1, Math.floor(ms / 60_000))} min left`;
}
