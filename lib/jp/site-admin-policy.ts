/** Pure rules for project/site administration, shared by the API and the app. */

export const siteStatuses = ["Active", "On Hold", "Completed", "Inactive"] as const;
export type SiteLifecycleStatus = (typeof siteStatuses)[number];

/** Roles that are granted per site. Owner/Director/Admin already see every site in the organisation. */
export const siteAssignableRoles = [
  "project_manager",
  "supervisor",
  "accounts",
  "storekeeper",
  "auditor",
] as const;
export type SiteAssignableRole = (typeof siteAssignableRoles)[number];

export const organizationWideRoles = ["owner", "director", "admin"] as const;

export type PolicyError = { code: "BAD_REQUEST" | "CONFLICT" | "FORBIDDEN"; message: string };

const allowedTransitions: Record<SiteLifecycleStatus, readonly SiteLifecycleStatus[]> = {
  Active: ["On Hold", "Completed", "Inactive"],
  "On Hold": ["Active", "Completed", "Inactive"],
  Completed: ["Active", "Inactive"],
  Inactive: ["Active"],
};

/** Every status change needs a reason so the audit trail explains it. */
export function validateStatusChange(
  from: SiteLifecycleStatus,
  to: SiteLifecycleStatus,
  reason: string | null | undefined,
): PolicyError | null {
  if (from === to) return { code: "CONFLICT", message: `The record is already ${to}.` };
  if (!allowedTransitions[from].includes(to))
    return { code: "BAD_REQUEST", message: `A ${from} record cannot move to ${to}.` };
  if (!reason || reason.trim().length < 3)
    return { code: "BAD_REQUEST", message: "Enter a reason for this status change." };
  return null;
}

export function nextStatusOptions(from: SiteLifecycleStatus): readonly SiteLifecycleStatus[] {
  return allowedTransitions[from];
}

/** A person can hold a site role only when their organisation role is not already organisation-wide. */
export function validateSiteAssignment(args: {
  memberRoles: readonly string[];
  memberActive: boolean;
  role: string;
  alreadyAssigned: boolean;
}): PolicyError | null {
  if (!args.memberActive)
    return { code: "BAD_REQUEST", message: "Only active organisation members can be assigned." };
  if (!(siteAssignableRoles as readonly string[]).includes(args.role))
    return { code: "BAD_REQUEST", message: "Choose a site role." };
  if (args.memberRoles.some((role) => (organizationWideRoles as readonly string[]).includes(role)))
    return {
      code: "CONFLICT",
      message: "This person already has organisation-wide access to every site.",
    };
  if (args.alreadyAssigned)
    return { code: "CONFLICT", message: "This person is already assigned to the site." };
  return null;
}

export function prettyRole(role: string | null | undefined): string {
  if (!role) return "No role";
  if (role === "super_admin") return "Super Admin";
  if (role === "admin") return "Contractor / Admin";
  if (role === "director") return "Director / Partner";
  return role.replaceAll("_", " ").replace(/\b\w/g, (part) => part.toUpperCase());
}

/** Normalises a code typed by a user: trimmed, upper case, letters/digits/hyphens. */
export function normalizeCode(value: string): string {
  return value.trim().toUpperCase();
}
export function isValidCode(value: string): boolean {
  return /^[A-Z0-9][A-Z0-9-]{1,31}$/.test(normalizeCode(value));
}

export type InboxItem = {
  id: string;
  kind:
    | "report.review"
    | "report.returned"
    | "material.review"
    | "invoice.review"
    | "payment.review"
    | "payment.post"
    | "inventory.review"
    | "cash.review"
    | "cash.post"
    | "cash.acknowledge"
    | "task.overdue"
    | "issue.critical"
    | "issue.assigned"
    | "issue.verify"
    | "purchase.review"
    | "subcontract.review"
    | "subcontract.check"
    | "payroll.review"
    | "payroll.profile"
    | "accounts.due";
  title: string;
  detail: string;
  siteId: string;
  siteName: string;
  occurredAt: string;
  route: string;
  severity: "high" | "normal";
};

/** Oldest high-severity work first, then oldest normal work: what has waited longest is shown first. */
export function sortInbox(items: readonly InboxItem[]): InboxItem[] {
  return [...items].sort((a, b) => {
    if (a.severity !== b.severity) return a.severity === "high" ? -1 : 1;
    return a.occurredAt.localeCompare(b.occurredAt);
  });
}
