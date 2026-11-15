/**
 * Delegation of authority: the largest amount a role may approve in one area. No limit set
 * means no ceiling (nothing changes until a leader sets limits). Owner and Super Admin are
 * never limited.
 */
export const APPROVAL_AREAS = [
  "purchase_order",
  "subcontract_bill",
  "supplier_payment",
  "petty_cash",
  "client_bill",
  "budget",
] as const;
export type ApprovalArea = (typeof APPROVAL_AREAS)[number];

export const AREA_LABELS: Record<ApprovalArea, string> = {
  purchase_order: "Purchase orders",
  subcontract_bill: "Contractor bills and work orders",
  supplier_payment: "Supplier payments",
  petty_cash: "Petty cash",
  client_bill: "Client RA bills",
  budget: "Project budgets",
};

/** Roles whose approvals can be limited (the ones that approve money somewhere). */
export const LIMITABLE_ROLES = [
  "director",
  "admin",
  "project_manager",
  "site_engineer",
  "accounts",
] as const;

export function isUnlimitedRole(role: string) {
  return role === "owner" || role === "super_admin";
}

/** Null when the amount is within the role's ceiling (or there is none); else the ceiling. */
export function ceilingExceeded(
  role: string,
  amountMinor: bigint,
  limitMinor: bigint | null,
): bigint | null {
  if (isUnlimitedRole(role) || limitMinor === null) return null;
  return amountMinor > limitMinor ? limitMinor : null;
}

/** "₹1,50,000" in Indian grouping, whole rupees. */
export function rupeesText(minor: bigint) {
  const rupees = minor / 100n;
  return `₹${rupees.toLocaleString("en-IN")}`;
}
