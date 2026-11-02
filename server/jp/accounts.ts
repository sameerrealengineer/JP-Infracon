import { randomUUID } from "node:crypto";
import { and, eq, gte, inArray, isNull, lte, or } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import {
  auditEvents,
  authSessions,
  organizationMemberships,
  organizations,
  permissionGrants,
  projects,
  siteAssignments,
  sites,
  userCredentials,
  users,
} from "../../drizzle/schema";
import { protectedProcedure, router } from "../_core/trpc";
import { assertActiveAccount } from "./access";
import { generateTemporaryPassword, hashPassword, isValidUsername, normalizeUsername } from "../_core/credential-auth";
import { getDb } from "../db";
import { resolveOrganizationPermission, type BusinessRole, type PermissionGrantForResolution } from "./policy";
import { assignableBusinessRoles, mayManageMembershipRoles, mayManageRole, rolesAssignableBy } from "../../lib/jp/account-role-policy";

const organizationWideRoles = new Set<BusinessRole>(["admin", "director"]);
const newAccountSchema = z.object({
  organizationId: z.string().uuid(),
  displayName: z.string().trim().min(2).max(120),
  username: z.string().trim().min(3).max(32),
  businessRole: z.enum(assignableBusinessRoles),
  siteIds: z.array(z.string().uuid()).max(100),
});

function requireDb(db: Awaited<ReturnType<typeof getDb>>) {
  if (!db) throw new TRPCError({ code: "PRECONDITION_FAILED", message: "The account service is temporarily unavailable." });
  return db;
}

async function assertCanManageOrganization(user: typeof users.$inferSelect, organizationId: string) {
  assertActiveAccount(user);
  const db = requireDb(await getDb());
  const [organization] = await db.select({ id: organizations.id, status: organizations.status })
    .from(organizations).where(eq(organizations.id, organizationId)).limit(1);
  if (!organization) throw new TRPCError({ code: "NOT_FOUND", message: "Organization not found." });
  if (user.role === "super_admin") return { organization, managerRole: "super_admin" as const };
  const [membership] = await db.select().from(organizationMemberships).where(and(
    eq(organizationMemberships.organizationId, organizationId),
    eq(organizationMemberships.userId, user.id),
    eq(organizationMemberships.status, "Active"),
  )).limit(1);
  if (!membership) throw new TRPCError({ code: "FORBIDDEN", message: "You cannot manage accounts outside your active organization." });
  const now = new Date();
  const grants = await db.select().from(permissionGrants).where(and(
    eq(permissionGrants.organizationId, organizationId),
    eq(permissionGrants.userId, user.id),
    eq(permissionGrants.permissionKey, "user.manage"),
  ));
  const allowed = resolveOrganizationPermission({
    role: membership.businessRole as BusinessRole,
    permissionKey: "user.manage",
    organizationId,
    grants: grants as PermissionGrantForResolution[],
    now,
  });
  if (!allowed) throw new TRPCError({ code: "FORBIDDEN", message: "Your organization role does not include account management." });
  return { organization, managerRole: membership.businessRole as BusinessRole };
}

async function manageableOrganizations(user: typeof users.$inferSelect) {
  const db = requireDb(await getDb());
  const rows = user.role === "super_admin"
    ? (await db.select({ id: organizations.id, name: organizations.name, code: organizations.code, status: organizations.status })
      .from(organizations).where(eq(organizations.status, "Active")).limit(200))
      .map((organization) => ({ ...organization, assignableRoles: rolesAssignableBy("super_admin") }))
    : await (async () => {
      const memberships = await db.select({ organizationId: organizationMemberships.organizationId }).from(organizationMemberships)
        .where(and(eq(organizationMemberships.userId, user.id), eq(organizationMemberships.status, "Active")));
      const ids = [...new Set(memberships.map((row) => row.organizationId))];
      if (!ids.length) return [];
      const candidates = await db.select({ id: organizations.id, name: organizations.name, code: organizations.code, status: organizations.status })
        .from(organizations).where(and(inArray(organizations.id, ids), eq(organizations.status, "Active"))).limit(200);
      const accepted = [];
      for (const organization of candidates) {
        try {
          const access = await assertCanManageOrganization(user, organization.id);
          accepted.push({ ...organization, assignableRoles: rolesAssignableBy(access.managerRole) });
        } catch { /* keep other authorised organisations */ }
      }
      return accepted;
    })();
  if (!rows.length) return [];
  const siteRows = await db.select({
    id: sites.id,
    organizationId: sites.organizationId,
    projectId: projects.id,
    projectName: projects.name,
    name: sites.name,
    code: sites.siteCode,
  }).from(sites).innerJoin(projects, eq(sites.projectId, projects.id)).where(and(
    inArray(sites.organizationId, rows.map((row) => row.id)),
    eq(sites.status, "Active"),
  )).limit(1000);
  return rows.map((organization) => ({
    ...organization,
    sites: siteRows.filter((site) => site.organizationId === organization.id),
  }));
}

async function assertTargetInOrganization(userId: number, organizationId: string) {
  const db = requireDb(await getDb());
  const memberships = await db.select({ businessRole: organizationMemberships.businessRole, status: organizationMemberships.status }).from(organizationMemberships)
    .where(and(
      eq(organizationMemberships.organizationId, organizationId),
      eq(organizationMemberships.userId, userId),
    )).limit(100);
  if (!memberships.length) throw new TRPCError({ code: "NOT_FOUND", message: "The account has no membership in this organization." });
  const [target] = await db.select({ id: users.id, role: users.role, accountStatus: users.accountStatus })
    .from(users).where(eq(users.id, userId)).limit(1);
  if (!target || target.role === "super_admin") throw new TRPCError({ code: "FORBIDDEN", message: "This privileged account cannot be managed from an organization account list." });
  return { memberships, target };
}

async function createAudit(tx: any, values: {
  organizationId: string;
  siteId?: string | null;
  actorUserId: number;
  action: string;
  entityType: string;
  entityId: string;
  beforeSummary?: string;
  afterSummary?: string;
}) {
  await tx.insert(auditEvents).values({ id: randomUUID(), ...values });
}

export const accountsRouter = router({
  options: protectedProcedure.query(async ({ ctx }) => manageableOrganizations(ctx.user)),

  list: protectedProcedure.input(z.object({ organizationId: z.string().uuid() })).query(async ({ ctx, input }) => {
    await assertCanManageOrganization(ctx.user, input.organizationId);
    const db = requireDb(await getDb());
    const rows = await db.select({
      id: users.id,
      name: users.name,
      accountStatus: users.accountStatus,
      membershipStatus: organizationMemberships.status,
      businessRole: organizationMemberships.businessRole,
      username: userCredentials.username,
      createdAt: organizationMemberships.createdAt,
    }).from(organizationMemberships)
      .innerJoin(users, eq(organizationMemberships.userId, users.id))
      .leftJoin(userCredentials, eq(userCredentials.userId, users.id))
      .where(and(
        eq(organizationMemberships.organizationId, input.organizationId),
      )).orderBy(users.name).limit(300);
    const userIds = rows.map((row) => row.id);
    const assignments = userIds.length ? await db.select({
      userId: siteAssignments.userId,
      siteId: sites.id,
      siteName: sites.name,
      assignmentRole: siteAssignments.assignmentRole,
    }).from(siteAssignments).innerJoin(sites, eq(siteAssignments.siteId, sites.id)).where(and(
      inArray(siteAssignments.userId, userIds),
      eq(sites.organizationId, input.organizationId),
      eq(siteAssignments.status, "Active"),
      lte(siteAssignments.effectiveFrom, new Date()),
      or(isNull(siteAssignments.effectiveTo), gte(siteAssignments.effectiveTo, new Date())),
    )) : [];
    return rows.map((row) => ({
      ...row,
      assignedSites: assignments.filter((assignment) => assignment.userId === row.id),
    }));
  }),

  create: protectedProcedure.input(newAccountSchema).mutation(async ({ ctx, input }) => {
    const normalizedUsername = normalizeUsername(input.username);
    if (!isValidUsername(normalizedUsername)) throw new TRPCError({ code: "BAD_REQUEST", message: "Use 3–32 letters, numbers, dot, dash, or underscore for the username." });
    const { organization, managerRole } = await assertCanManageOrganization(ctx.user, input.organizationId);
    if (!rolesAssignableBy(managerRole).includes(input.businessRole)) throw new TRPCError({ code: "FORBIDDEN", message: "Your role cannot assign this organization role. A higher-authority organization administrator must do it." });
    if (organization.status !== "Active") throw new TRPCError({ code: "PRECONDITION_FAILED", message: "Accounts cannot be added to an inactive organization." });
    const broadRole = organizationWideRoles.has(input.businessRole);
    if (broadRole && input.siteIds.length > 0) throw new TRPCError({ code: "BAD_REQUEST", message: "Contractor/Admin and Director/Partner roles are organization-scoped; do not add site-only assignments." });
    if (!broadRole && input.siteIds.length === 0) throw new TRPCError({ code: "BAD_REQUEST", message: "Select at least one active site for this site-scoped role." });
    if (new Set(input.siteIds).size !== input.siteIds.length) throw new TRPCError({ code: "BAD_REQUEST", message: "A site may be selected only once." });
    const db = requireDb(await getDb());
    if (input.siteIds.length) {
      const validatedSites = await db.select({ id: sites.id }).from(sites).where(and(
        eq(sites.organizationId, input.organizationId),
        inArray(sites.id, input.siteIds),
        eq(sites.status, "Active"),
      ));
      if (validatedSites.length !== input.siteIds.length) throw new TRPCError({ code: "FORBIDDEN", message: "Every selected site must be active and belong to the selected organization." });
    }
    const temporaryPassword = generateTemporaryPassword();
    const passwordHash = await hashPassword(temporaryPassword);
    const openId = `local_${randomUUID().replaceAll("-", "")}`;
    const now = new Date();
    try {
      const userId = await db.transaction(async (tx) => {
        await tx.insert(users).values({ openId, name: input.displayName, email: null, loginMethod: "username_password", role: "user", accountStatus: "Active", lastSignedIn: now });
        const [createdUser] = await tx.select({ id: users.id }).from(users).where(eq(users.openId, openId)).limit(1);
        if (!createdUser) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Account creation failed." });
        await tx.insert(userCredentials).values({ id: randomUUID(), userId: createdUser.id, username: normalizedUsername, passwordHash, mustChangePassword: 1, passwordChangedAt: now });
        await tx.insert(organizationMemberships).values({ id: randomUUID(), organizationId: input.organizationId, userId: createdUser.id, businessRole: input.businessRole, status: "Active", createdBy: ctx.user.id });
        if (input.siteIds.length) await tx.insert(siteAssignments).values(input.siteIds.map((siteId) => ({
          id: randomUUID(), siteId, userId: createdUser.id, assignmentRole: input.businessRole,
          effectiveFrom: now, status: "Active" as const, assignedBy: ctx.user.id,
        })));
        await createAudit(tx, {
          organizationId: input.organizationId,
          siteId: input.siteIds.length === 1 ? input.siteIds[0] : null,
          actorUserId: ctx.user.id,
          action: "account.created",
          entityType: "user_account",
          entityId: String(createdUser.id),
          afterSummary: JSON.stringify({ username: normalizedUsername, businessRole: input.businessRole, siteIds: input.siteIds, mustChangePassword: true }),
        });
        return createdUser.id;
      });
      return { userId, username: normalizedUsername, temporaryPassword };
    } catch (error) {
      if (error instanceof TRPCError) throw error;
      if (String(error).toLowerCase().includes("duplicate")) throw new TRPCError({ code: "CONFLICT", message: "That username is already in use." });
      console.error("[Accounts] Account creation failed");
      throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Account creation failed. Verify whether the account was created before retrying." });
    }
  }),

  resetPassword: protectedProcedure.input(z.object({
    organizationId: z.string().uuid(),
    userId: z.number().int().positive(),
  })).mutation(async ({ ctx, input }) => {
    const { managerRole } = await assertCanManageOrganization(ctx.user, input.organizationId);
    if (managerRole !== "super_admin") throw new TRPCError({ code: "FORBIDDEN", message: "Credential resets affect this person's single application-wide login and may only be performed by the platform Super Admin." });
    if (input.userId === ctx.user.id) throw new TRPCError({ code: "BAD_REQUEST", message: "Use Change Password for your own account." });
    const { memberships, target } = await assertTargetInOrganization(input.userId, input.organizationId);
    if (!mayManageMembershipRoles(managerRole, memberships.map((membership) => membership.businessRole as BusinessRole))) throw new TRPCError({ code: "FORBIDDEN", message: "The target account holds an equal-or-higher organization role." });
    const db = requireDb(await getDb());
    const [credential] = await db.select({ id: userCredentials.id }).from(userCredentials).where(eq(userCredentials.userId, target.id)).limit(1);
    if (!credential) throw new TRPCError({ code: "PRECONDITION_FAILED", message: "This legacy account has no username yet. Create a new individually scoped account instead." });
    const temporaryPassword = generateTemporaryPassword();
    const passwordHash = await hashPassword(temporaryPassword);
    const now = new Date();
    await db.transaction(async (tx) => {
      await tx.update(userCredentials).set({ passwordHash, mustChangePassword: 1, passwordChangedAt: now }).where(eq(userCredentials.userId, target.id));
      await tx.update(authSessions).set({ revokedAt: now }).where(and(eq(authSessions.userId, target.id), isNull(authSessions.revokedAt)));
      await createAudit(tx, { organizationId: input.organizationId, actorUserId: ctx.user.id, action: "account.password_reset", entityType: "user_account", entityId: String(target.id), afterSummary: JSON.stringify({ usernameReset: true, mustChangePassword: true }) });
    });
    return { userId: target.id, temporaryPassword };
  }),

  setStatus: protectedProcedure.input(z.object({
    organizationId: z.string().uuid(),
    userId: z.number().int().positive(),
    status: z.enum(["Active", "Suspended", "Deactivated"]),
  })).mutation(async ({ ctx, input }) => {
    const { managerRole } = await assertCanManageOrganization(ctx.user, input.organizationId);
    if (input.userId === ctx.user.id) throw new TRPCError({ code: "BAD_REQUEST", message: "You cannot remove your own organization access from this screen." });
    const { memberships } = await assertTargetInOrganization(input.userId, input.organizationId);
    if (!mayManageMembershipRoles(managerRole, memberships.map((membership) => membership.businessRole as BusinessRole))) throw new TRPCError({ code: "FORBIDDEN", message: "A higher-authority organization administrator must manage this account." });
    const db = requireDb(await getDb());
    await db.transaction(async (tx) => {
      await tx.update(organizationMemberships).set({ status: input.status }).where(and(
        eq(organizationMemberships.organizationId, input.organizationId),
        eq(organizationMemberships.userId, input.userId),
      ));
      await createAudit(tx, {
        organizationId: input.organizationId,
        actorUserId: ctx.user.id,
        action: "account.organization_membership_status_changed",
        entityType: "organization_membership",
        entityId: `${input.organizationId}:${input.userId}`,
        beforeSummary: JSON.stringify({ memberships: memberships.map((membership) => ({ businessRole: membership.businessRole, status: membership.status })) }),
        afterSummary: JSON.stringify({ status: input.status, organizationOnly: true }),
      });
    });
    return { success: true as const, status: input.status };
  }),
});
