import { randomUUID } from "node:crypto";
import { and, desc, eq, gte, inArray, isNull, or } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import {
  auditEvents,
  delegationGrants,
  delegations,
  organizationMemberships,
  permissionGrants,
  projects,
  siteAssignments,
  sites,
  users,
} from "../../drizzle/schema";
import { protectedProcedure, router } from "../_core/trpc";
import { getDb } from "../db";
import { assertActiveAccount } from "./access";
import { assertSiteManager } from "./sites-admin";
import { dispatchAlert } from "./notify";
import {
  delegationBundleIds,
  delegationDurations,
  delegationEnd,
  delegationKeys,
  delegationState,
  type DelegationBundle,
} from "../../lib/jp/delegation-policy";

function requireDb(db: Awaited<ReturnType<typeof getDb>>) {
  if (!db)
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message: "The business data service is temporarily unavailable.",
    });
  return db;
}

const durationIds = Object.keys(delegationDurations) as [keyof typeof delegationDurations];

export const delegationRouter = router({
  /** Delegations in organisations the caller administers. */
  list: protectedProcedure
    .input(z.object({ organizationId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      await assertSiteManager(ctx.user, input.organizationId);
      const db = requireDb(await getDb());
      const since = new Date(Date.now() - 30 * 86_400_000);
      const rows = await db
        .select({
          id: delegations.id,
          userId: delegations.userId,
          userName: users.name,
          scopeType: delegations.scopeType,
          scopeId: delegations.scopeId,
          bundles: delegations.bundles,
          reason: delegations.reason,
          effectiveFrom: delegations.effectiveFrom,
          effectiveTo: delegations.effectiveTo,
          status: delegations.status,
          revokedAt: delegations.revokedAt,
          createdAt: delegations.createdAt,
        })
        .from(delegations)
        .innerJoin(users, eq(delegations.userId, users.id))
        .where(
          and(
            eq(delegations.organizationId, input.organizationId),
            or(isNull(delegations.effectiveTo), gte(delegations.effectiveTo, since)),
          ),
        )
        .orderBy(desc(delegations.createdAt))
        .limit(200);
      const siteRows = await db
        .select({ id: sites.id, name: sites.name })
        .from(sites)
        .where(eq(sites.organizationId, input.organizationId));
      const projectRows = await db
        .select({ id: projects.id, name: projects.name })
        .from(projects)
        .where(eq(projects.organizationId, input.organizationId));
      return rows.map((row) => ({
        ...row,
        bundles: row.bundles.split(",") as DelegationBundle[],
        scopeName:
          (row.scopeType === "site" ? siteRows : projectRows).find(
            (item) => item.id === row.scopeId,
          )?.name ?? "Unknown",
        state: delegationState(row),
      }));
    }),

  /** People in the organisation who can receive a delegation, with their assigned sites. */
  candidates: protectedProcedure
    .input(z.object({ organizationId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      await assertSiteManager(ctx.user, input.organizationId);
      const db = requireDb(await getDb());
      const members = await db
        .select({ userId: users.id, name: users.name, role: organizationMemberships.businessRole })
        .from(organizationMemberships)
        .innerJoin(users, eq(organizationMemberships.userId, users.id))
        .where(
          and(
            eq(organizationMemberships.organizationId, input.organizationId),
            eq(organizationMemberships.status, "Active"),
            eq(users.accountStatus, "Active"),
          ),
        )
        .limit(500);
      const assignments = await db
        .select({
          userId: siteAssignments.userId,
          siteId: sites.id,
          siteName: sites.name,
          projectId: sites.projectId,
        })
        .from(siteAssignments)
        .innerJoin(sites, eq(siteAssignments.siteId, sites.id))
        .where(
          and(eq(sites.organizationId, input.organizationId), eq(siteAssignments.status, "Active")),
        );
      const projectRows = await db
        .select({ id: projects.id, name: projects.name })
        .from(projects)
        .where(eq(projects.organizationId, input.organizationId));
      const byUser = new Map<number, { userId: number; name: string | null; roles: string[] }>();
      for (const member of members) {
        if (member.userId === ctx.user.id) continue;
        const entry = byUser.get(member.userId) ?? {
          userId: member.userId,
          name: member.name,
          roles: [],
        };
        entry.roles.push(member.role);
        byUser.set(member.userId, entry);
      }
      return [...byUser.values()].map((person) => {
        const mine = assignments.filter((row) => row.userId === person.userId);
        return {
          ...person,
          sites: mine.map((row) => ({ id: row.siteId, name: row.siteName })),
          projects: [...new Set(mine.map((row) => row.projectId))].map((id) => ({
            id,
            name: projectRows.find((project) => project.id === id)?.name ?? "Project",
          })),
        };
      });
    }),

  create: protectedProcedure
    .input(
      z.object({
        organizationId: z.string().uuid(),
        userId: z.number().int().positive(),
        scopeType: z.enum(["project", "site"]),
        scopeId: z.string().uuid(),
        bundles: z.array(z.enum(delegationBundleIds as [DelegationBundle])).min(1),
        duration: z.enum(durationIds),
        reason: z.string().trim().min(3).max(500),
        clientMutationId: z.string().trim().min(16).max(64),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      assertActiveAccount(ctx.user);
      await assertSiteManager(ctx.user, input.organizationId);
      if (input.userId === ctx.user.id)
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "You cannot delegate authority to yourself.",
        });
      const db = requireDb(await getDb());
      const [existing] = await db
        .select({ id: delegations.id })
        .from(delegations)
        .where(eq(delegations.clientMutationId, input.clientMutationId))
        .limit(1);
      if (existing) return { id: existing.id };
      // The person must work in this organisation and on the chosen site or project.
      const [member] = await db
        .select({ id: organizationMemberships.id })
        .from(organizationMemberships)
        .innerJoin(users, eq(organizationMemberships.userId, users.id))
        .where(
          and(
            eq(organizationMemberships.organizationId, input.organizationId),
            eq(organizationMemberships.userId, input.userId),
            eq(organizationMemberships.status, "Active"),
            eq(users.accountStatus, "Active"),
          ),
        )
        .limit(1);
      if (!member)
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "This person is not an active member.",
        });
      const scopeSites =
        input.scopeType === "site"
          ? await db
              .select({ id: sites.id })
              .from(sites)
              .where(
                and(eq(sites.id, input.scopeId), eq(sites.organizationId, input.organizationId)),
              )
          : await db
              .select({ id: sites.id })
              .from(sites)
              .where(
                and(
                  eq(sites.projectId, input.scopeId),
                  eq(sites.organizationId, input.organizationId),
                ),
              );
      if (!scopeSites.length)
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Choose a site or project in this organisation.",
        });
      const assigned = await db
        .select({ siteId: siteAssignments.siteId })
        .from(siteAssignments)
        .where(
          and(
            eq(siteAssignments.userId, input.userId),
            eq(siteAssignments.status, "Active"),
            inArray(
              siteAssignments.siteId,
              scopeSites.map((row) => row.id),
            ),
          ),
        )
        .limit(1);
      const [broad] = await db
        .select({ id: organizationMemberships.id })
        .from(organizationMemberships)
        .where(
          and(
            eq(organizationMemberships.organizationId, input.organizationId),
            eq(organizationMemberships.userId, input.userId),
            eq(organizationMemberships.status, "Active"),
            inArray(organizationMemberships.businessRole, ["owner", "director", "admin"]),
          ),
        )
        .limit(1);
      if (!assigned.length && !broad)
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message:
            "Assign this person to the site first; authority can only be delegated where they work.",
        });
      const now = new Date();
      const end = delegationEnd(input.duration, now);
      const id = randomUUID();
      const keys = delegationKeys(input.bundles);
      await db.transaction(async (tx) => {
        await tx.insert(delegations).values({
          id,
          organizationId: input.organizationId,
          userId: input.userId,
          scopeType: input.scopeType,
          scopeId: input.scopeId,
          bundles: input.bundles.join(","),
          reason: input.reason,
          effectiveFrom: now,
          effectiveTo: end,
          grantedBy: ctx.user.id,
          clientMutationId: input.clientMutationId,
        });
        for (const permissionKey of keys) {
          const grantId = randomUUID();
          await tx.insert(permissionGrants).values({
            id: grantId,
            organizationId: input.organizationId,
            userId: input.userId,
            scopeType: input.scopeType,
            scopeId: input.scopeId,
            permissionKey,
            effect: "allow",
            effectiveFrom: now,
            effectiveTo: end,
            grantedBy: ctx.user.id,
            reason: `Delegation: ${input.reason}`,
          });
          await tx.insert(delegationGrants).values({ delegationId: id, grantId });
        }
        await tx.insert(auditEvents).values({
          id: randomUUID(),
          organizationId: input.organizationId,
          siteId: input.scopeType === "site" ? input.scopeId : null,
          actorUserId: ctx.user.id,
          action: "delegation.granted",
          entityType: "delegation",
          entityId: id,
          clientMutationId: input.clientMutationId,
          afterSummary: JSON.stringify({
            userId: input.userId,
            scopeType: input.scopeType,
            scopeId: input.scopeId,
            bundles: input.bundles,
            effectiveTo: end?.toISOString() ?? null,
          }),
          reason: input.reason,
        });
      });
      void dispatchAlert({
        organizationId: input.organizationId,
        siteId: input.scopeType === "site" ? input.scopeId : null,
        kind: "delegation.granted",
        title: "You have been given temporary authority",
        detail: input.reason,
        route: "/",
        recipientUserIds: [input.userId],
      });
      return { id };
    }),

  revoke: protectedProcedure
    .input(
      z.object({
        delegationId: z.string().uuid(),
        reason: z.string().trim().min(3).max(500),
        clientMutationId: z.string().trim().min(16).max(64),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const db = requireDb(await getDb());
      const [row] = await db
        .select()
        .from(delegations)
        .where(eq(delegations.id, input.delegationId))
        .limit(1);
      if (!row) throw new TRPCError({ code: "NOT_FOUND", message: "Delegation not found." });
      await assertSiteManager(ctx.user, row.organizationId);
      if (row.status === "Revoked") return { id: row.id };
      const now = new Date();
      await db.transaction(async (tx) => {
        await tx
          .select({ id: delegations.id })
          .from(delegations)
          .where(eq(delegations.id, row.id))
          .for("update");
        const links = await tx
          .select({ grantId: delegationGrants.grantId })
          .from(delegationGrants)
          .where(eq(delegationGrants.delegationId, row.id));
        if (links.length)
          await tx
            .update(permissionGrants)
            .set({ status: "Revoked", revokedBy: ctx.user.id, revokedAt: now })
            .where(
              inArray(
                permissionGrants.id,
                links.map((link) => link.grantId),
              ),
            );
        await tx
          .update(delegations)
          .set({
            status: "Revoked",
            revokedBy: ctx.user.id,
            revokedAt: now,
            revokeReason: input.reason,
          })
          .where(eq(delegations.id, row.id));
        await tx.insert(auditEvents).values({
          id: randomUUID(),
          organizationId: row.organizationId,
          siteId: row.scopeType === "site" ? row.scopeId : null,
          actorUserId: ctx.user.id,
          action: "delegation.revoked",
          entityType: "delegation",
          entityId: row.id,
          clientMutationId: input.clientMutationId,
          reason: input.reason,
        });
      });
      return { id: row.id };
    }),

  /** Authority currently delegated to the signed-in person (shown as a banner). */
  mine: protectedProcedure.query(async ({ ctx }) => {
    const db = requireDb(await getDb());
    try {
      const rows = await db
        .select({
          id: delegations.id,
          scopeType: delegations.scopeType,
          scopeId: delegations.scopeId,
          bundles: delegations.bundles,
          effectiveFrom: delegations.effectiveFrom,
          effectiveTo: delegations.effectiveTo,
          status: delegations.status,
          grantedByName: users.name,
        })
        .from(delegations)
        .innerJoin(users, eq(delegations.grantedBy, users.id))
        .where(and(eq(delegations.userId, ctx.user.id), eq(delegations.status, "Active")))
        .limit(20);
      return rows
        .filter((row) => delegationState(row) === "Active")
        .map((row) => ({ ...row, bundles: row.bundles.split(",") as DelegationBundle[] }));
    } catch {
      return []; // Table not migrated yet.
    }
  }),
});
