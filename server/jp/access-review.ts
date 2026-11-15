import { randomUUID } from "node:crypto";
import { and, eq, gte, inArray, isNull, or } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import {
  approvalLimits,
  auditEvents,
  authSessions,
  delegations,
  organizationMemberships,
  permissionGrants,
  projectAssignments,
  projects,
  siteAssignments,
  sites,
  userCredentials,
  users,
} from "../../drizzle/schema";
import { MODULES, moduleForPermission } from "../../lib/jp/modules";
import { ROLE_LABELS, mayManageMembershipRoles } from "../../lib/jp/account-role-policy";
import { buildCsv } from "../../lib/jp/csv";
import { protectedProcedure, router } from "../_core/trpc";
import { getDb } from "../db";
import { accountManagerScope, assertCanManageOrganization } from "./accounts";
import { getAccessibleSites } from "./access";
import { siteCapabilities, permissionKeys } from "./capabilities";
import { roleAllows, type BusinessRole } from "./policy";

function requireDb(db: Awaited<ReturnType<typeof getDb>>) {
  if (!db)
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message: "The business data service is temporarily unavailable.",
    });
  return db;
}

const ROLES: BusinessRole[] = [
  "owner",
  "director",
  "admin",
  "project_manager",
  "site_engineer",
  "supervisor",
  "accounts",
  "storekeeper",
  "auditor",
];

/** Plain action words for a permission key ("finance.invoice.review" → "invoice review"). */
function actionLabel(key: string) {
  const parts = key.split(".");
  return parts.slice(1).join(" ") || parts[0]!;
}

/**
 * Who can do what, and why: the role matrix (from the same rules the server applies), my own
 * access, the access review for leaders, and sign-in sessions.
 */
export const accessReviewRouter = router({
  /** Every role × module × action, from the server's own role rules (one source). */
  matrix: protectedProcedure.query(() => {
    const keys = [...permissionKeys];
    return {
      roles: ROLES.map((role) => ({ role, label: ROLE_LABELS[role] })),
      modules: [
        { key: "core", title: "Sites, people and audit" },
        ...MODULES.map((module) => ({ key: module.key, title: module.title })),
      ]
        .map((module) => ({
          ...module,
          actions: keys
            .filter((key) => (moduleForPermission(key) ?? "core") === module.key)
            .map((key) => ({
              key,
              label: actionLabel(key),
              allowed: Object.fromEntries(ROLES.map((role) => [role, roleAllows(role, key)])),
            })),
        }))
        .filter((module) => module.actions.length > 0),
    };
  }),

  /** What I can do and why: roles per company, project and site, exceptions, delegations, limits. */
  mine: protectedProcedure.query(async ({ ctx }) => {
    const db = requireDb(await getDb());
    const now = new Date();
    const memberships = await db
      .select({
        organizationId: organizationMemberships.organizationId,
        role: organizationMemberships.businessRole,
      })
      .from(organizationMemberships)
      .where(
        and(
          eq(organizationMemberships.userId, ctx.user.id),
          eq(organizationMemberships.status, "Active"),
        ),
      );
    const accessible = await getAccessibleSites(ctx.user);
    const capabilities = await siteCapabilities(ctx.user, accessible);
    const projectRows = await db
      .select({ projectName: projects.name, role: projectAssignments.role })
      .from(projectAssignments)
      .innerJoin(projects, eq(projectAssignments.projectId, projects.id))
      .where(
        and(eq(projectAssignments.userId, ctx.user.id), eq(projectAssignments.status, "Active")),
      )
      .catch(() => []);
    const grants = await db
      .select({
        permissionKey: permissionGrants.permissionKey,
        effect: permissionGrants.effect,
        scopeType: permissionGrants.scopeType,
        reason: permissionGrants.reason,
      })
      .from(permissionGrants)
      .where(
        and(
          eq(permissionGrants.userId, ctx.user.id),
          eq(permissionGrants.status, "Active"),
          or(isNull(permissionGrants.effectiveTo), gte(permissionGrants.effectiveTo, now)),
        ),
      );
    const delegated = await db
      .select({
        bundles: delegations.bundles,
        effectiveTo: delegations.effectiveTo,
        scopeType: delegations.scopeType,
      })
      .from(delegations)
      .where(
        and(
          eq(delegations.userId, ctx.user.id),
          eq(delegations.status, "Active"),
          gte(delegations.effectiveTo, now),
        ),
      )
      .catch(() => []);
    const roles = [...new Set(memberships.map((row) => row.role))];
    const limits = memberships.length
      ? await db
          .select({
            role: approvalLimits.role,
            area: approvalLimits.area,
            limitMinor: approvalLimits.limitMinor,
          })
          .from(approvalLimits)
          .where(
            and(
              inArray(
                approvalLimits.organizationId,
                memberships.map((row) => row.organizationId),
              ),
              inArray(approvalLimits.role, [
                ...roles,
                ...accessible.map((site) => site.businessRole),
              ]),
            ),
          )
          .catch(() => [])
      : [];
    return {
      platformRole: ctx.user.role,
      companyRoles: memberships.map((row) => ({
        role: row.role,
        label: ROLE_LABELS[row.role as BusinessRole],
      })),
      projects: projectRows.map((row) => ({
        ...row,
        label: ROLE_LABELS[row.role as BusinessRole] ?? row.role,
      })),
      sites: accessible.map((site) => {
        const caps = capabilities.find((row) => row.siteId === site.id) as
          | Record<string, unknown>
          | undefined;
        const allowed = caps
          ? Object.entries(caps)
              .filter(([key, value]) => key !== "siteId" && value === true)
              .map(([key]) => key)
          : [];
        return {
          siteId: site.id,
          siteName: site.name,
          project: site.project,
          role: site.businessRole,
          label: ROLE_LABELS[site.businessRole as BusinessRole] ?? site.businessRole,
          modules: [...new Set(allowed.map((key) => moduleForPermission(key) ?? "core"))],
          actions: allowed.length,
        };
      }),
      exceptions: grants.filter((grant) => !(grant.reason ?? "").startsWith("Delegation:")),
      delegations: delegated,
      limits,
    };
  }),

  /** Access review for leaders: every member's role, scope, exceptions, last sign-in, sessions. */
  review: protectedProcedure
    .input(
      z.object({
        organizationId: z.string().uuid(),
        format: z.enum(["rows", "csv"]).default("rows"),
      }),
    )
    .query(async ({ ctx, input }) => {
      await assertCanManageOrganization(ctx.user, input.organizationId);
      const db = requireDb(await getDb());
      const now = new Date();
      const members = await db
        .select({
          userId: users.id,
          name: users.name,
          username: userCredentials.username,
          role: organizationMemberships.businessRole,
          membershipStatus: organizationMemberships.status,
          accountStatus: users.accountStatus,
          lastSignedIn: users.lastSignedIn,
        })
        .from(organizationMemberships)
        .innerJoin(users, eq(organizationMemberships.userId, users.id))
        .leftJoin(userCredentials, eq(userCredentials.userId, users.id))
        .where(eq(organizationMemberships.organizationId, input.organizationId));
      const ids = members.map((row) => row.userId);
      const [siteRows, projectRows, grantRows, sessionRows] = ids.length
        ? await Promise.all([
            db
              .select({
                userId: siteAssignments.userId,
                site: sites.name,
                role: siteAssignments.assignmentRole,
              })
              .from(siteAssignments)
              .innerJoin(sites, eq(siteAssignments.siteId, sites.id))
              .where(
                and(
                  inArray(siteAssignments.userId, ids),
                  eq(siteAssignments.status, "Active"),
                  eq(sites.organizationId, input.organizationId),
                ),
              ),
            db
              .select({
                userId: projectAssignments.userId,
                project: projects.name,
                role: projectAssignments.role,
              })
              .from(projectAssignments)
              .innerJoin(projects, eq(projectAssignments.projectId, projects.id))
              .where(
                and(
                  inArray(projectAssignments.userId, ids),
                  eq(projectAssignments.status, "Active"),
                ),
              )
              .catch(() => []),
            db
              .select({
                userId: permissionGrants.userId,
                key: permissionGrants.permissionKey,
                effect: permissionGrants.effect,
              })
              .from(permissionGrants)
              .where(
                and(
                  inArray(permissionGrants.userId, ids),
                  eq(permissionGrants.status, "Active"),
                  eq(permissionGrants.organizationId, input.organizationId),
                ),
              ),
            db
              .select({ userId: authSessions.userId })
              .from(authSessions)
              .where(
                and(
                  inArray(authSessions.userId, ids),
                  isNull(authSessions.revokedAt),
                  gte(authSessions.expiresAt, now),
                ),
              ),
          ])
        : [[], [], [], []];
      const rows = members.map((member) => ({
        ...member,
        roleLabel: ROLE_LABELS[member.role as BusinessRole] ?? member.role,
        sites: siteRows
          .filter((row) => row.userId === member.userId)
          .map((row) => `${row.site} (${ROLE_LABELS[row.role as BusinessRole] ?? row.role})`),
        projects: projectRows
          .filter((row) => row.userId === member.userId)
          .map((row) => `${row.project} (${ROLE_LABELS[row.role as BusinessRole] ?? row.role})`),
        exceptions: grantRows
          .filter((row) => row.userId === member.userId)
          .map((row) => `${row.effect === "allow" ? "+" : "−"} ${row.key}`),
        activeSessions: sessionRows.filter((row) => row.userId === member.userId).length,
      }));
      if (input.format === "rows") return { rows, csv: null };
      const csv = buildCsv(
        { Report: "Access review", Generated: now.toISOString(), People: String(rows.length) },
        [
          "Name",
          "Username",
          "Company role",
          "Membership",
          "Login",
          "Sites",
          "Projects",
          "Exceptions",
          "Active sign-ins",
          "Last sign-in",
        ],
        rows.map((row) => [
          row.name ?? "",
          row.username ?? "",
          row.roleLabel,
          row.membershipStatus,
          row.accountStatus,
          row.sites.join("; "),
          row.projects.join("; "),
          row.exceptions.join("; "),
          String(row.activeSessions),
          row.lastSignedIn
            ? new Date(row.lastSignedIn).toISOString().slice(0, 16).replace("T", " ")
            : "",
        ]),
      );
      await db.insert(auditEvents).values({
        id: randomUUID(),
        organizationId: input.organizationId,
        actorUserId: ctx.user.id,
        action: "access_review.exported",
        entityType: "access_review",
        entityId: input.organizationId,
        afterSummary: JSON.stringify({ people: rows.length }),
      });
      return { rows, csv };
    }),

  /** Ends every sign-in of a person (leaders above them), or all of my own sign-ins. */
  endSessions: protectedProcedure
    .input(
      z.object({
        organizationId: z.string().uuid().optional(),
        userId: z.number().int().positive().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const db = requireDb(await getDb());
      const target = input.userId ?? ctx.user.id;
      if (target !== ctx.user.id) {
        if (!input.organizationId)
          throw new TRPCError({ code: "BAD_REQUEST", message: "Choose the company." });
        const scope = await accountManagerScope(ctx.user, input.organizationId);
        const roles = await db
          .select({ role: organizationMemberships.businessRole })
          .from(organizationMemberships)
          .where(
            and(
              eq(organizationMemberships.organizationId, input.organizationId),
              eq(organizationMemberships.userId, target),
            ),
          );
        if (
          !roles.length ||
          !mayManageMembershipRoles(
            scope.managerRole,
            roles.map((row) => row.role as BusinessRole),
          )
        )
          throw new TRPCError({
            code: "FORBIDDEN",
            message: "Only someone above this person's role can change this account.",
          });
      }
      const now = new Date();
      await db
        .update(authSessions)
        .set({ revokedAt: now })
        .where(and(eq(authSessions.userId, target), isNull(authSessions.revokedAt)));
      if (input.organizationId)
        await db.insert(auditEvents).values({
          id: randomUUID(),
          organizationId: input.organizationId,
          actorUserId: ctx.user.id,
          action: "account.sessions_ended",
          entityType: "user_account",
          entityId: String(target),
        });
      return { ok: true as const };
    }),
});
