import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import {
  auditEvents,
  organizationMemberships,
  projectAssignments,
  projects,
  users,
} from "../../drizzle/schema";
import {
  companyWideRoles,
  mayManageRole,
  rolesAssignableBy,
} from "../../lib/jp/account-role-policy";
import { protectedProcedure, router } from "../_core/trpc";
import { getDb } from "../db";
import { accountManagerScope } from "./accounts";
import { activeProjectRoles, getAccessibleSites } from "./access";
import type { BusinessRole } from "./policy";

function requireDb(db: Awaited<ReturnType<typeof getDb>>) {
  if (!db)
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message: "The business data service is temporarily unavailable.",
    });
  return db;
}

async function loadProject(projectId: string) {
  const db = requireDb(await getDb());
  const [project] = await db.select().from(projects).where(eq(projects.id, projectId)).limit(1);
  if (!project) throw new TRPCError({ code: "NOT_FOUND", message: "Project not found." });
  return { db, project };
}

/**
 * Who manages the project team: company leaders, or the project's own Project Manager (a
 * project assignment as project_manager), giving only roles below their own. Site-level people
 * (engineers, supervisors) never widen anyone's access to a whole project.
 */
async function teamManager(
  user: Parameters<typeof accountManagerScope>[0],
  project: { id: string; organizationId: string },
) {
  const scope = await accountManagerScope(user, project.organizationId);
  if (scope.siteIds) {
    const db = requireDb(await getDb());
    const own = await activeProjectRoles(db, user.id, [project.id]);
    if (!own.some((row) => row.role === "project_manager"))
      throw new TRPCError({
        code: "FORBIDDEN",
        message: "Only company leaders or this project's Project Manager can change its team.",
      });
  }
  return scope;
}

/**
 * Project teams: people on a whole project with a role, seeing every site of it, including
 * sites added later. Changes take effect at once and are audited.
 */
export const projectTeamRouter = router({
  list: protectedProcedure
    .input(z.object({ projectId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const { db, project } = await loadProject(input.projectId);
      const sitesSeen = await getAccessibleSites(ctx.user);
      if (!sitesSeen.some((site) => site.projectId === project.id))
        throw new TRPCError({ code: "FORBIDDEN", message: "This project is outside your access." });
      let canManage = false;
      let assignable: readonly string[] = [];
      try {
        const scope = await teamManager(ctx.user, project);
        canManage = true;
        assignable = rolesAssignableBy(scope.managerRole).filter(
          (role) => !companyWideRoles.includes(role as BusinessRole),
        );
      } catch {
        canManage = false;
      }
      const rows = await db
        .select({
          id: projectAssignments.id,
          userId: projectAssignments.userId,
          role: projectAssignments.role,
          status: projectAssignments.status,
          name: users.name,
        })
        .from(projectAssignments)
        .innerJoin(users, eq(projectAssignments.userId, users.id))
        .where(
          and(
            eq(projectAssignments.projectId, project.id),
            eq(projectAssignments.status, "Active"),
          ),
        );
      const candidates = canManage
        ? await db
            .select({
              userId: organizationMemberships.userId,
              name: users.name,
              role: organizationMemberships.businessRole,
            })
            .from(organizationMemberships)
            .innerJoin(users, eq(organizationMemberships.userId, users.id))
            .where(
              and(
                eq(organizationMemberships.organizationId, project.organizationId),
                eq(organizationMemberships.status, "Active"),
              ),
            )
        : [];
      return {
        projectName: project.name,
        canManage,
        assignableRoles: assignable,
        members: rows,
        candidates: candidates.filter(
          (row) =>
            !companyWideRoles.includes(row.role as BusinessRole) &&
            !rows.some((m) => m.userId === row.userId),
        ),
      };
    }),

  assign: protectedProcedure
    .input(
      z.object({
        projectId: z.string().uuid(),
        userId: z.number().int().positive(),
        role: z.enum([
          "project_manager",
          "site_engineer",
          "supervisor",
          "accounts",
          "storekeeper",
          "auditor",
        ]),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const { db, project } = await loadProject(input.projectId);
      const scope = await teamManager(ctx.user, project);
      if (!rolesAssignableBy(scope.managerRole).includes(input.role))
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "Your role cannot give this role. Someone above you must do it.",
        });
      if (input.userId === ctx.user.id)
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Someone else must add you to a project.",
        });
      const [membership] = await db
        .select()
        .from(organizationMemberships)
        .where(
          and(
            eq(organizationMemberships.organizationId, project.organizationId),
            eq(organizationMemberships.userId, input.userId),
            eq(organizationMemberships.status, "Active"),
          ),
        )
        .limit(1);
      if (!membership)
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "This person is not an active member of the company.",
        });
      if (!mayManageRole(scope.managerRole, membership.businessRole as BusinessRole))
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "Only someone above this person's role can change this account.",
        });
      const id = randomUUID();
      await db.transaction(async (tx) => {
        await tx
          .update(projectAssignments)
          .set({ status: "Revoked", effectiveTo: new Date() })
          .where(
            and(
              eq(projectAssignments.projectId, project.id),
              eq(projectAssignments.userId, input.userId),
              eq(projectAssignments.status, "Active"),
            ),
          );
        await tx.insert(projectAssignments).values({
          id,
          organizationId: project.organizationId,
          projectId: project.id,
          userId: input.userId,
          role: input.role,
          assignedBy: ctx.user.id,
        });
        await tx.insert(auditEvents).values({
          id: randomUUID(),
          organizationId: project.organizationId,
          actorUserId: ctx.user.id,
          action: "project_team.assigned",
          entityType: "project_assignment",
          entityId: id,
          afterSummary: JSON.stringify({
            projectId: project.id,
            userId: input.userId,
            role: input.role,
          }),
        });
      });
      return { id };
    }),

  remove: protectedProcedure
    .input(
      z.object({
        projectId: z.string().uuid(),
        userId: z.number().int().positive(),
        reason: z.string().trim().min(3).max(300),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const { db, project } = await loadProject(input.projectId);
      const scope = await teamManager(ctx.user, project);
      const [current] = await db
        .select()
        .from(projectAssignments)
        .where(
          and(
            eq(projectAssignments.projectId, project.id),
            eq(projectAssignments.userId, input.userId),
            eq(projectAssignments.status, "Active"),
          ),
        )
        .limit(1);
      if (!current) return { ok: true as const };
      if (!mayManageRole(scope.managerRole, current.role as BusinessRole))
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "Only someone above this person's role can change this account.",
        });
      await db.transaction(async (tx) => {
        await tx
          .update(projectAssignments)
          .set({ status: "Revoked", effectiveTo: new Date() })
          .where(eq(projectAssignments.id, current.id));
        await tx.insert(auditEvents).values({
          id: randomUUID(),
          organizationId: project.organizationId,
          actorUserId: ctx.user.id,
          action: "project_team.removed",
          entityType: "project_assignment",
          entityId: current.id,
          reason: input.reason,
        });
      });
      return { ok: true as const };
    }),
});
