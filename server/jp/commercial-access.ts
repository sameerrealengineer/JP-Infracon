import { and, eq, gte, isNull, lte, or } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { organizationMemberships, permissionGrants, type User } from "../../drizzle/schema";
import { getDb } from "../db";
import { assertActiveAccount, assertModuleOn, getAccessibleSites } from "./access";
import {
  resolveOrganizationPermission,
  type BusinessRole,
  type PermissionGrantForResolution,
} from "./policy";

/**
 * Company-level access for CRM and client billing: the caller's company role (a leader role
 * first), organisation grants, and the module switch. Projects are limited to the ones the
 * caller can see through their sites (leaders see every project of the company).
 */

const LEADERS = ["owner", "director", "admin"];

export function requireDb(db: Awaited<ReturnType<typeof getDb>>) {
  if (!db)
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message: "The business data service is temporarily unavailable.",
    });
  return db;
}
export type Db = ReturnType<typeof requireDb>;

export type CommercialAccess = {
  db: Db;
  organizationId: string;
  role: BusinessRole;
  can: (key: string) => boolean;
  projectIds: Set<string>;
};

export async function commercialAccess(
  user: User,
  permissionKey: string,
): Promise<CommercialAccess> {
  assertActiveAccount(user);
  const db = requireDb(await getDb());
  const memberships = await db
    .select({
      organizationId: organizationMemberships.organizationId,
      role: organizationMemberships.businessRole,
    })
    .from(organizationMemberships)
    .where(
      and(
        eq(organizationMemberships.userId, user.id),
        eq(organizationMemberships.status, "Active"),
      ),
    )
    .limit(20);
  const membership = memberships.find((row) => LEADERS.includes(row.role)) ?? memberships[0];
  if (!membership) throw new TRPCError({ code: "FORBIDDEN", message: "Join your company first." });
  const now = new Date();
  const grants = (await db
    .select()
    .from(permissionGrants)
    .where(
      and(
        eq(permissionGrants.organizationId, membership.organizationId),
        eq(permissionGrants.userId, user.id),
        eq(permissionGrants.status, "Active"),
        lte(permissionGrants.effectiveFrom, now),
        or(isNull(permissionGrants.effectiveTo), gte(permissionGrants.effectiveTo, now)),
      ),
    )) as PermissionGrantForResolution[];
  const role = membership.role as BusinessRole;
  const can = (key: string) =>
    resolveOrganizationPermission({
      role,
      permissionKey: key,
      organizationId: membership.organizationId,
      grants,
      now,
    });
  if (!can(permissionKey))
    throw new TRPCError({
      code: "FORBIDDEN",
      message: `Your role does not include ${permissionKey}.`,
    });
  await assertModuleOn(membership.organizationId, permissionKey);
  const sites = await getAccessibleSites(user);
  const projectIds = new Set(
    sites
      .filter((site) => site.organizationId === membership.organizationId)
      .map((s) => s.projectId),
  );
  return { db, organizationId: membership.organizationId, role, can, projectIds };
}

export function requireProject(access: CommercialAccess, projectId: string) {
  if (!access.projectIds.has(projectId))
    throw new TRPCError({ code: "FORBIDDEN", message: "This project is outside your access." });
}
