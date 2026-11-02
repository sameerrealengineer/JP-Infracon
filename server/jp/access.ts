import { and, eq, gte, inArray, isNull, lte, or } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import type { User } from "../../drizzle/schema";
import {
  organizationMemberships,
  permissionGrants,
  projects,
  siteAssignments,
  sites,
} from "../../drizzle/schema";
import { getDb } from "../db";
import {
  resolveSitePermission,
  type BusinessRole,
  type PermissionGrantForResolution,
} from "./policy";

const businessRoles: readonly BusinessRole[] = [
  "owner",
  "director",
  "admin",
  "project_manager",
  "supervisor",
  "accounts",
  "storekeeper",
  "auditor",
];

function parseBusinessRole(value: string): BusinessRole {
  if (!businessRoles.includes(value as BusinessRole))
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: "The site assignment contains an invalid business role.",
    });
  return value as BusinessRole;
}

export type SiteScope = {
  siteId: string;
  siteName: string;
  siteCode: string;
  siteStatus: "Active" | "On Hold" | "Completed" | "Inactive";
  organizationId: string;
  projectId: string;
  projectName: string;
  businessRole: BusinessRole;
};

export function assertActiveAccount(user: User): void {
  if (user.accountStatus !== "Active") {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "This account is not active. Contact an organisation administrator.",
    });
  }
}

export async function getSiteScope(
  user: User,
  siteId: string,
  permissionKey = "site.view",
): Promise<SiteScope> {
  assertActiveAccount(user);
  const db = await getDb();
  if (!db)
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message: "The business data service is temporarily unavailable.",
    });

  const [siteRow] = await db
    .select({
      siteId: sites.id,
      siteName: sites.name,
      siteCode: sites.siteCode,
      siteStatus: sites.status,
      organizationId: sites.organizationId,
      projectId: projects.id,
      projectName: projects.name,
    })
    .from(sites)
    .innerJoin(projects, eq(sites.projectId, projects.id))
    .where(eq(sites.id, siteId))
    .limit(1);
  if (!siteRow) throw new TRPCError({ code: "NOT_FOUND", message: "Site not found." });

  const memberships = await db
    .select()
    .from(organizationMemberships)
    .where(
      and(
        eq(organizationMemberships.organizationId, siteRow.organizationId),
        eq(organizationMemberships.userId, user.id),
        eq(organizationMemberships.status, "Active"),
      ),
    );
  if (memberships.length === 0)
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "You do not have access to this organisation.",
    });

  const membership =
    memberships.find((row) => ["owner", "director", "admin"].includes(row.businessRole)) ??
    memberships[0];
  const broadOrganizationRole =
    membership.businessRole === "owner" ||
    membership.businessRole === "director" ||
    membership.businessRole === "admin";
  let businessRole = membership.businessRole;
  const now = new Date();
  if (!broadOrganizationRole) {
    const [assignment] = await db
      .select({ id: siteAssignments.id, assignmentRole: siteAssignments.assignmentRole })
      .from(siteAssignments)
      .where(
        and(
          eq(siteAssignments.siteId, siteRow.siteId),
          eq(siteAssignments.userId, user.id),
          eq(siteAssignments.status, "Active"),
          lte(siteAssignments.effectiveFrom, now),
          or(isNull(siteAssignments.effectiveTo), gte(siteAssignments.effectiveTo, now)),
        ),
      )
      .limit(1);
    if (!assignment)
      throw new TRPCError({
        code: "FORBIDDEN",
        message: "This site is outside your active assignment.",
      });
    businessRole = parseBusinessRole(assignment.assignmentRole);
  }

  {
    const readOnlyPermission = permissionKey.endsWith(".view");
    if (!readOnlyPermission && siteRow.siteStatus !== "Active") {
      throw new TRPCError({
        code: "PRECONDITION_FAILED",
        message: "This site is not accepting routine changes.",
      });
    }
    const grants = await db
      .select()
      .from(permissionGrants)
      .where(
        and(
          eq(permissionGrants.organizationId, siteRow.organizationId),
          eq(permissionGrants.userId, user.id),
          eq(permissionGrants.permissionKey, permissionKey),
          eq(permissionGrants.status, "Active"),
          lte(permissionGrants.effectiveFrom, now),
          or(isNull(permissionGrants.effectiveTo), gte(permissionGrants.effectiveTo, now)),
        ),
      );
    const allowed = resolveSitePermission({
      role: businessRole,
      permissionKey,
      scope: {
        organizationId: siteRow.organizationId,
        projectId: siteRow.projectId,
        siteId: siteRow.siteId,
      },
      grants: grants as PermissionGrantForResolution[],
      now,
    });
    if (!allowed)
      throw new TRPCError({
        code: "FORBIDDEN",
        message: `Your current role does not include ${permissionKey} for this site.`,
      });
  }

  return { ...siteRow, businessRole };
}

export async function getAccessibleSites(user: User) {
  assertActiveAccount(user);
  const db = await getDb();
  if (!db)
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message: "The business data service is temporarily unavailable.",
    });

  const memberships = await db
    .select({
      organizationId: organizationMemberships.organizationId,
      businessRole: organizationMemberships.businessRole,
    })
    .from(organizationMemberships)
    .where(
      and(
        eq(organizationMemberships.userId, user.id),
        eq(organizationMemberships.status, "Active"),
      ),
    );
  if (memberships.length === 0) return [];

  const broadOrgIds = memberships
    .filter((membership) => ["owner", "director", "admin"].includes(membership.businessRole))
    .map((membership) => membership.organizationId);
  const roleByOrganization = new Map<string, BusinessRole>();
  for (const membership of memberships) {
    const current = roleByOrganization.get(membership.organizationId);
    const isBroadRole = ["owner", "director", "admin"].includes(membership.businessRole);
    if (!current || isBroadRole)
      roleByOrganization.set(membership.organizationId, membership.businessRole);
  }
  const assignmentOrgIds = memberships.map((membership) => membership.organizationId);
  const now = new Date();
  const assigned = await db
    .select({ siteId: siteAssignments.siteId, assignmentRole: siteAssignments.assignmentRole })
    .from(siteAssignments)
    .innerJoin(sites, eq(siteAssignments.siteId, sites.id))
    .where(
      and(
        eq(siteAssignments.userId, user.id),
        eq(siteAssignments.status, "Active"),
        inArray(sites.organizationId, assignmentOrgIds),
        lte(siteAssignments.effectiveFrom, now),
        or(isNull(siteAssignments.effectiveTo), gte(siteAssignments.effectiveTo, now)),
      ),
    );
  const allowedSiteIds = [...new Set(assigned.map((row) => row.siteId))];
  const assignmentRoleBySite = new Map(assigned.map((row) => [row.siteId, row.assignmentRole]));

  const visibleByOrg =
    broadOrgIds.length === 0
      ? []
      : await db
          .select({ siteId: sites.id })
          .from(sites)
          .where(inArray(sites.organizationId, broadOrgIds));
  const siteIds = [...new Set([...allowedSiteIds, ...visibleByOrg.map((row) => row.siteId)])];
  if (siteIds.length === 0) return [];

  const visibleSites = await db
    .select({
      id: sites.id,
      name: sites.name,
      code: sites.siteCode,
      location: sites.address,
      status: sites.status,
      organizationId: sites.organizationId,
      projectId: projects.id,
      project: projects.name,
    })
    .from(sites)
    .innerJoin(projects, eq(sites.projectId, projects.id))
    .where(inArray(sites.id, siteIds))
    .limit(200);
  const scopedSites = visibleSites.map((site) => {
    const organizationRole = roleByOrganization.get(site.organizationId);
    if (!organizationRole)
      throw new TRPCError({
        code: "INTERNAL_SERVER_ERROR",
        message: "The organisation role for this site could not be resolved.",
      });
    const isBroadRole = ["owner", "director", "admin"].includes(organizationRole);
    const assignmentRole = assignmentRoleBySite.get(site.id);
    const businessRole = isBroadRole
      ? organizationRole
      : assignmentRole
        ? parseBusinessRole(assignmentRole)
        : undefined;
    if (!businessRole)
      throw new TRPCError({
        code: "INTERNAL_SERVER_ERROR",
        message: "The assigned site role could not be resolved.",
      });
    return { ...site, businessRole };
  });
  const organizationIds = [...new Set(scopedSites.map((site) => site.organizationId))];
  const scopeCheckTime = new Date();
  const grants = await db
    .select()
    .from(permissionGrants)
    .where(
      and(
        eq(permissionGrants.userId, user.id),
        eq(permissionGrants.status, "Active"),
        inArray(permissionGrants.organizationId, organizationIds),
        lte(permissionGrants.effectiveFrom, scopeCheckTime),
        or(isNull(permissionGrants.effectiveTo), gte(permissionGrants.effectiveTo, scopeCheckTime)),
      ),
    );
  return scopedSites.filter((site) =>
    resolveSitePermission({
      role: site.businessRole,
      permissionKey: "site.view",
      scope: { organizationId: site.organizationId, projectId: site.projectId, siteId: site.id },
      grants: grants as PermissionGrantForResolution[],
      now: scopeCheckTime,
    }),
  );
}

export async function getAccessibleSiteIds(user: User): Promise<string[]> {
  const sitesInScope = await getAccessibleSites(user);
  return sitesInScope.map((site) => site.id);
}

/**
 * True when a director/admin has delegated "approve own work" (`approval.self`) for this site,
 * typically for a limited time. Maker-checker checks skip the different-person rule only then.
 */
export async function selfApprovalAllowed(user: User, siteId: string): Promise<boolean> {
  try {
    await getSiteScope(user, siteId, "approval.self");
    return true;
  } catch {
    return false;
  }
}
