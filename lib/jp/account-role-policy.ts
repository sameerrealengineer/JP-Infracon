import type { BusinessRole } from "../../server/jp/policy";

/**
 * Who may create, edit, reset, suspend or remove whose account.
 *
 * Super Admin → Owner → Director → Admin → Project Manager → Site Engineer → Site Supervisor
 * → Accounts / Storekeeper / Auditor. Mistri and workers sign in with mobile + PIN and are
 * managed from the worker's page, not here.
 *
 * Everyone manages only roles strictly below their own. Owner, Director and Admin manage the
 * whole company; Project Manager, Site Engineer and Site Supervisor manage only people on their
 * own sites, and only give access to those sites.
 */
export const assignableBusinessRoles = [
  "admin",
  "director",
  "project_manager",
  "site_engineer",
  "supervisor",
  "accounts",
  "storekeeper",
  "auditor",
] as const satisfies readonly BusinessRole[];
export type ManagerRole = BusinessRole | "super_admin";

const RANK: Record<ManagerRole, number> = {
  super_admin: 100,
  owner: 90,
  director: 80,
  admin: 70,
  project_manager: 60,
  site_engineer: 50,
  supervisor: 40,
  accounts: 20,
  storekeeper: 20,
  auditor: 20,
};

/** Roles that cover the whole company (no site list). */
export const companyWideRoles: readonly BusinessRole[] = ["owner", "director", "admin"];

/** Roles whose account management is limited to their own sites. */
export const siteManagerRoles: readonly BusinessRole[] = [
  "project_manager",
  "site_engineer",
  "supervisor",
];

export function roleRank(role: ManagerRole): number {
  return RANK[role] ?? 0;
}

/** True when this role manages accounts of the whole company. */
export function managesWholeCompany(role: ManagerRole): boolean {
  return role === "super_admin" || companyWideRoles.includes(role as BusinessRole);
}

/** True when this role may manage accounts at all (company-wide or on its own sites). */
export function managesAccounts(role: ManagerRole): boolean {
  return managesWholeCompany(role) || siteManagerRoles.includes(role as BusinessRole);
}

export function rolesAssignableBy(managerRole: ManagerRole): readonly BusinessRole[] {
  if (!managesAccounts(managerRole)) return [];
  if (managerRole === "super_admin" || managerRole === "owner") return assignableBusinessRoles;
  const rank = roleRank(managerRole);
  const roles = assignableBusinessRoles.filter((role) => roleRank(role) < rank);
  // Site managers hand out site roles only; company-wide roles need a company leader.
  return managesWholeCompany(managerRole)
    ? roles
    : roles.filter((role) => !companyWideRoles.includes(role));
}

export function mayManageRole(managerRole: ManagerRole, targetRole: BusinessRole): boolean {
  if (managerRole === "super_admin") return true;
  if (!managesAccounts(managerRole)) return false;
  if (managerRole === "owner") return targetRole !== "owner";
  return roleRank(managerRole) > roleRank(targetRole);
}

export function mayManageMembershipRoles(
  managerRole: ManagerRole,
  targetRoles: readonly BusinessRole[],
): boolean {
  return (
    targetRoles.length > 0 &&
    targetRoles.every((targetRole) => mayManageRole(managerRole, targetRole))
  );
}

/**
 * A site manager may give access only to sites they are on themselves, and must give at least
 * one. Company-wide managers are limited by the company only (checked by the caller).
 */
export function siteChoiceProblem(args: {
  managerRole: ManagerRole;
  managerSiteIds: readonly string[];
  targetRole: BusinessRole;
  siteIds: readonly string[];
}): string | null {
  const companyWide = companyWideRoles.includes(args.targetRole);
  if (companyWide && args.siteIds.length > 0)
    return "Owner, Director and Admin cover the whole company; do not choose sites for them.";
  if (!companyWide && args.siteIds.length === 0) return "Choose at least one site for this role.";
  if (new Set(args.siteIds).size !== args.siteIds.length) return "A site may be chosen only once.";
  if (managesWholeCompany(args.managerRole)) return null;
  const own = new Set(args.managerSiteIds);
  if (args.siteIds.some((siteId) => !own.has(siteId)))
    return "You can give access only to your own sites.";
  return null;
}

/** Plain names for roles, as people on site say them. */
export const ROLE_LABELS: Record<BusinessRole | "super_admin", string> = {
  super_admin: "Super Admin",
  owner: "Owner",
  director: "Director / Partner",
  admin: "Admin",
  project_manager: "Project Manager",
  site_engineer: "Site Engineer",
  supervisor: "Site Supervisor",
  accounts: "Accounts",
  storekeeper: "Storekeeper",
  auditor: "Auditor",
};
