import { randomUUID } from "node:crypto";
import { and, eq, inArray, isNull } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import {
  auditEvents,
  organizationMemberships,
  permissionGrants,
  projects,
  siteAssignments,
  sites,
  users,
} from "../../drizzle/schema";
import { protectedProcedure, router } from "../_core/trpc";
import { getDb } from "../db";
import { assertCanManageOrganization } from "./accounts";
import { permissionKeys } from "./capabilities";
import {
  resolveOrganizationPermission,
  resolveSitePermission,
  roleAllows,
  type BusinessRole,
  type PermissionGrantForResolution,
} from "./policy";
import { mayManageMembershipRoles } from "../../lib/jp/account-role-policy";
import {
  NOT_OFFERED,
  accessGroups,
  isCompanyLevel,
  mayGrant,
  permissionLabel,
} from "../../lib/jp/access-catalog";

/**
 * Per-user access: an authorised person (user.manage, above the target in the hierarchy)
 * switches any permission On or Off for one user, for the whole company or one site, or puts it
 * back to the role default. These are lasting grants (delegations stay separate and time
 * limited). Off always wins over On and over the role. Nobody changes their own access, and only
 * an owner switches on something they do not have themselves. Every change is audited.
 */

const LEADER_ORDER: BusinessRole[] = [
  "owner",
  "director",
  "admin",
  "project_manager",
  "accounts",
  "supervisor",
  "storekeeper",
  "auditor",
];

function requireDb(db: Awaited<ReturnType<typeof getDb>>) {
  if (!db)
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message: "The business data service is temporarily unavailable.",
    });
  return db;
}
type Db = ReturnType<typeof requireDb>;

async function loadTarget(db: Db, organizationId: string, userId: number) {
  const memberships = await db
    .select({ role: organizationMemberships.businessRole })
    .from(organizationMemberships)
    .where(
      and(
        eq(organizationMemberships.organizationId, organizationId),
        eq(organizationMemberships.userId, userId),
        eq(organizationMemberships.status, "Active"),
      ),
    );
  if (!memberships.length)
    throw new TRPCError({ code: "NOT_FOUND", message: "This person is not in the company." });
  const roles = memberships.map((row) => row.role as BusinessRole);
  const role = LEADER_ORDER.find((r) => roles.includes(r)) ?? roles[0];
  return { roles, role };
}

/** Lasting grants for the user in the company, not counting delegations. */
async function lastingGrants(db: Db, organizationId: string, userId: number) {
  const rows = await db
    .select()
    .from(permissionGrants)
    .where(
      and(
        eq(permissionGrants.organizationId, organizationId),
        eq(permissionGrants.userId, userId),
        eq(permissionGrants.status, "Active"),
        isNull(permissionGrants.effectiveTo),
      ),
    );
  // A delegation "until revoked" also has no end; those stay on the delegation screen.
  return rows.filter((grant) => !(grant.reason ?? "").startsWith("Delegation:"));
}

async function managerContext(
  user: Parameters<typeof assertCanManageOrganization>[0],
  organizationId: string,
  targetUserId: number,
) {
  const access = await assertCanManageOrganization(user, organizationId);
  if (targetUserId === user.id)
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "You cannot change your own access. Ask another leader.",
    });
  const db = requireDb(await getDb());
  const target = await loadTarget(db, organizationId, targetUserId);
  if (target.roles.includes("owner") || !mayManageMembershipRoles(access.managerRole, target.roles))
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "You cannot change access for someone at or above your level.",
    });
  const managerIsOwner = access.managerRole === "owner" || access.managerRole === "super_admin";
  const managerHas = (key: string) =>
    managerIsOwner || roleAllows(access.managerRole as BusinessRole, key);
  return { db, target, managerIsOwner, managerHas };
}

const scopeInput = z.object({
  scopeType: z.enum(["organization", "site"]),
  scopeId: z.string().min(1).max(36),
});

export const userAccessRouter = router({
  /** A user's access per permission for the company or one site: role default, On/Off, result. */
  get: protectedProcedure
    .input(
      z
        .object({ organizationId: z.string().uuid(), userId: z.number().int().positive() })
        .merge(scopeInput),
    )
    .query(async ({ ctx, input }) => {
      const { db, target, managerIsOwner, managerHas } = await managerContext(
        ctx.user,
        input.organizationId,
        input.userId,
      );
      const [person] = await db
        .select({ name: users.name })
        .from(users)
        .where(eq(users.id, input.userId))
        .limit(1);
      const orgSites = await db
        .select({ id: sites.id, name: sites.name, projectId: sites.projectId })
        .from(sites)
        .innerJoin(projects, eq(sites.projectId, projects.id))
        .where(eq(sites.organizationId, input.organizationId));
      const assigned = await db
        .select({ siteId: siteAssignments.siteId })
        .from(siteAssignments)
        .where(and(eq(siteAssignments.userId, input.userId), eq(siteAssignments.status, "Active")));
      const site =
        input.scopeType === "site" ? orgSites.find((row) => row.id === input.scopeId) : null;
      if (input.scopeType === "site" && !site)
        throw new TRPCError({ code: "NOT_FOUND", message: "Site not found in this company." });
      if (input.scopeType === "organization" && input.scopeId !== input.organizationId)
        throw new TRPCError({ code: "BAD_REQUEST", message: "Wrong company." });
      const lasting = await lastingGrants(db, input.organizationId, input.userId);
      const allGrants = (await db
        .select()
        .from(permissionGrants)
        .where(
          and(
            eq(permissionGrants.organizationId, input.organizationId),
            eq(permissionGrants.userId, input.userId),
            eq(permissionGrants.status, "Active"),
          ),
        )) as PermissionGrantForResolution[];
      const groups = accessGroups(permissionKeys).map((group) => ({
        ...group,
        permissions: group.permissions.map((key) => {
          const here = lasting.find(
            (grant) =>
              grant.permissionKey === key &&
              grant.scopeType === input.scopeType &&
              grant.scopeId === input.scopeId,
          );
          const effective = site
            ? resolveSitePermission({
                role: target.role,
                permissionKey: key,
                scope: {
                  organizationId: input.organizationId,
                  projectId: site.projectId,
                  siteId: site.id,
                },
                grants: allGrants,
              })
            : resolveOrganizationPermission({
                role: target.role,
                permissionKey: key,
                organizationId: input.organizationId,
                grants: allGrants,
              });
          return {
            key,
            label: permissionLabel(key),
            roleDefault: roleAllows(target.role, key),
            choice: (here?.effect ?? "default") as "default" | "allow" | "deny",
            effective,
            companyOnly: isCompanyLevel(key),
            canAllow: mayGrant({ managerIsOwner, managerHas, key, choice: "allow" }),
          };
        }),
      }));
      return {
        user: { id: input.userId, name: person?.name ?? null },
        role: target.role,
        sites: orgSites.map((row) => ({
          id: row.id,
          name: row.name,
          assigned: assigned.some((a) => a.siteId === row.id),
        })),
        overrides: lasting.length,
        groups,
      };
    }),

  /** Switch permissions On, Off, or back to the role default for the company or one site. */
  set: protectedProcedure
    .input(
      z
        .object({
          organizationId: z.string().uuid(),
          userId: z.number().int().positive(),
          permissionKeys: z.array(z.string().max(96)).min(1).max(200),
          choice: z.enum(["default", "allow", "deny"]),
          reason: z.string().trim().max(500).nullish(),
        })
        .merge(scopeInput),
    )
    .mutation(async ({ ctx, input }) => {
      const { db, managerIsOwner, managerHas } = await managerContext(
        ctx.user,
        input.organizationId,
        input.userId,
      );
      const keys = [...new Set(input.permissionKeys)];
      for (const key of keys) {
        if (
          !(permissionKeys as readonly string[]).includes(key) ||
          (NOT_OFFERED as readonly string[]).includes(key)
        )
          throw new TRPCError({ code: "BAD_REQUEST", message: `${key} cannot be changed here.` });
        if (input.scopeType === "site" && isCompanyLevel(key))
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: `${permissionLabel(key)} applies to the whole company; change it for all sites.`,
          });
        if (!mayGrant({ managerIsOwner, managerHas, key, choice: input.choice }))
          throw new TRPCError({
            code: "FORBIDDEN",
            message: `Only the owner can switch on ${permissionLabel(key)}.`,
          });
      }
      if (input.scopeType === "organization" && input.scopeId !== input.organizationId)
        throw new TRPCError({ code: "BAD_REQUEST", message: "Wrong company." });
      if (input.scopeType === "site") {
        const [site] = await db
          .select({ id: sites.id })
          .from(sites)
          .where(and(eq(sites.id, input.scopeId), eq(sites.organizationId, input.organizationId)))
          .limit(1);
        if (!site)
          throw new TRPCError({ code: "NOT_FOUND", message: "Site not found in this company." });
      }
      const now = new Date();
      const reason = input.reason?.trim() || "Set on the access screen";
      await db.transaction(async (tx) => {
        const existing = (
          await lastingGrants(tx as unknown as Db, input.organizationId, input.userId)
        ).filter(
          (grant) =>
            keys.includes(grant.permissionKey) &&
            grant.scopeType === input.scopeType &&
            grant.scopeId === input.scopeId,
        );
        if (existing.length)
          await tx
            .update(permissionGrants)
            .set({ status: "Revoked", revokedBy: ctx.user.id, revokedAt: now })
            .where(
              inArray(
                permissionGrants.id,
                existing.map((grant) => grant.id),
              ),
            );
        if (input.choice !== "default")
          await tx.insert(permissionGrants).values(
            keys.map((permissionKey) => ({
              id: randomUUID(),
              organizationId: input.organizationId,
              userId: input.userId,
              scopeType: input.scopeType,
              scopeId: input.scopeId,
              permissionKey,
              effect: input.choice as "allow" | "deny",
              effectiveFrom: now,
              effectiveTo: null,
              grantedBy: ctx.user.id,
              reason: `Access: ${reason}`,
            })),
          );
        await tx.insert(auditEvents).values({
          id: randomUUID(),
          organizationId: input.organizationId,
          siteId: input.scopeType === "site" ? input.scopeId : null,
          actorUserId: ctx.user.id,
          action: "access.set",
          entityType: "user",
          entityId: String(input.userId),
          beforeSummary: JSON.stringify(
            existing.map((grant) => ({ key: grant.permissionKey, effect: grant.effect })),
          ),
          afterSummary: JSON.stringify({
            keys,
            choice: input.choice,
            scopeType: input.scopeType,
            scopeId: input.scopeId,
          }),
          reason,
        });
      });
      return { ok: true, changed: keys.length };
    }),
});
