import { MODULES, moduleForPermission } from "./modules";

/**
 * The permissions an authorised person can switch on or off for one user, grouped by module.
 * "Default" follows the user's role; "On" and "Off" are lasting grants (Off always wins). Some
 * keys are never offered here: self-approval only comes through a time-limited delegation.
 */

export const NOT_OFFERED = ["approval.self"] as const;

export type AccessChoice = "default" | "allow" | "deny";

const VERB: Record<string, string> = {
  view: "see",
  create: "create",
  manage: "manage",
  submit: "submit",
  review: "review / approve",
  approve: "approve",
  post: "post",
  cancel: "cancel",
  mark: "mark",
  measure: "record measurements",
  receive: "receive goods",
  receipt: "record receipts",
  prepare: "prepare",
  advance: "give advances",
  transact: "enter stock movements",
  request: "request",
  upload: "upload",
  close: "close",
  update: "update",
};

/** "finance.payment.review" → "Payment: review / approve". */
export function permissionLabel(key: string) {
  const parts = key.split(".");
  const verb = parts[parts.length - 1];
  const subject = parts.length > 2 ? parts.slice(1, -1).join(" ") : parts[0];
  const nice = subject.charAt(0).toUpperCase() + subject.slice(1);
  return `${nice}: ${VERB[verb] ?? verb}`;
}

/** Checked once for the whole company, so they can only be switched for "all sites". */
export function isCompanyLevel(key: string) {
  return (
    key === "user.manage" ||
    key.startsWith("crm.") ||
    key.startsWith("billing.") ||
    key.startsWith("accounts.")
  );
}

export type AccessGroup = { key: string; title: string; permissions: string[] };

export function accessGroups(permissionKeys: readonly string[]): AccessGroup[] {
  const offered = permissionKeys.filter((key) => !(NOT_OFFERED as readonly string[]).includes(key));
  const groups: AccessGroup[] = [
    {
      key: "core",
      title: "Core (sites, team, audit)",
      permissions: offered.filter((key) => moduleForPermission(key) === null),
    },
    ...MODULES.map((module) => ({
      key: module.key as string,
      title: module.title as string,
      permissions: offered.filter((key) => moduleForPermission(key) === module.key),
    })),
  ];
  return groups.filter((group) => group.permissions.length > 0);
}

/** Owners can switch on anything; others only what their own role already has. */
export function mayGrant(args: {
  managerIsOwner: boolean;
  managerHas: (key: string) => boolean;
  key: string;
  choice: AccessChoice;
}) {
  if ((NOT_OFFERED as readonly string[]).includes(args.key)) return false;
  if (args.choice !== "allow") return true;
  return args.managerIsOwner || args.managerHas(args.key);
}
