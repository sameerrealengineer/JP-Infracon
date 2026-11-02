import type { BusinessRole } from "../../server/jp/policy";

export const assignableBusinessRoles = ["admin", "director", "project_manager", "supervisor", "accounts", "storekeeper", "auditor"] as const satisfies readonly BusinessRole[];
export type ManagerRole = BusinessRole | "super_admin";

export function rolesAssignableBy(managerRole: ManagerRole): readonly BusinessRole[] {
  if (managerRole === "super_admin" || managerRole === "owner") return assignableBusinessRoles;
  if (managerRole === "director") return ["admin", "project_manager", "supervisor", "accounts", "storekeeper", "auditor"];
  if (managerRole === "admin") return ["project_manager", "supervisor", "accounts", "storekeeper", "auditor"];
  return [];
}

export function mayManageRole(managerRole: ManagerRole, targetRole: BusinessRole): boolean {
  if (managerRole === "super_admin" || managerRole === "owner") return true;
  const level = (role: BusinessRole) => role === "director" ? 3 : role === "admin" ? 2 : 1;
  return managerRole !== targetRole && level(managerRole) > level(targetRole);
}

export function mayManageMembershipRoles(managerRole: ManagerRole, targetRoles: readonly BusinessRole[]): boolean {
  return targetRoles.length > 0 && targetRoles.every((targetRole) => mayManageRole(managerRole, targetRole));
}
