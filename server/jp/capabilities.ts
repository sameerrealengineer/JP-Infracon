import { and, eq, gte, inArray, isNull, lte, or } from "drizzle-orm";
import { disabledModulesFor } from "./module-settings";
import { isPermissionDisabled } from "../../lib/jp/modules";
import { TRPCError } from "@trpc/server";
import { permissionGrants } from "../../drizzle/schema";
import { getAccessibleSites, getSiteScope } from "./access";
import {
  resolveOrganizationPermission,
  resolveSitePermission,
  type PermissionGrantForResolution,
} from "./policy";

function requireDb(db: Awaited<ReturnType<typeof import("../db").getDb>>) {
  if (!db)
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message: "The business data service is temporarily unavailable.",
    });
  return db;
}

export const permissionKeys = [
  "site.view",
  "site.manage",
  "user.manage",
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
  "task.view",
  "task.manage",
  "task.status.update",
  "workforce.view",
  "workforce.manage",
  "workforce.kyc.view",
  "workforce.kyc.review",
  "workforce.review",
  "compensation.view",
  "compensation.manage",
  "compensation.review",
  "inventory.view",
  "inventory.catalog.manage",
  "inventory.transact",
  "inventory.review",
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
  "finance.cash.view",
  "finance.cash.fund.manage",
  "finance.cash.movement.create",
  "finance.cash.movement.submit",
  "finance.cash.movement.review",
  "finance.cash.movement.post",
  "finance.cash.movement.cancel",
  "issue.view",
  "issue.create",
  "issue.manage",
  "issue.close",
  "attendance.view",
  "attendance.mark",
  "attendance.approve",
  "approval.self",
  "document.view",
  "document.upload",
  "document.manage",
  "budget.view",
  "budget.manage",
  "budget.approve",
] as const;
export type PermissionKey = (typeof permissionKeys)[number];
type AccessibleSite = Awaited<ReturnType<typeof getAccessibleSites>>[number];
export type SiteCapability = { siteId: string } & Record<PermissionKey, boolean>;

export async function siteCapabilities(
  user: Parameters<typeof getSiteScope>[0],
  scopedSites: AccessibleSite[],
): Promise<SiteCapability[]> {
  if (scopedSites.length === 0) return [];
  const db = requireDb(await (await import("../db")).getDb());
  const now = new Date();
  const organizationIds = [...new Set(scopedSites.map((site) => site.organizationId))];
  const grants = await db
    .select()
    .from(permissionGrants)
    .where(
      and(
        eq(permissionGrants.userId, user.id),
        eq(permissionGrants.status, "Active"),
        inArray(permissionGrants.organizationId, organizationIds),
        lte(permissionGrants.effectiveFrom, now),
        or(isNull(permissionGrants.effectiveTo), gte(permissionGrants.effectiveTo, now)),
      ),
    );
  const disabledByOrg = new Map(
    await Promise.all(
      organizationIds.map(async (id) => [id, await disabledModulesFor(id)] as const),
    ),
  );
  return scopedSites.map((site) => {
    const capabilities = {} as Record<PermissionKey, boolean>;
    const disabled = disabledByOrg.get(site.organizationId) ?? [];
    for (const permissionKey of permissionKeys) {
      const siteIsAvailable =
        (site.status === "Active" || permissionKey.endsWith(".view")) &&
        !isPermissionDisabled(permissionKey, disabled);
      capabilities[permissionKey] = siteIsAvailable
        ? [
            "inventory.catalog.manage",
            "vendor.view",
            "vendor.create",
            "site.manage",
            "user.manage",
          ].includes(permissionKey)
          ? resolveOrganizationPermission({
              role: site.businessRole,
              permissionKey,
              organizationId: site.organizationId,
              grants: grants as PermissionGrantForResolution[],
              now,
            }) &&
            resolveSitePermission({
              role: site.businessRole,
              permissionKey,
              scope: {
                organizationId: site.organizationId,
                projectId: site.projectId,
                siteId: site.id,
              },
              grants: grants as PermissionGrantForResolution[],
              now,
            })
          : resolveSitePermission({
              role: site.businessRole,
              permissionKey,
              scope: {
                organizationId: site.organizationId,
                projectId: site.projectId,
                siteId: site.id,
              },
              grants: grants as PermissionGrantForResolution[],
              now,
            })
        : false;
    }
    return { siteId: site.id, ...capabilities };
  });
}

export function sitesWithPermission(
  capabilities: SiteCapability[],
  siteIds: string[],
  permissionKey: PermissionKey,
) {
  const requested = new Set(siteIds);
  return capabilities
    .filter((capability) => requested.has(capability.siteId) && capability[permissionKey])
    .map((capability) => capability.siteId);
}
