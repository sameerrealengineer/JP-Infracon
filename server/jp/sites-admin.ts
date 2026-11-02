import { randomUUID } from "node:crypto";
import { and, asc, eq, gte, inArray, isNull, lte, or } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import {
  auditEvents,
  organizationMemberships,
  organizations,
  permissionGrants,
  projects,
  siteAssignments,
  siteGeofences,
  sites,
  users,
} from "../../drizzle/schema";
import { protectedProcedure, router } from "../_core/trpc";
import { getDb } from "../db";
import { assertActiveAccount, getSiteScope } from "./access";
import {
  resolveOrganizationPermission,
  type BusinessRole,
  type PermissionGrantForResolution,
} from "./policy";
import {
  isValidCode,
  normalizeCode,
  organizationWideRoles,
  siteAssignableRoles,
  siteStatuses,
  validateSiteAssignment,
  validateStatusChange,
  type PolicyError,
} from "../../lib/jp/site-admin-policy";

type Db = NonNullable<Awaited<ReturnType<typeof getDb>>>;
type User = Parameters<typeof assertActiveAccount>[0];

const mutationIdSchema = z.string().trim().min(16).max(64);
const codeSchema = z
  .string()
  .trim()
  .refine(isValidCode, "Use 2–32 letters, digits or hyphens, starting with a letter or digit.")
  .transform(normalizeCode);
const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .optional()
    .transform((value) => (value ? value : null));
const optionalDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD.")
  .optional()
  .or(z.literal("").transform(() => undefined));

function requireDb(db: Awaited<ReturnType<typeof getDb>>): Db {
  if (!db)
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message: "The business data service is temporarily unavailable.",
    });
  return db;
}

function fail(error: PolicyError | null) {
  if (error) throw new TRPCError({ code: error.code, message: error.message });
}

function isDuplicate(error: unknown) {
  const text =
    String((error as { code?: string; message?: string })?.code ?? "") +
    String((error as { message?: string })?.message ?? "");
  return /ER_DUP_ENTRY|Duplicate entry/i.test(text);
}

/** Owner/Director/Admin (or a matching org-scoped grant) and the platform Super Admin manage projects and sites. */
export async function assertSiteManager(
  user: User,
  organizationId: string,
): Promise<BusinessRole | "super_admin"> {
  assertActiveAccount(user);
  const db = requireDb(await getDb());
  const [organization] = await db
    .select({ id: organizations.id, status: organizations.status })
    .from(organizations)
    .where(eq(organizations.id, organizationId))
    .limit(1);
  if (!organization) throw new TRPCError({ code: "NOT_FOUND", message: "Organisation not found." });
  if (user.role === "super_admin") return "super_admin";
  const memberships = await db
    .select({ businessRole: organizationMemberships.businessRole })
    .from(organizationMemberships)
    .where(
      and(
        eq(organizationMemberships.organizationId, organizationId),
        eq(organizationMemberships.userId, user.id),
        eq(organizationMemberships.status, "Active"),
      ),
    );
  if (!memberships.length)
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "You are not a member of this organisation.",
    });
  const now = new Date();
  const grants = await db
    .select()
    .from(permissionGrants)
    .where(
      and(
        eq(permissionGrants.organizationId, organizationId),
        eq(permissionGrants.userId, user.id),
        eq(permissionGrants.permissionKey, "site.manage"),
      ),
    );
  const allowed = memberships.find((membership) =>
    resolveOrganizationPermission({
      role: membership.businessRole as BusinessRole,
      permissionKey: "site.manage",
      organizationId,
      grants: grants as PermissionGrantForResolution[],
      now,
    }),
  );
  if (!allowed)
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "Your organisation role does not include project and site management.",
    });
  return allowed.businessRole as BusinessRole;
}

async function priorMutation(db: Db, actorUserId: number, clientMutationId: string) {
  const [row] = await db
    .select({ entityId: auditEvents.entityId, action: auditEvents.action })
    .from(auditEvents)
    .where(
      and(
        eq(auditEvents.actorUserId, actorUserId),
        eq(auditEvents.clientMutationId, clientMutationId),
      ),
    )
    .limit(1);
  return row ?? null;
}

async function audit(
  tx: any,
  values: {
    organizationId: string;
    siteId?: string | null;
    actorUserId: number;
    action: string;
    entityType: string;
    entityId: string;
    clientMutationId: string;
    beforeSummary?: string;
    afterSummary?: string;
    reason?: string | null;
  },
) {
  await tx
    .insert(auditEvents)
    .values({ id: randomUUID(), ...values, reason: values.reason ?? null });
}

async function loadProject(db: Db, projectId: string) {
  const [project] = await db.select().from(projects).where(eq(projects.id, projectId)).limit(1);
  if (!project) throw new TRPCError({ code: "NOT_FOUND", message: "Project not found." });
  return project;
}
async function loadSite(db: Db, siteId: string) {
  const [site] = await db.select().from(sites).where(eq(sites.id, siteId)).limit(1);
  if (!site) throw new TRPCError({ code: "NOT_FOUND", message: "Site not found." });
  return site;
}

const projectFields = {
  name: z.string().trim().min(2).max(180),
  clientDepartment: optionalText(180),
  projectType: optionalText(64),
  startDate: optionalDate,
  targetEndDate: optionalDate,
};
const siteFields = {
  name: z.string().trim().min(2).max(180),
  address: optionalText(1000),
  village: optionalText(120),
  district: optionalText(120),
  state: optionalText(120),
};

function checkDates(start?: string, end?: string) {
  if (start && end && end < start)
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "The target end date is before the start date.",
    });
}

export const sitesAdminRouter = router({
  /** Organisations, projects and sites the caller may administer. Empty for site-level roles. */
  overview: protectedProcedure.query(async ({ ctx }) => {
    assertActiveAccount(ctx.user);
    const db = requireDb(await getDb());
    const candidateOrgs =
      ctx.user.role === "super_admin"
        ? await db
            .select({ id: organizations.id, name: organizations.name, code: organizations.code })
            .from(organizations)
            .where(eq(organizations.status, "Active"))
            .limit(100)
        : await db
            .selectDistinct({
              id: organizations.id,
              name: organizations.name,
              code: organizations.code,
            })
            .from(organizationMemberships)
            .innerJoin(organizations, eq(organizationMemberships.organizationId, organizations.id))
            .where(
              and(
                eq(organizationMemberships.userId, ctx.user.id),
                eq(organizationMemberships.status, "Active"),
                eq(organizations.status, "Active"),
              ),
            );
    const managed = [];
    for (const organization of candidateOrgs) {
      try {
        await assertSiteManager(ctx.user, organization.id);
        managed.push(organization);
      } catch {
        /* not a manager here */
      }
    }
    if (!managed.length) return [];
    const ids = managed.map((organization) => organization.id);
    const projectRows = await db
      .select()
      .from(projects)
      .where(inArray(projects.organizationId, ids))
      .orderBy(asc(projects.name))
      .limit(500);
    const siteRows = await db
      .select()
      .from(sites)
      .where(inArray(sites.organizationId, ids))
      .orderBy(asc(sites.name))
      .limit(2000);
    return managed.map((organization) => ({
      ...organization,
      projects: projectRows
        .filter((project) => project.organizationId === organization.id)
        .map((project) => ({
          id: project.id,
          code: project.projectCode,
          name: project.name,
          clientDepartment: project.clientDepartment,
          projectType: project.projectType,
          startDate: project.startDate,
          targetEndDate: project.targetEndDate,
          status: project.status,
          sites: siteRows
            .filter((site) => site.projectId === project.id)
            .map((site) => ({
              id: site.id,
              code: site.siteCode,
              name: site.name,
              status: site.status,
            })),
        })),
    }));
  }),

  createProject: protectedProcedure
    .input(
      z.object({
        organizationId: z.string().uuid(),
        projectCode: codeSchema,
        ...projectFields,
        clientMutationId: mutationIdSchema,
      }),
    )
    .mutation(async ({ ctx, input }) => {
      await assertSiteManager(ctx.user, input.organizationId);
      checkDates(input.startDate, input.targetEndDate);
      const db = requireDb(await getDb());
      const prior = await priorMutation(db, ctx.user.id, input.clientMutationId);
      if (prior) return { id: prior.entityId };
      const id = randomUUID();
      try {
        await db.transaction(async (tx) => {
          await tx.insert(projects).values({
            id,
            organizationId: input.organizationId,
            projectCode: input.projectCode,
            name: input.name,
            clientDepartment: input.clientDepartment,
            projectType: input.projectType,
            startDate: input.startDate ?? null,
            targetEndDate: input.targetEndDate ?? null,
            createdBy: ctx.user.id,
          });
          await audit(tx, {
            organizationId: input.organizationId,
            actorUserId: ctx.user.id,
            action: "project.created",
            entityType: "project",
            entityId: id,
            clientMutationId: input.clientMutationId,
            afterSummary: JSON.stringify({ code: input.projectCode, name: input.name }),
          });
        });
      } catch (error) {
        if (isDuplicate(error))
          throw new TRPCError({
            code: "CONFLICT",
            message: "A project with this code already exists.",
          });
        throw error;
      }
      return { id };
    }),

  updateProject: protectedProcedure
    .input(
      z.object({
        projectId: z.string().uuid(),
        ...projectFields,
        clientMutationId: mutationIdSchema,
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const db = requireDb(await getDb());
      const project = await loadProject(db, input.projectId);
      await assertSiteManager(ctx.user, project.organizationId);
      checkDates(input.startDate, input.targetEndDate);
      const prior = await priorMutation(db, ctx.user.id, input.clientMutationId);
      if (prior) return { id: prior.entityId };
      await db.transaction(async (tx) => {
        const [locked] = await tx
          .select()
          .from(projects)
          .where(eq(projects.id, project.id))
          .for("update");
        const next = {
          name: input.name,
          clientDepartment: input.clientDepartment,
          projectType: input.projectType,
          startDate: input.startDate ?? null,
          targetEndDate: input.targetEndDate ?? null,
        };
        await tx.update(projects).set(next).where(eq(projects.id, project.id));
        await audit(tx, {
          organizationId: project.organizationId,
          actorUserId: ctx.user.id,
          action: "project.updated",
          entityType: "project",
          entityId: project.id,
          clientMutationId: input.clientMutationId,
          beforeSummary: JSON.stringify({
            name: locked.name,
            clientDepartment: locked.clientDepartment,
            projectType: locked.projectType,
            startDate: locked.startDate,
            targetEndDate: locked.targetEndDate,
          }),
          afterSummary: JSON.stringify(next),
        });
      });
      return { id: project.id };
    }),

  setProjectStatus: protectedProcedure
    .input(
      z.object({
        projectId: z.string().uuid(),
        status: z.enum(siteStatuses),
        reason: z.string().trim().max(1000),
        clientMutationId: mutationIdSchema,
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const db = requireDb(await getDb());
      const project = await loadProject(db, input.projectId);
      await assertSiteManager(ctx.user, project.organizationId);
      const prior = await priorMutation(db, ctx.user.id, input.clientMutationId);
      if (prior) return { id: prior.entityId };
      await db.transaction(async (tx) => {
        const [locked] = await tx
          .select()
          .from(projects)
          .where(eq(projects.id, project.id))
          .for("update");
        fail(validateStatusChange(locked.status, input.status, input.reason));
        await tx.update(projects).set({ status: input.status }).where(eq(projects.id, project.id));
        await audit(tx, {
          organizationId: project.organizationId,
          actorUserId: ctx.user.id,
          action: "project.status_changed",
          entityType: "project",
          entityId: project.id,
          clientMutationId: input.clientMutationId,
          beforeSummary: JSON.stringify({ status: locked.status }),
          afterSummary: JSON.stringify({ status: input.status }),
          reason: input.reason,
        });
      });
      return { id: project.id };
    }),

  createSite: protectedProcedure
    .input(
      z.object({
        projectId: z.string().uuid(),
        siteCode: codeSchema,
        ...siteFields,
        clientMutationId: mutationIdSchema,
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const db = requireDb(await getDb());
      const project = await loadProject(db, input.projectId);
      await assertSiteManager(ctx.user, project.organizationId);
      if (project.status !== "Active")
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message: "Sites can only be added to an active project.",
        });
      const prior = await priorMutation(db, ctx.user.id, input.clientMutationId);
      if (prior) return { id: prior.entityId };
      const id = randomUUID();
      try {
        await db.transaction(async (tx) => {
          await tx.insert(sites).values({
            id,
            organizationId: project.organizationId,
            projectId: project.id,
            siteCode: input.siteCode,
            name: input.name,
            address: input.address,
            village: input.village,
            district: input.district,
            state: input.state,
            createdBy: ctx.user.id,
          });
          await audit(tx, {
            organizationId: project.organizationId,
            siteId: id,
            actorUserId: ctx.user.id,
            action: "site.created",
            entityType: "site",
            entityId: id,
            clientMutationId: input.clientMutationId,
            afterSummary: JSON.stringify({
              code: input.siteCode,
              name: input.name,
              projectId: project.id,
            }),
          });
        });
      } catch (error) {
        if (isDuplicate(error))
          throw new TRPCError({
            code: "CONFLICT",
            message: "A site with this code already exists.",
          });
        throw error;
      }
      return { id };
    }),

  updateSite: protectedProcedure
    .input(
      z.object({ siteId: z.string().uuid(), ...siteFields, clientMutationId: mutationIdSchema }),
    )
    .mutation(async ({ ctx, input }) => {
      const db = requireDb(await getDb());
      const site = await loadSite(db, input.siteId);
      await assertSiteManager(ctx.user, site.organizationId);
      const prior = await priorMutation(db, ctx.user.id, input.clientMutationId);
      if (prior) return { id: prior.entityId };
      await db.transaction(async (tx) => {
        const [locked] = await tx.select().from(sites).where(eq(sites.id, site.id)).for("update");
        const next = {
          name: input.name,
          address: input.address,
          village: input.village,
          district: input.district,
          state: input.state,
        };
        await tx.update(sites).set(next).where(eq(sites.id, site.id));
        await audit(tx, {
          organizationId: site.organizationId,
          siteId: site.id,
          actorUserId: ctx.user.id,
          action: "site.updated",
          entityType: "site",
          entityId: site.id,
          clientMutationId: input.clientMutationId,
          beforeSummary: JSON.stringify({
            name: locked.name,
            address: locked.address,
            village: locked.village,
            district: locked.district,
            state: locked.state,
          }),
          afterSummary: JSON.stringify(next),
        });
      });
      return { id: site.id };
    }),

  setSiteStatus: protectedProcedure
    .input(
      z.object({
        siteId: z.string().uuid(),
        status: z.enum(siteStatuses),
        reason: z.string().trim().max(1000),
        clientMutationId: mutationIdSchema,
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const db = requireDb(await getDb());
      const site = await loadSite(db, input.siteId);
      await assertSiteManager(ctx.user, site.organizationId);
      const prior = await priorMutation(db, ctx.user.id, input.clientMutationId);
      if (prior) return { id: prior.entityId };
      await db.transaction(async (tx) => {
        const [locked] = await tx.select().from(sites).where(eq(sites.id, site.id)).for("update");
        fail(validateStatusChange(locked.status, input.status, input.reason));
        if (input.status === "Active") {
          const [project] = await tx
            .select({ status: projects.status })
            .from(projects)
            .where(eq(projects.id, locked.projectId));
          if (project?.status !== "Active")
            throw new TRPCError({
              code: "PRECONDITION_FAILED",
              message: "Reactivate the project before its sites.",
            });
        }
        await tx.update(sites).set({ status: input.status }).where(eq(sites.id, site.id));
        await audit(tx, {
          organizationId: site.organizationId,
          siteId: site.id,
          actorUserId: ctx.user.id,
          action: "site.status_changed",
          entityType: "site",
          entityId: site.id,
          clientMutationId: input.clientMutationId,
          beforeSummary: JSON.stringify({ status: locked.status }),
          afterSummary: JSON.stringify({ status: input.status }),
          reason: input.reason,
        });
      });
      return { id: site.id };
    }),

  /** Site profile and team. Anyone with site.view can read it; manage actions are flagged by `canManage`. */
  siteDetail: protectedProcedure
    .input(z.object({ siteId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const scope = await getSiteScope(ctx.user, input.siteId, "site.view");
      const db = requireDb(await getDb());
      const site = await loadSite(db, input.siteId);
      const project = await loadProject(db, site.projectId);
      let canManage = false;
      try {
        await assertSiteManager(ctx.user, site.organizationId);
        canManage = true;
      } catch {
        canManage = false;
      }
      const now = new Date();
      const team = await db
        .select({
          assignmentId: siteAssignments.id,
          userId: users.id,
          name: users.name,
          role: siteAssignments.assignmentRole,
          since: siteAssignments.effectiveFrom,
        })
        .from(siteAssignments)
        .innerJoin(users, eq(siteAssignments.userId, users.id))
        .where(
          and(
            eq(siteAssignments.siteId, site.id),
            eq(siteAssignments.status, "Active"),
            lte(siteAssignments.effectiveFrom, now),
            or(isNull(siteAssignments.effectiveTo), gte(siteAssignments.effectiveTo, now)),
          ),
        )
        .orderBy(asc(users.name))
        .limit(300);
      const leaders = await db
        .select({ userId: users.id, name: users.name, role: organizationMemberships.businessRole })
        .from(organizationMemberships)
        .innerJoin(users, eq(organizationMemberships.userId, users.id))
        .where(
          and(
            eq(organizationMemberships.organizationId, site.organizationId),
            eq(organizationMemberships.status, "Active"),
            inArray(organizationMemberships.businessRole, [...organizationWideRoles]),
          ),
        )
        .limit(50);
      let geofence: { latitude: number; longitude: number; radiusM: number } | null = null;
      try {
        const [fence] = await db
          .select()
          .from(siteGeofences)
          .where(eq(siteGeofences.siteId, site.id))
          .limit(1);
        if (fence)
          geofence = {
            latitude: Number(fence.latitude),
            longitude: Number(fence.longitude),
            radiusM: fence.radiusM,
          };
      } catch {
        geofence = null; // Table not migrated yet.
      }
      return {
        geofence,
        site: {
          id: site.id,
          code: site.siteCode,
          name: site.name,
          address: site.address,
          village: site.village,
          district: site.district,
          state: site.state,
          status: site.status,
          createdAt: site.createdAt,
          updatedAt: site.updatedAt,
        },
        project: {
          id: project.id,
          code: project.projectCode,
          name: project.name,
          clientDepartment: project.clientDepartment,
          projectType: project.projectType,
          startDate: project.startDate,
          targetEndDate: project.targetEndDate,
          status: project.status,
        },
        myRole: scope.businessRole,
        canManage,
        // Owner-level users are not shown as removable site team members.
        team: team.filter((member) => !leaders.some((leader) => leader.userId === member.userId)),
        leaders,
      };
    }),

  assignmentCandidates: protectedProcedure
    .input(z.object({ siteId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const db = requireDb(await getDb());
      const site = await loadSite(db, input.siteId);
      await assertSiteManager(ctx.user, site.organizationId);
      const members = await db
        .select({
          userId: users.id,
          name: users.name,
          role: organizationMemberships.businessRole,
          accountStatus: users.accountStatus,
        })
        .from(organizationMemberships)
        .innerJoin(users, eq(organizationMemberships.userId, users.id))
        .where(
          and(
            eq(organizationMemberships.organizationId, site.organizationId),
            eq(organizationMemberships.status, "Active"),
          ),
        )
        .orderBy(asc(users.name))
        .limit(500);
      const assigned = await db
        .select({ userId: siteAssignments.userId })
        .from(siteAssignments)
        .where(and(eq(siteAssignments.siteId, site.id), eq(siteAssignments.status, "Active")));
      const assignedIds = new Set(assigned.map((row) => row.userId));
      const broad = new Set(
        members
          .filter((m) => (organizationWideRoles as readonly string[]).includes(m.role))
          .map((m) => m.userId),
      );
      const byUser = new Map<number, { userId: number; name: string | null; roles: string[] }>();
      for (const member of members) {
        if (
          member.accountStatus !== "Active" ||
          broad.has(member.userId) ||
          assignedIds.has(member.userId)
        )
          continue;
        const entry = byUser.get(member.userId) ?? {
          userId: member.userId,
          name: member.name,
          roles: [],
        };
        entry.roles.push(member.role);
        byUser.set(member.userId, entry);
      }
      return [...byUser.values()];
    }),

  assignMember: protectedProcedure
    .input(
      z.object({
        siteId: z.string().uuid(),
        userId: z.number().int().positive(),
        role: z.enum(siteAssignableRoles),
        clientMutationId: mutationIdSchema,
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const db = requireDb(await getDb());
      const site = await loadSite(db, input.siteId);
      await assertSiteManager(ctx.user, site.organizationId);
      if (site.status !== "Active")
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message: "People can only be assigned to an active site.",
        });
      const prior = await priorMutation(db, ctx.user.id, input.clientMutationId);
      if (prior) return { id: prior.entityId };
      const id = randomUUID();
      await db.transaction(async (tx) => {
        await tx.select({ id: sites.id }).from(sites).where(eq(sites.id, site.id)).for("update");
        const memberRows = await tx
          .select({
            role: organizationMemberships.businessRole,
            status: organizationMemberships.status,
          })
          .from(organizationMemberships)
          .where(
            and(
              eq(organizationMemberships.organizationId, site.organizationId),
              eq(organizationMemberships.userId, input.userId),
            ),
          );
        const [target] = await tx
          .select({ accountStatus: users.accountStatus, name: users.name })
          .from(users)
          .where(eq(users.id, input.userId));
        const active = memberRows.filter((row) => row.status === "Active");
        const existing = await tx
          .select({ id: siteAssignments.id })
          .from(siteAssignments)
          .where(
            and(
              eq(siteAssignments.siteId, site.id),
              eq(siteAssignments.userId, input.userId),
              eq(siteAssignments.status, "Active"),
            ),
          );
        fail(
          validateSiteAssignment({
            memberRoles: active.map((row) => row.role),
            memberActive: active.length > 0 && target?.accountStatus === "Active",
            role: input.role,
            alreadyAssigned: existing.length > 0,
          }),
        );
        await tx.insert(siteAssignments).values({
          id,
          siteId: site.id,
          userId: input.userId,
          assignmentRole: input.role,
          status: "Active",
          assignedBy: ctx.user.id,
        });
        await audit(tx, {
          organizationId: site.organizationId,
          siteId: site.id,
          actorUserId: ctx.user.id,
          action: "site.member_assigned",
          entityType: "site_assignment",
          entityId: id,
          clientMutationId: input.clientMutationId,
          afterSummary: JSON.stringify({
            userId: input.userId,
            name: target?.name ?? null,
            role: input.role,
          }),
        });
      });
      return { id };
    }),

  revokeAssignment: protectedProcedure
    .input(
      z.object({
        assignmentId: z.string().uuid(),
        reason: z.string().trim().min(3, "Enter a reason for removing this person.").max(1000),
        clientMutationId: mutationIdSchema,
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const db = requireDb(await getDb());
      const [assignment] = await db
        .select({ id: siteAssignments.id, siteId: siteAssignments.siteId })
        .from(siteAssignments)
        .where(eq(siteAssignments.id, input.assignmentId))
        .limit(1);
      if (!assignment) throw new TRPCError({ code: "NOT_FOUND", message: "Assignment not found." });
      const site = await loadSite(db, assignment.siteId);
      await assertSiteManager(ctx.user, site.organizationId);
      const prior = await priorMutation(db, ctx.user.id, input.clientMutationId);
      if (prior) return { id: prior.entityId };
      await db.transaction(async (tx) => {
        const [locked] = await tx
          .select()
          .from(siteAssignments)
          .where(eq(siteAssignments.id, assignment.id))
          .for("update");
        if (locked.status !== "Active")
          throw new TRPCError({
            code: "CONFLICT",
            message: "This assignment has already been removed.",
          });
        if (locked.userId === ctx.user.id)
          throw new TRPCError({
            code: "FORBIDDEN",
            message: "You cannot remove your own site assignment.",
          });
        await tx
          .update(siteAssignments)
          .set({ status: "Revoked", effectiveTo: new Date() })
          .where(eq(siteAssignments.id, assignment.id));
        await audit(tx, {
          organizationId: site.organizationId,
          siteId: site.id,
          actorUserId: ctx.user.id,
          action: "site.member_removed",
          entityType: "site_assignment",
          entityId: assignment.id,
          clientMutationId: input.clientMutationId,
          beforeSummary: JSON.stringify({
            userId: locked.userId,
            role: locked.assignmentRole,
            status: "Active",
          }),
          afterSummary: JSON.stringify({ status: "Revoked" }),
          reason: input.reason,
        });
      });
      return { id: assignment.id };
    }),

  /** Records the site boundary used for GPS photos and arrival/departure alerts. */
  setGeofence: protectedProcedure
    .input(
      z.object({
        siteId: z.string().uuid(),
        latitude: z.number().min(-90).max(90),
        longitude: z.number().min(-180).max(180),
        radiusM: z.number().int().min(50).max(5000),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const db = requireDb(await getDb());
      const site = await loadSite(db, input.siteId);
      await assertSiteManager(ctx.user, site.organizationId);
      const values = {
        latitude: input.latitude.toFixed(6),
        longitude: input.longitude.toFixed(6),
        radiusM: input.radiusM,
        setBy: ctx.user.id,
      };
      await db.transaction(async (tx) => {
        await tx
          .insert(siteGeofences)
          .values({ siteId: site.id, ...values })
          .onDuplicateKeyUpdate({ set: values });
        await tx.insert(auditEvents).values({
          id: randomUUID(),
          organizationId: site.organizationId,
          siteId: site.id,
          actorUserId: ctx.user.id,
          action: "site.geofence_set",
          entityType: "site",
          entityId: site.id,
          afterSummary: JSON.stringify({ radiusM: input.radiusM }),
        });
      });
      return { ok: true };
    }),
});
