export type BusinessRole =
  | "owner"
  | "director"
  | "admin"
  | "project_manager"
  | "supervisor"
  | "accounts"
  | "storekeeper"
  | "auditor";

export type PermissionScope = "organization" | "project" | "site";
export type PermissionEffect = "allow" | "deny";

export type PermissionGrantForResolution = {
  scopeType: PermissionScope;
  scopeId: string;
  permissionKey: string;
  effect: PermissionEffect;
  status: "Active" | "Revoked";
  effectiveFrom: Date | string;
  effectiveTo: Date | string | null;
};

const roleDefaults: Record<BusinessRole, readonly string[]> = {
  owner: [
    "site.view",
    "site.manage",
    "task.view",
    "task.manage",
    "task.status.update",
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
    "audit.view",
    "user.manage",
    "workforce.view",
    "workforce.manage",
    "workforce.kyc.view",
    "workforce.kyc.review",
    "workforce.review",
    "compensation.view",
    "compensation.manage",
    "compensation.review",
  ],
  director: [
    "site.view",
    "site.manage",
    "task.view",
    "task.manage",
    "task.status.update",
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
    "audit.view",
    "user.manage",
    "workforce.view",
    "workforce.manage",
    "workforce.kyc.view",
    "workforce.kyc.review",
    "workforce.review",
    "compensation.view",
    "compensation.manage",
    "compensation.review",
  ],
  admin: [
    "site.view",
    "site.manage",
    "task.view",
    "task.manage",
    "task.status.update",
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
    "audit.view",
    "user.manage",
    "workforce.view",
    "workforce.manage",
    "workforce.kyc.view",
    "workforce.kyc.review",
    "workforce.review",
    "compensation.view",
    "compensation.manage",
    "compensation.review",
  ],
  project_manager: [
    "site.view",
    "task.view",
    "task.manage",
    "task.status.update",
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
    "audit.view",
    "workforce.view",
    "workforce.manage",
    "workforce.kyc.view",
    "workforce.kyc.review",
    "workforce.review",
  ],
  supervisor: [
    "site.view",
    "task.view",
    "task.status.update",
    "dpr.view",
    "dpr.create",
    "dpr.submit",
    "dlr.view",
    "dlr.create",
    "dlr.submit",
    "material.request.view",
    "material.request",
    "workforce.view",
    "workforce.manage",
  ],
  accounts: [
    "site.view",
    "audit.view",
    "workforce.view",
    "workforce.kyc.view",
    "compensation.view",
    "compensation.manage",
    "compensation.review",
  ],
  storekeeper: ["site.view", "material.request.view"],
  auditor: ["site.view", "audit.view", "workforce.view", "compensation.view"],
};

const inventoryRoleDefaults: Record<BusinessRole, readonly string[]> = {
  owner: ["inventory.view", "inventory.catalog.manage", "inventory.transact", "inventory.review"],
  director: [
    "inventory.view",
    "inventory.catalog.manage",
    "inventory.transact",
    "inventory.review",
  ],
  admin: ["inventory.view", "inventory.catalog.manage", "inventory.transact", "inventory.review"],
  project_manager: ["inventory.view", "inventory.transact", "inventory.review"],
  supervisor: ["inventory.view", "inventory.transact"],
  accounts: [],
  storekeeper: ["inventory.view", "inventory.transact"],
  auditor: ["inventory.view"],
};

const financeRoleDefaults: Record<BusinessRole, readonly string[]> = {
  owner: [
    "vendor.view",
    "vendor.create",
    "finance.invoice.view",
    "finance.invoice.create",
    "finance.invoice.submit",
    "finance.invoice.review",
    "finance.payment.view",
    "finance.payment.create",
    "finance.payment.submit",
    "finance.payment.review",
    "finance.payment.post",
    "finance.payment.cancel",
  ],
  director: [
    "vendor.view",
    "vendor.create",
    "finance.invoice.view",
    "finance.invoice.create",
    "finance.invoice.submit",
    "finance.invoice.review",
    "finance.payment.view",
    "finance.payment.create",
    "finance.payment.submit",
    "finance.payment.review",
    "finance.payment.post",
    "finance.payment.cancel",
  ],
  admin: [
    "vendor.view",
    "vendor.create",
    "finance.invoice.view",
    "finance.invoice.create",
    "finance.invoice.submit",
    "finance.invoice.review",
    "finance.payment.view",
    "finance.payment.create",
    "finance.payment.submit",
    "finance.payment.review",
    "finance.payment.post",
    "finance.payment.cancel",
  ],
  project_manager: [
    "vendor.view",
    "finance.invoice.view",
    "finance.invoice.create",
    "finance.invoice.submit",
    "finance.invoice.review",
    "finance.payment.view",
    "finance.payment.review",
  ],
  supervisor: [
    "vendor.view",
    "finance.invoice.view",
    "finance.invoice.create",
    "finance.invoice.submit",
  ],
  accounts: [
    "vendor.view",
    "vendor.create",
    "finance.invoice.view",
    "finance.invoice.create",
    "finance.invoice.submit",
    "finance.invoice.review",
    "finance.payment.view",
    "finance.payment.create",
    "finance.payment.submit",
    "finance.payment.cancel",
  ],
  storekeeper: [],
  auditor: ["vendor.view", "finance.invoice.view", "finance.payment.view"],
};

const pettyCashRoleDefaults: Record<BusinessRole, readonly string[]> = {
  owner: [
    "finance.cash.view",
    "finance.cash.fund.manage",
    "finance.cash.movement.create",
    "finance.cash.movement.submit",
    "finance.cash.movement.review",
    "finance.cash.movement.post",
    "finance.cash.movement.cancel",
  ],
  director: [
    "finance.cash.view",
    "finance.cash.fund.manage",
    "finance.cash.movement.create",
    "finance.cash.movement.submit",
    "finance.cash.movement.review",
    "finance.cash.movement.post",
    "finance.cash.movement.cancel",
  ],
  admin: [
    "finance.cash.view",
    "finance.cash.fund.manage",
    "finance.cash.movement.create",
    "finance.cash.movement.submit",
    "finance.cash.movement.review",
    "finance.cash.movement.post",
    "finance.cash.movement.cancel",
  ],
  project_manager: [
    "finance.cash.view",
    "finance.cash.movement.create",
    "finance.cash.movement.submit",
    "finance.cash.movement.cancel",
  ],
  supervisor: [
    "finance.cash.view",
    "finance.cash.movement.create",
    "finance.cash.movement.submit",
    "finance.cash.movement.cancel",
  ],
  accounts: [
    "finance.cash.view",
    "finance.cash.fund.manage",
    "finance.cash.movement.create",
    "finance.cash.movement.submit",
    "finance.cash.movement.cancel",
  ],
  storekeeper: [],
  auditor: ["finance.cash.view"],
};

export function roleAllows(role: BusinessRole, permissionKey: string): boolean {
  return (
    roleDefaults[role].includes(permissionKey) ||
    inventoryRoleDefaults[role].includes(permissionKey) ||
    financeRoleDefaults[role].includes(permissionKey) ||
    pettyCashRoleDefaults[role].includes(permissionKey)
  );
}

function asTime(value: Date | string | null): number | null {
  if (value === null) return null;
  const time = value instanceof Date ? value.getTime() : Date.parse(value);
  return Number.isNaN(time) ? null : time;
}

/** Organisation masters may not be edited through a site-only grant. */
export function resolveOrganizationPermission(args: {
  role: BusinessRole;
  permissionKey: string;
  organizationId: string;
  grants: readonly PermissionGrantForResolution[];
  now?: Date;
}): boolean {
  const now = (args.now ?? new Date()).getTime();
  const matching = args.grants.filter((grant) => {
    if (
      grant.scopeType !== "organization" ||
      grant.scopeId !== args.organizationId ||
      grant.permissionKey !== args.permissionKey ||
      grant.status !== "Active"
    )
      return false;
    const start = asTime(grant.effectiveFrom);
    const end = asTime(grant.effectiveTo);
    if (start !== null && start > now) return false;
    if (end !== null && end < now) return false;
    return true;
  });
  if (matching.some((grant) => grant.effect === "deny")) return false;
  if (matching.some((grant) => grant.effect === "allow")) return true;
  return roleAllows(args.role, args.permissionKey);
}

function grantAppliesToSite(
  grant: PermissionGrantForResolution,
  scope: { organizationId: string; projectId: string; siteId: string },
): boolean {
  if (grant.scopeType === "organization") return grant.scopeId === scope.organizationId;
  if (grant.scopeType === "project") return grant.scopeId === scope.projectId;
  return grant.scopeId === scope.siteId;
}

/** Explicit active denies take precedence over grants and role defaults. */
export function resolveSitePermission(args: {
  role: BusinessRole;
  permissionKey: string;
  scope: { organizationId: string; projectId: string; siteId: string };
  grants: readonly PermissionGrantForResolution[];
  now?: Date;
}): boolean {
  const now = (args.now ?? new Date()).getTime();
  const matching = args.grants.filter((grant) => {
    if (grant.permissionKey !== args.permissionKey || grant.status !== "Active") return false;
    if (!grantAppliesToSite(grant, args.scope)) return false;
    const start = asTime(grant.effectiveFrom);
    const end = asTime(grant.effectiveTo);
    if (start !== null && start > now) return false;
    if (end !== null && end < now) return false;
    return true;
  });

  if (matching.some((grant) => grant.effect === "deny")) return false;
  if (matching.some((grant) => grant.effect === "allow")) return true;
  return roleAllows(args.role, args.permissionKey);
}
