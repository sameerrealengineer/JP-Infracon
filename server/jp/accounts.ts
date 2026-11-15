import { createHash, randomBytes, randomUUID } from "node:crypto";
import { and, desc, eq, gte, inArray, isNull, lte, or } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import {
  auditEvents,
  authSessions,
  organizationMemberships,
  organizations,
  permissionGrants,
  registrationInvites,
  projects,
  siteAssignments,
  sites,
  userCredentials,
  users,
} from "../../drizzle/schema";
import { protectedProcedure, router } from "../_core/trpc";
import { activeProjectRoles, assertActiveAccount } from "./access";
import {
  generateTemporaryPassword,
  hashPassword,
  isValidUsername,
  normalizeUsername,
} from "../_core/credential-auth";
import { getDb } from "../db";
import {
  resolveOrganizationPermission,
  type BusinessRole,
  type PermissionGrantForResolution,
} from "./policy";
import {
  assignableBusinessRoles,
  mayManageMembershipRoles,
  mayManageRole,
  roleRank,
  rolesAssignableBy,
  siteChoiceProblem,
  siteManagerRoles,
  type ManagerRole,
} from "../../lib/jp/account-role-policy";
import { formatInviteCode, inviteCodeFromBytes } from "../../lib/jp/invite-code";
import { effectiveNow } from "../../lib/jp/effective-time";

const newAccountSchema = z.object({
  organizationId: z.string().uuid(),
  displayName: z.string().trim().min(2).max(120),
  username: z.string().trim().min(3).max(32),
  businessRole: z.enum(assignableBusinessRoles),
  siteIds: z.array(z.string().uuid()).max(100),
});

function requireDb(db: Awaited<ReturnType<typeof getDb>>) {
  if (!db)
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message: "The account service is temporarily unavailable.",
    });
  return db;
}

export async function assertCanManageOrganization(
  user: typeof users.$inferSelect,
  organizationId: string,
) {
  assertActiveAccount(user);
  const db = requireDb(await getDb());
  const [organization] = await db
    .select({ id: organizations.id, status: organizations.status })
    .from(organizations)
    .where(eq(organizations.id, organizationId))
    .limit(1);
  if (!organization) throw new TRPCError({ code: "NOT_FOUND", message: "Organization not found." });
  if (user.role === "super_admin") return { organization, managerRole: "super_admin" as const };
  const [membership] = await db
    .select()
    .from(organizationMemberships)
    .where(
      and(
        eq(organizationMemberships.organizationId, organizationId),
        eq(organizationMemberships.userId, user.id),
        eq(organizationMemberships.status, "Active"),
      ),
    )
    .limit(1);
  if (!membership)
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "You cannot manage accounts outside your active organization.",
    });
  const now = new Date();
  const grants = await db
    .select()
    .from(permissionGrants)
    .where(
      and(
        eq(permissionGrants.organizationId, organizationId),
        eq(permissionGrants.userId, user.id),
        eq(permissionGrants.permissionKey, "user.manage"),
      ),
    );
  const allowed = resolveOrganizationPermission({
    role: membership.businessRole as BusinessRole,
    permissionKey: "user.manage",
    organizationId,
    grants: grants as PermissionGrantForResolution[],
    now,
  });
  if (!allowed)
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "Your organization role does not include account management.",
    });
  return { organization, managerRole: membership.businessRole as BusinessRole };
}

async function manageableOrganizations(user: typeof users.$inferSelect) {
  const db = requireDb(await getDb());
  const rows =
    user.role === "super_admin"
      ? (
          await db
            .select({
              id: organizations.id,
              name: organizations.name,
              code: organizations.code,
              status: organizations.status,
            })
            .from(organizations)
            .where(eq(organizations.status, "Active"))
            .limit(200)
        ).map((organization) => ({
          ...organization,
          assignableRoles: rolesAssignableBy("super_admin"),
          managerSiteIds: null as string[] | null,
        }))
      : await (async () => {
          const memberships = await db
            .select({ organizationId: organizationMemberships.organizationId })
            .from(organizationMemberships)
            .where(
              and(
                eq(organizationMemberships.userId, user.id),
                eq(organizationMemberships.status, "Active"),
              ),
            );
          const ids = [...new Set(memberships.map((row) => row.organizationId))];
          if (!ids.length) return [];
          const candidates = await db
            .select({
              id: organizations.id,
              name: organizations.name,
              code: organizations.code,
              status: organizations.status,
            })
            .from(organizations)
            .where(and(inArray(organizations.id, ids), eq(organizations.status, "Active")))
            .limit(200);
          const accepted = [];
          for (const organization of candidates) {
            try {
              const access = await accountManagerScope(user, organization.id);
              accepted.push({
                ...organization,
                assignableRoles: rolesAssignableBy(access.managerRole),
                managerSiteIds: access.siteIds,
              });
            } catch {
              /* keep other authorised organisations */
            }
          }
          return accepted;
        })();
  if (!rows.length) return [];
  const siteRows = await db
    .select({
      id: sites.id,
      organizationId: sites.organizationId,
      projectId: projects.id,
      projectName: projects.name,
      name: sites.name,
      code: sites.siteCode,
    })
    .from(sites)
    .innerJoin(projects, eq(sites.projectId, projects.id))
    .where(
      and(
        inArray(
          sites.organizationId,
          rows.map((row) => row.id),
        ),
        eq(sites.status, "Active"),
      ),
    )
    .limit(1000);
  return rows.map((organization) => ({
    ...organization,
    // Site managers can give access only to their own sites, so only those are offered.
    sites: siteRows.filter(
      (site) =>
        site.organizationId === organization.id &&
        (!organization.managerSiteIds || organization.managerSiteIds.includes(site.id)),
    ),
    wholeCompany: !organization.managerSiteIds,
  }));
}

async function assertTargetInOrganization(userId: number, organizationId: string) {
  const db = requireDb(await getDb());
  const memberships = await db
    .select({
      businessRole: organizationMemberships.businessRole,
      status: organizationMemberships.status,
    })
    .from(organizationMemberships)
    .where(
      and(
        eq(organizationMemberships.organizationId, organizationId),
        eq(organizationMemberships.userId, userId),
      ),
    )
    .limit(100);
  if (!memberships.length)
    throw new TRPCError({
      code: "NOT_FOUND",
      message: "The account has no membership in this organization.",
    });
  const [target] = await db
    .select({ id: users.id, role: users.role, accountStatus: users.accountStatus })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  if (!target || target.role === "super_admin")
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "This privileged account cannot be managed from an organization account list.",
    });
  return { memberships, target };
}

/**
 * Who is managing accounts here and over which sites. Owner, Director, Admin (with
 * `user.manage`) and the Super Admin manage the whole company (`siteIds` null). Project
 * Managers, Site Engineers and Site Supervisors manage only people on their own active sites.
 */
export async function accountManagerScope(
  user: typeof users.$inferSelect,
  organizationId: string,
): Promise<{
  organization: { id: string; status: string };
  managerRole: ManagerRole;
  siteIds: string[] | null;
}> {
  try {
    const access = await assertCanManageOrganization(user, organizationId);
    return { ...access, siteIds: null };
  } catch (error) {
    if (!(error instanceof TRPCError) || error.code !== "FORBIDDEN") throw error;
  }
  const db = requireDb(await getDb());
  const memberships = await db
    .select({ businessRole: organizationMemberships.businessRole })
    .from(organizationMemberships)
    .where(
      and(
        eq(organizationMemberships.organizationId, organizationId),
        eq(organizationMemberships.userId, user.id),
        eq(organizationMemberships.status, "Active"),
      ),
    )
    .limit(20);
  const managerRole = memberships
    .map((row) => row.businessRole as BusinessRole)
    .filter((role) => siteManagerRoles.includes(role))
    .sort((a, b) => roleRank(b) - roleRank(a))[0];
  if (!managerRole)
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "Your role does not include managing accounts.",
    });
  const now = new Date();
  const own = await db
    .select({ siteId: siteAssignments.siteId })
    .from(siteAssignments)
    .innerJoin(sites, eq(siteAssignments.siteId, sites.id))
    .where(
      and(
        eq(siteAssignments.userId, user.id),
        eq(siteAssignments.status, "Active"),
        eq(sites.organizationId, organizationId),
        lte(siteAssignments.effectiveFrom, now),
        or(isNull(siteAssignments.effectiveTo), gte(siteAssignments.effectiveTo, now)),
      ),
    );
  // Project assignments give every site of the project.
  const projectRoles = await activeProjectRoles(db, user.id);
  const projectSites = projectRoles.length
    ? await db
        .select({ siteId: sites.id })
        .from(sites)
        .where(
          and(
            eq(sites.organizationId, organizationId),
            inArray(
              sites.projectId,
              projectRoles.map((row) => row.projectId),
            ),
          ),
        )
    : [];
  const siteIds = [
    ...new Set([...own.map((row) => row.siteId), ...projectSites.map((row) => row.siteId)]),
  ];
  if (!siteIds.length)
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "You are not on any site yet, so you cannot manage accounts.",
    });
  const [organization] = await db
    .select({ id: organizations.id, status: organizations.status })
    .from(organizations)
    .where(eq(organizations.id, organizationId))
    .limit(1);
  if (!organization) throw new TRPCError({ code: "NOT_FOUND", message: "Organization not found." });
  return { organization, managerRole, siteIds };
}

/** Active site assignments of a person in one company. */
async function activeSitesOf(userId: number, organizationId: string) {
  const db = requireDb(await getDb());
  const now = new Date();
  const rows = await db
    .select({ id: siteAssignments.id, siteId: siteAssignments.siteId })
    .from(siteAssignments)
    .innerJoin(sites, eq(siteAssignments.siteId, sites.id))
    .where(
      and(
        eq(siteAssignments.userId, userId),
        eq(siteAssignments.status, "Active"),
        eq(sites.organizationId, organizationId),
        lte(siteAssignments.effectiveFrom, now),
        or(isNull(siteAssignments.effectiveTo), gte(siteAssignments.effectiveTo, now)),
      ),
    );
  return rows;
}

/**
 * The manager may act on this person: never themselves, never a Super Admin, only roles below
 * their own, and (site managers) only someone on one of their sites.
 */
async function assertMayManageTarget(
  manager: typeof users.$inferSelect,
  scope: Awaited<ReturnType<typeof accountManagerScope>>,
  organizationId: string,
  targetUserId: number,
) {
  if (targetUserId === manager.id)
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "Use your own profile to change your account.",
    });
  const { memberships, target } = await assertTargetInOrganization(targetUserId, organizationId);
  if (
    !mayManageMembershipRoles(
      scope.managerRole,
      memberships.map((membership) => membership.businessRole as BusinessRole),
    )
  )
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "Only someone above this person's role can change this account.",
    });
  const targetSites = await activeSitesOf(targetUserId, organizationId);
  if (scope.siteIds) {
    const own = new Set(scope.siteIds);
    if (!targetSites.some((row) => own.has(row.siteId)))
      throw new TRPCError({
        code: "FORBIDDEN",
        message: "This person is not on any of your sites.",
      });
  }
  return { memberships, target, targetSites };
}

async function validateSites(organizationId: string, siteIds: readonly string[]) {
  if (!siteIds.length) return;
  const db = requireDb(await getDb());
  const rows = await db
    .select({ id: sites.id })
    .from(sites)
    .where(
      and(
        eq(sites.organizationId, organizationId),
        inArray(sites.id, [...siteIds]),
        eq(sites.status, "Active"),
      ),
    );
  if (rows.length !== siteIds.length)
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "Every chosen site must be active and belong to this company.",
    });
}

function badSites(problem: string | null) {
  if (problem) throw new TRPCError({ code: "BAD_REQUEST", message: problem });
}

async function createAudit(
  tx: any,
  values: {
    organizationId: string;
    siteId?: string | null;
    actorUserId: number;
    action: string;
    entityType: string;
    entityId: string;
    beforeSummary?: string;
    afterSummary?: string;
  },
) {
  await tx.insert(auditEvents).values({ id: randomUUID(), ...values });
}

function newInviteCode() {
  let code = "";
  while (code.length < 10) code = inviteCodeFromBytes(randomBytes(32));
  return code;
}

export const accountsRouter = router({
  /** One-time sign-up code for a named person; shown once, stored only as a hash. */
  createInvite: protectedProcedure
    .input(
      z.object({
        organizationId: z.string().uuid(),
        inviteeName: z.string().trim().min(2).max(120),
        businessRole: z.enum(assignableBusinessRoles),
        siteId: z.string().uuid().optional(),
        validDays: z.number().int().min(1).max(30).default(7),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const scope = await accountManagerScope(ctx.user, input.organizationId);
      const { organization, managerRole } = scope;
      if (!rolesAssignableBy(managerRole).includes(input.businessRole))
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "Your role cannot invite someone with this role.",
        });
      if (organization.status !== "Active")
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message: "The organisation is not active.",
        });
      badSites(
        siteChoiceProblem({
          managerRole,
          managerSiteIds: scope.siteIds ?? [],
          targetRole: input.businessRole,
          siteIds: input.siteId ? [input.siteId] : [],
        }),
      );
      const db = requireDb(await getDb());
      if (input.siteId) {
        const [site] = await db
          .select({ id: sites.id })
          .from(sites)
          .where(
            and(
              eq(sites.id, input.siteId),
              eq(sites.organizationId, input.organizationId),
              eq(sites.status, "Active"),
            ),
          )
          .limit(1);
        if (!site)
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "Choose an active site in this organisation.",
          });
      }
      const code = newInviteCode();
      const id = randomUUID();
      const expiresAt = new Date(Date.now() + input.validDays * 86_400_000);
      await db.transaction(async (tx) => {
        await tx.insert(registrationInvites).values({
          id,
          organizationId: input.organizationId,
          codeHash: createHash("sha256").update(code).digest("hex"),
          codeHint: code.slice(-4),
          inviteeName: input.inviteeName,
          businessRole: input.businessRole,
          siteId: input.siteId ?? null,
          expiresAt,
          createdBy: ctx.user.id,
        });
        await createAudit(tx, {
          organizationId: input.organizationId,
          siteId: input.siteId ?? null,
          actorUserId: ctx.user.id,
          action: "invite.created",
          entityType: "registration_invite",
          entityId: id,
          afterSummary: JSON.stringify({
            inviteeName: input.inviteeName,
            businessRole: input.businessRole,
            expiresAt,
          }),
        });
      });
      return { id, code: formatInviteCode(code), expiresAt };
    }),

  listInvites: protectedProcedure
    .input(z.object({ organizationId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const scope = await accountManagerScope(ctx.user, input.organizationId);
      const db = requireDb(await getDb());
      try {
        const rows = await db
          .select({
            id: registrationInvites.id,
            inviteeName: registrationInvites.inviteeName,
            businessRole: registrationInvites.businessRole,
            siteName: sites.name,
            siteId: registrationInvites.siteId,
            codeHint: registrationInvites.codeHint,
            status: registrationInvites.status,
            expiresAt: registrationInvites.expiresAt,
            usedAt: registrationInvites.usedAt,
            createdAt: registrationInvites.createdAt,
          })
          .from(registrationInvites)
          .leftJoin(sites, eq(registrationInvites.siteId, sites.id))
          .where(eq(registrationInvites.organizationId, input.organizationId))
          .orderBy(desc(registrationInvites.createdAt))
          .limit(100);
        // Site managers see only invites for their own sites.
        if (!scope.siteIds) return rows.map(({ siteId: _siteId, ...row }) => row);
        const own = new Set(scope.siteIds);
        return rows
          .filter((row) => row.siteId && own.has(row.siteId))
          .map(({ siteId: _siteId, ...row }) => row);
      } catch {
        return [];
      }
    }),

  revokeInvite: protectedProcedure
    .input(z.object({ inviteId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const db = requireDb(await getDb());
      const [invite] = await db
        .select()
        .from(registrationInvites)
        .where(eq(registrationInvites.id, input.inviteId))
        .limit(1);
      if (!invite) throw new TRPCError({ code: "NOT_FOUND", message: "Invite not found." });
      const scope = await accountManagerScope(ctx.user, invite.organizationId);
      if (scope.siteIds && !(invite.siteId && scope.siteIds.includes(invite.siteId)))
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "You can cancel only invites for your own sites.",
        });
      if (invite.status !== "Active") return { id: invite.id };
      await db.transaction(async (tx) => {
        await tx
          .update(registrationInvites)
          .set({ status: "Revoked" })
          .where(eq(registrationInvites.id, invite.id));
        await createAudit(tx, {
          organizationId: invite.organizationId,
          siteId: invite.siteId,
          actorUserId: ctx.user.id,
          action: "invite.revoked",
          entityType: "registration_invite",
          entityId: invite.id,
        });
      });
      return { id: invite.id };
    }),

  options: protectedProcedure.query(async ({ ctx }) => manageableOrganizations(ctx.user)),

  list: protectedProcedure
    .input(z.object({ organizationId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const scope = await accountManagerScope(ctx.user, input.organizationId);
      const db = requireDb(await getDb());
      const rows = await db
        .select({
          id: users.id,
          name: users.name,
          accountStatus: users.accountStatus,
          membershipStatus: organizationMemberships.status,
          businessRole: organizationMemberships.businessRole,
          username: userCredentials.username,
          createdAt: organizationMemberships.createdAt,
        })
        .from(organizationMemberships)
        .innerJoin(users, eq(organizationMemberships.userId, users.id))
        .leftJoin(userCredentials, eq(userCredentials.userId, users.id))
        .where(and(eq(organizationMemberships.organizationId, input.organizationId)))
        .orderBy(users.name)
        .limit(300);
      const userIds = rows.map((row) => row.id);
      const assignments = userIds.length
        ? await db
            .select({
              userId: siteAssignments.userId,
              siteId: sites.id,
              siteName: sites.name,
              assignmentRole: siteAssignments.assignmentRole,
            })
            .from(siteAssignments)
            .innerJoin(sites, eq(siteAssignments.siteId, sites.id))
            .where(
              and(
                inArray(siteAssignments.userId, userIds),
                eq(sites.organizationId, input.organizationId),
                eq(siteAssignments.status, "Active"),
                lte(siteAssignments.effectiveFrom, new Date()),
                or(
                  isNull(siteAssignments.effectiveTo),
                  gte(siteAssignments.effectiveTo, new Date()),
                ),
              ),
            )
        : [];
      const own = scope.siteIds ? new Set(scope.siteIds) : null;
      return rows
        .map((row) => {
          const assignedSites = assignments.filter((assignment) => assignment.userId === row.id);
          return {
            ...row,
            assignedSites,
            // The server decides; the screen only shows or hides the buttons.
            manageable:
              row.id !== ctx.user.id &&
              mayManageRole(scope.managerRole, row.businessRole as BusinessRole) &&
              (!own || assignedSites.some((site) => own.has(site.siteId))),
          };
        })
        .filter(
          (row) =>
            !own ||
            row.id === ctx.user.id ||
            row.assignedSites.some((site) => own.has(site.siteId)),
        );
    }),

  create: protectedProcedure.input(newAccountSchema).mutation(async ({ ctx, input }) => {
    const normalizedUsername = normalizeUsername(input.username);
    if (!isValidUsername(normalizedUsername))
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: "Use 3–32 letters, numbers, dot, dash, or underscore for the username.",
      });
    const scope = await accountManagerScope(ctx.user, input.organizationId);
    const { organization, managerRole } = scope;
    if (!rolesAssignableBy(managerRole).includes(input.businessRole))
      throw new TRPCError({
        code: "FORBIDDEN",
        message: "Your role cannot give this role. Someone above you must do it.",
      });
    if (organization.status !== "Active")
      throw new TRPCError({
        code: "PRECONDITION_FAILED",
        message: "Accounts cannot be added to an inactive organization.",
      });
    badSites(
      siteChoiceProblem({
        managerRole,
        managerSiteIds: scope.siteIds ?? [],
        targetRole: input.businessRole,
        siteIds: input.siteIds,
      }),
    );
    const db = requireDb(await getDb());
    await validateSites(input.organizationId, input.siteIds);
    const temporaryPassword = generateTemporaryPassword();
    const passwordHash = await hashPassword(temporaryPassword);
    const openId = `local_${randomUUID().replaceAll("-", "")}`;
    const now = effectiveNow();
    try {
      const userId = await db.transaction(async (tx) => {
        await tx.insert(users).values({
          openId,
          name: input.displayName,
          email: null,
          loginMethod: "username_password",
          role: "user",
          accountStatus: "Active",
          lastSignedIn: now,
        });
        const [createdUser] = await tx
          .select({ id: users.id })
          .from(users)
          .where(eq(users.openId, openId))
          .limit(1);
        if (!createdUser)
          throw new TRPCError({
            code: "INTERNAL_SERVER_ERROR",
            message: "Account creation failed.",
          });
        await tx.insert(userCredentials).values({
          id: randomUUID(),
          userId: createdUser.id,
          username: normalizedUsername,
          passwordHash,
          mustChangePassword: 1,
          passwordChangedAt: now,
        });
        await tx.insert(organizationMemberships).values({
          id: randomUUID(),
          organizationId: input.organizationId,
          userId: createdUser.id,
          businessRole: input.businessRole,
          status: "Active",
          createdBy: ctx.user.id,
        });
        if (input.siteIds.length)
          await tx.insert(siteAssignments).values(
            input.siteIds.map((siteId) => ({
              id: randomUUID(),
              siteId,
              userId: createdUser.id,
              assignmentRole: input.businessRole,
              effectiveFrom: now,
              status: "Active" as const,
              assignedBy: ctx.user.id,
            })),
          );
        await createAudit(tx, {
          organizationId: input.organizationId,
          siteId: input.siteIds.length === 1 ? input.siteIds[0] : null,
          actorUserId: ctx.user.id,
          action: "account.created",
          entityType: "user_account",
          entityId: String(createdUser.id),
          afterSummary: JSON.stringify({
            username: normalizedUsername,
            businessRole: input.businessRole,
            siteIds: input.siteIds,
            mustChangePassword: true,
          }),
        });
        return createdUser.id;
      });
      return { userId, username: normalizedUsername, temporaryPassword };
    } catch (error) {
      if (error instanceof TRPCError) throw error;
      if (String(error).toLowerCase().includes("duplicate"))
        throw new TRPCError({ code: "CONFLICT", message: "That username is already in use." });
      console.error("[Accounts] Account creation failed");
      throw new TRPCError({
        code: "INTERNAL_SERVER_ERROR",
        message: "Account creation failed. Verify whether the account was created before retrying.",
      });
    }
  }),

  resetPassword: protectedProcedure
    .input(
      z.object({
        organizationId: z.string().uuid(),
        userId: z.number().int().positive(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const scope = await accountManagerScope(ctx.user, input.organizationId);
      const { target } = await assertMayManageTarget(
        ctx.user,
        scope,
        input.organizationId,
        input.userId,
      );
      const db = requireDb(await getDb());
      // One login works across companies: if this person is in another company too, only the
      // Super Admin may reset it.
      const otherCompanies = await db
        .select({ organizationId: organizationMemberships.organizationId })
        .from(organizationMemberships)
        .where(
          and(
            eq(organizationMemberships.userId, target.id),
            eq(organizationMemberships.status, "Active"),
          ),
        );
      if (
        scope.managerRole !== "super_admin" &&
        otherCompanies.some((row) => row.organizationId !== input.organizationId)
      )
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "This person also works for another company. Ask the Super Admin to reset it.",
        });
      const [credential] = await db
        .select({ id: userCredentials.id, username: userCredentials.username })
        .from(userCredentials)
        .where(eq(userCredentials.userId, target.id))
        .limit(1);
      if (!credential)
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message:
            "This legacy account has no username yet. Create a new individually scoped account instead.",
        });
      const temporaryPassword = generateTemporaryPassword();
      const passwordHash = await hashPassword(temporaryPassword);
      const now = new Date();
      await db.transaction(async (tx) => {
        await tx
          .update(userCredentials)
          .set({ passwordHash, mustChangePassword: 1, passwordChangedAt: now })
          .where(eq(userCredentials.userId, target.id));
        await tx
          .update(authSessions)
          .set({ revokedAt: now })
          .where(and(eq(authSessions.userId, target.id), isNull(authSessions.revokedAt)));
        await createAudit(tx, {
          organizationId: input.organizationId,
          actorUserId: ctx.user.id,
          action: "account.password_reset",
          entityType: "user_account",
          entityId: String(target.id),
          afterSummary: JSON.stringify({ usernameReset: true, mustChangePassword: true }),
        });
      });
      return { userId: target.id, username: credential.username, temporaryPassword };
    }),

  setStatus: protectedProcedure
    .input(
      z.object({
        organizationId: z.string().uuid(),
        userId: z.number().int().positive(),
        status: z.enum(["Active", "Suspended", "Deactivated"]),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const scope = await accountManagerScope(ctx.user, input.organizationId);
      const { memberships } = await assertMayManageTarget(
        ctx.user,
        scope,
        input.organizationId,
        input.userId,
      );
      const db = requireDb(await getDb());
      const now = new Date();
      await db.transaction(async (tx) => {
        await tx
          .update(organizationMemberships)
          .set({ status: input.status })
          .where(
            and(
              eq(organizationMemberships.organizationId, input.organizationId),
              eq(organizationMemberships.userId, input.userId),
            ),
          );
        // A suspended or removed person is signed out everywhere at once.
        if (input.status !== "Active")
          await tx
            .update(authSessions)
            .set({ revokedAt: now })
            .where(and(eq(authSessions.userId, input.userId), isNull(authSessions.revokedAt)));
        await createAudit(tx, {
          organizationId: input.organizationId,
          actorUserId: ctx.user.id,
          action: "account.organization_membership_status_changed",
          entityType: "organization_membership",
          entityId: `${input.organizationId}:${input.userId}`,
          beforeSummary: JSON.stringify({
            memberships: memberships.map((membership) => ({
              businessRole: membership.businessRole,
              status: membership.status,
            })),
          }),
          afterSummary: JSON.stringify({ status: input.status, organizationOnly: true }),
        });
      });
      return { success: true as const, status: input.status };
    }),

  /**
   * Edit a person: name, role and sites. Site managers change only their own sites; the
   * person's other sites stay as they are.
   */
  update: protectedProcedure
    .input(
      z.object({
        organizationId: z.string().uuid(),
        userId: z.number().int().positive(),
        displayName: z.string().trim().min(2).max(120),
        businessRole: z.enum(assignableBusinessRoles),
        siteIds: z.array(z.string().uuid()).max(100),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const scope = await accountManagerScope(ctx.user, input.organizationId);
      const { memberships, targetSites } = await assertMayManageTarget(
        ctx.user,
        scope,
        input.organizationId,
        input.userId,
      );
      if (memberships.length > 1)
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message: "This person holds several roles. Remove the extra role first.",
        });
      const beforeRole = memberships[0]!.businessRole as BusinessRole;
      if (
        input.businessRole !== beforeRole &&
        !rolesAssignableBy(scope.managerRole).includes(input.businessRole)
      )
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "Your role cannot give this role. Someone above you must do it.",
        });
      // Sites outside the manager's reach are kept; the manager decides only their own.
      const own = scope.siteIds ? new Set(scope.siteIds) : null;
      const kept = own ? targetSites.filter((row) => !own.has(row.siteId)) : [];
      const wanted = [...new Set([...input.siteIds, ...kept.map((row) => row.siteId)])];
      badSites(
        siteChoiceProblem({
          managerRole: scope.managerRole,
          managerSiteIds: scope.siteIds ?? [],
          targetRole: input.businessRole,
          siteIds: input.siteIds,
        }),
      );
      await validateSites(input.organizationId, input.siteIds);
      const db = requireDb(await getDb());
      const now = effectiveNow();
      const current = new Set(targetSites.map((row) => row.siteId));
      const toEnd = targetSites.filter((row) => !wanted.includes(row.siteId));
      const toAdd = wanted.filter((siteId) => !current.has(siteId));
      await db.transaction(async (tx) => {
        await tx.update(users).set({ name: input.displayName }).where(eq(users.id, input.userId));
        if (input.businessRole !== beforeRole)
          await tx
            .update(organizationMemberships)
            .set({ businessRole: input.businessRole })
            .where(
              and(
                eq(organizationMemberships.organizationId, input.organizationId),
                eq(organizationMemberships.userId, input.userId),
              ),
            );
        if (toEnd.length)
          await tx
            .update(siteAssignments)
            .set({ status: "Revoked", effectiveTo: now })
            .where(
              inArray(
                siteAssignments.id,
                toEnd.map((row) => row.id),
              ),
            );
        if (toAdd.length)
          await tx.insert(siteAssignments).values(
            toAdd.map((siteId) => ({
              id: randomUUID(),
              siteId,
              userId: input.userId,
              assignmentRole: input.businessRole,
              effectiveFrom: now,
              status: "Active" as const,
              assignedBy: ctx.user.id,
            })),
          );
        if (input.businessRole !== beforeRole)
          await tx
            .update(siteAssignments)
            .set({ assignmentRole: input.businessRole })
            .where(
              and(eq(siteAssignments.userId, input.userId), eq(siteAssignments.status, "Active")),
            );
        await createAudit(tx, {
          organizationId: input.organizationId,
          actorUserId: ctx.user.id,
          action: "account.updated",
          entityType: "user_account",
          entityId: String(input.userId),
          beforeSummary: JSON.stringify({
            businessRole: beforeRole,
            siteIds: targetSites.map((row) => row.siteId),
          }),
          afterSummary: JSON.stringify({
            displayName: input.displayName,
            businessRole: input.businessRole,
            siteIds: wanted,
          }),
        });
      });
      return { success: true as const };
    }),

  /**
   * Remove a person. Company leaders remove them from the company: membership ended, all sites
   * ended, signed out, login switched off. Site managers remove them from their own sites only;
   * when no site is left, the membership ends too. Records the person made stay for history.
   */
  remove: protectedProcedure
    .input(
      z.object({
        organizationId: z.string().uuid(),
        userId: z.number().int().positive(),
        reason: z.string().trim().min(3).max(300),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const scope = await accountManagerScope(ctx.user, input.organizationId);
      const { memberships, targetSites } = await assertMayManageTarget(
        ctx.user,
        scope,
        input.organizationId,
        input.userId,
      );
      const own = scope.siteIds ? new Set(scope.siteIds) : null;
      const toEnd = own ? targetSites.filter((row) => own.has(row.siteId)) : targetSites;
      const leavesCompany = !own || toEnd.length === targetSites.length;
      const db = requireDb(await getDb());
      const now = effectiveNow();
      await db.transaction(async (tx) => {
        if (toEnd.length)
          await tx
            .update(siteAssignments)
            .set({ status: "Revoked", effectiveTo: now })
            .where(
              inArray(
                siteAssignments.id,
                toEnd.map((row) => row.id),
              ),
            );
        if (leavesCompany) {
          await tx
            .update(organizationMemberships)
            .set({ status: "Deactivated" })
            .where(
              and(
                eq(organizationMemberships.organizationId, input.organizationId),
                eq(organizationMemberships.userId, input.userId),
              ),
            );
          const [stillActive] = await tx
            .select({ id: organizationMemberships.id })
            .from(organizationMemberships)
            .where(
              and(
                eq(organizationMemberships.userId, input.userId),
                eq(organizationMemberships.status, "Active"),
              ),
            )
            .limit(1);
          // No company left: the login itself is switched off.
          if (!stillActive)
            await tx
              .update(users)
              .set({ accountStatus: "Deactivated" })
              .where(eq(users.id, input.userId));
          await tx
            .update(authSessions)
            .set({ revokedAt: now })
            .where(and(eq(authSessions.userId, input.userId), isNull(authSessions.revokedAt)));
        }
        await createAudit(tx, {
          organizationId: input.organizationId,
          actorUserId: ctx.user.id,
          action: "account.removed",
          entityType: "user_account",
          entityId: String(input.userId),
          beforeSummary: JSON.stringify({
            businessRoles: memberships.map((membership) => membership.businessRole),
            siteIds: targetSites.map((row) => row.siteId),
          }),
          afterSummary: JSON.stringify({
            removedSiteIds: toEnd.map((row) => row.siteId),
            leftCompany: leavesCompany,
            reason: input.reason,
          }),
        });
      });
      return { success: true as const, leftCompany: leavesCompany };
    }),

  /** Bring back a removed person (company leaders), with their old role and no sites yet. */
  restore: protectedProcedure
    .input(
      z.object({
        organizationId: z.string().uuid(),
        userId: z.number().int().positive(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const scope = await accountManagerScope(ctx.user, input.organizationId);
      if (scope.siteIds)
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "Only a company leader can bring back a removed account.",
        });
      await assertMayManageTarget(ctx.user, scope, input.organizationId, input.userId);
      const db = requireDb(await getDb());
      await db.transaction(async (tx) => {
        await tx
          .update(organizationMemberships)
          .set({ status: "Active" })
          .where(
            and(
              eq(organizationMemberships.organizationId, input.organizationId),
              eq(organizationMemberships.userId, input.userId),
            ),
          );
        await tx.update(users).set({ accountStatus: "Active" }).where(eq(users.id, input.userId));
        await createAudit(tx, {
          organizationId: input.organizationId,
          actorUserId: ctx.user.id,
          action: "account.restored",
          entityType: "user_account",
          entityId: String(input.userId),
        });
      });
      return { success: true as const };
    }),
});
