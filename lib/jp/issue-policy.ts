/** Rules for site safety, quality and constraint issues. Shared by the API and the app. */

export const issueCategories = [
  "Safety Hazard",
  "Incident",
  "Near Miss",
  "Quality Defect",
  "Quality Observation",
  "Material Shortage",
  "Drawing / Approval",
  "Utility / Access",
  "Equipment Breakdown",
  "Client Coordination",
  "Other",
] as const;
export type IssueCategory = (typeof issueCategories)[number];

export const issueSeverities = ["Low", "Medium", "High", "Critical"] as const;
export type IssueSeverity = (typeof issueSeverities)[number];

export const issueStatuses = ["Open", "In Progress", "Resolved", "Closed"] as const;
export type IssueStatus = (typeof issueStatuses)[number];

export type IssueAction = "start" | "resolve" | "close" | "send_back" | "reopen";

export type IssuePolicyError = {
  code: "BAD_REQUEST" | "CONFLICT" | "FORBIDDEN";
  message: string;
};

export const safetyCategories: readonly IssueCategory[] = [
  "Safety Hazard",
  "Incident",
  "Near Miss",
];

/** Which permission each action needs. `issue.manage` works the issue; `issue.close` verifies it. */
export const issueActionPermission: Record<IssueAction, "issue.manage" | "issue.close"> = {
  start: "issue.manage",
  resolve: "issue.manage",
  close: "issue.close",
  send_back: "issue.close",
  reopen: "issue.close",
};

const actionTarget: Record<IssueAction, { from: readonly IssueStatus[]; to: IssueStatus }> = {
  start: { from: ["Open"], to: "In Progress" },
  resolve: { from: ["Open", "In Progress"], to: "Resolved" },
  close: { from: ["Resolved"], to: "Closed" },
  send_back: { from: ["Resolved"], to: "In Progress" },
  reopen: { from: ["Closed"], to: "Open" },
};

export function availableIssueActions(
  status: IssueStatus,
  permissions: { manage: boolean; close: boolean },
): IssueAction[] {
  return (Object.keys(actionTarget) as IssueAction[]).filter(
    (action) =>
      actionTarget[action].from.includes(status) &&
      (issueActionPermission[action] === "issue.manage" ? permissions.manage : permissions.close),
  );
}

/**
 * Validates an issue status change. High and Critical issues need a different person to close
 * than the one who resolved them, so nobody signs off their own fix on a serious hazard.
 */
export function validateIssueTransition(args: {
  action: IssueAction;
  status: IssueStatus;
  severity: IssueSeverity;
  actorUserId: number;
  resolvedBy: number | null;
  note: string | null | undefined;
  correctiveAction?: string | null;
}): { next: IssueStatus } | IssuePolicyError {
  const rule = actionTarget[args.action];
  if (!rule.from.includes(args.status))
    return {
      code: "CONFLICT",
      message: `A ${args.status} issue cannot be ${labelFor(args.action)}.`,
    };
  const note = args.note?.trim() ?? "";
  if (args.action === "resolve" && (args.correctiveAction?.trim().length ?? 0) < 5)
    return { code: "BAD_REQUEST", message: "Describe the corrective action taken." };
  if (["close", "send_back", "reopen"].includes(args.action) && note.length < 3)
    return { code: "BAD_REQUEST", message: "Enter a note explaining this decision." };
  if (
    args.action === "close" &&
    (args.severity === "High" || args.severity === "Critical") &&
    args.resolvedBy === args.actorUserId
  )
    return {
      code: "FORBIDDEN",
      message: "A different person must verify and close a High or Critical issue.",
    };
  return { next: rule.to };
}

export function isIssuePolicyError(value: unknown): value is IssuePolicyError {
  return Boolean(value && typeof value === "object" && "code" in value);
}

export function labelFor(action: IssueAction): string {
  return {
    start: "started",
    resolve: "resolved",
    close: "closed",
    send_back: "sent back",
    reopen: "reopened",
  }[action];
}

export function actionButtonLabel(action: IssueAction): string {
  return {
    start: "Start work",
    resolve: "Mark resolved",
    close: "Verify & close",
    send_back: "Not fixed — send back",
    reopen: "Reopen",
  }[action];
}

/** An open issue is overdue the day after its target date. */
export function isIssueOverdue(
  issue: { status: IssueStatus; targetDate: string | null },
  today = new Date().toISOString().slice(0, 10),
): boolean {
  return Boolean(
    issue.targetDate &&
    issue.targetDate < today &&
    issue.status !== "Resolved" &&
    issue.status !== "Closed",
  );
}

export function severityTone(severity: IssueSeverity): "error" | "warning" | "accent" | "info" {
  return severity === "Critical"
    ? "error"
    : severity === "High"
      ? "warning"
      : severity === "Medium"
        ? "accent"
        : "info";
}

/** Short, sortable human code: <SITE>-<YYMMDD>-<NNN>. */
export function formatIssueCode(siteCode: string, date: Date, sequence: number): string {
  const yymmdd = date.toISOString().slice(2, 10).replaceAll("-", "");
  return `${siteCode.toUpperCase()}-${yymmdd}-${String(sequence).padStart(3, "0")}`.slice(0, 48);
}
