import { randomUUID } from "node:crypto";
import { and, count, desc, eq, gte, inArray, isNull, lte, ne, or } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import {
  auditEvents,
  dailyReportItems,
  dailyReports,
  materialRequestItems,
  materialRequests,
  organizationMemberships,
  organizations,
  permissionGrants,
  projects,
  siteAssignments,
  sites,
  taskDependencies,
  taskScheduleChanges,
  taskScheduleRevisions,
  users,
  workTasks,
} from "../../drizzle/schema";
import { protectedProcedure, router } from "../_core/trpc";
import { getAccessibleSites, getSiteScope, assertActiveAccount } from "./access";
import { resolveOrganizationPermission, resolveSitePermission, type PermissionGrantForResolution } from "./policy";
import { taskRouter } from "./tasks";
import { workforceRouter } from "./workforce";
import { inventoryRouter } from "./inventory";
import { financeRouter } from "./finance";
import { accountsRouter } from "./accounts";

const codeSchema = z.string().trim().min(2).max(32).regex(/^[A-Za-z0-9][A-Za-z0-9-]*$/);
const dateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine((value) => {
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}, "Enter a valid calendar date.");
const quantitySchema = z.string().trim().regex(/^\d{1,11}(?:\.\d{1,3})?$/).refine((value) => Number(value) > 0, "Quantity must be greater than zero.");
const mutationIdSchema = z.string().trim().min(16).max(64);

function requireDb(db: Awaited<ReturnType<typeof import("../db").getDb>>) {
  if (!db) throw new TRPCError({ code: "PRECONDITION_FAILED", message: "The business data service is temporarily unavailable." });
  return db;
}

function safeRequestId(value: string | string[] | undefined) {
  return typeof value === "string" && value.length <= 100 ? value : undefined;
}

const permissionKeys = [
  "dpr.view", "dpr.create", "dpr.submit", "dpr.review",
  "dlr.view", "dlr.create", "dlr.submit", "dlr.review",
  "material.request.view", "material.request", "material.review", "audit.view",
  "task.view", "task.manage", "task.status.update",
  "workforce.view", "workforce.manage", "workforce.kyc.view", "workforce.kyc.review", "workforce.review",
  "compensation.view", "compensation.manage", "compensation.review",
  "inventory.view", "inventory.catalog.manage", "inventory.transact", "inventory.review",
  "vendor.view", "vendor.create",
  "finance.invoice.view", "finance.invoice.create", "finance.invoice.submit", "finance.invoice.review",
  "finance.payment.view", "finance.payment.create", "finance.payment.submit", "finance.payment.review", "finance.payment.post", "finance.payment.cancel",
  "finance.cash.view", "finance.cash.fund.manage", "finance.cash.movement.create", "finance.cash.movement.submit",
  "finance.cash.movement.review", "finance.cash.movement.post", "finance.cash.movement.cancel",
] as const;
type PermissionKey = (typeof permissionKeys)[number];
type AccessibleSite = Awaited<ReturnType<typeof getAccessibleSites>>[number];
type SiteCapability = { siteId: string } & Record<PermissionKey, boolean>;

async function siteCapabilities(user: Parameters<typeof getSiteScope>[0], scopedSites: AccessibleSite[]): Promise<SiteCapability[]> {
  if (scopedSites.length === 0) return [];
  const db = requireDb(await (await import("../db")).getDb());
  const now = new Date();
  const organizationIds = [...new Set(scopedSites.map((site) => site.organizationId))];
  const grants = await db.select().from(permissionGrants).where(and(
    eq(permissionGrants.userId, user.id),
    eq(permissionGrants.status, "Active"),
    inArray(permissionGrants.organizationId, organizationIds),
    lte(permissionGrants.effectiveFrom, now),
    or(isNull(permissionGrants.effectiveTo), gte(permissionGrants.effectiveTo, now)),
  ));
  return scopedSites.map((site) => {
    const capabilities = {} as Record<PermissionKey, boolean>;
    for (const permissionKey of permissionKeys) {
      const siteIsAvailable = site.status === "Active" || permissionKey.endsWith(".view");
      capabilities[permissionKey] = siteIsAvailable
        ? ["inventory.catalog.manage", "vendor.view", "vendor.create"].includes(permissionKey)
          ? resolveOrganizationPermission({
            role: site.businessRole,
            permissionKey,
            organizationId: site.organizationId,
            grants: grants as PermissionGrantForResolution[],
            now,
          }) && resolveSitePermission({
            role: site.businessRole,
            permissionKey,
            scope: { organizationId: site.organizationId, projectId: site.projectId, siteId: site.id },
            grants: grants as PermissionGrantForResolution[],
            now,
          })
          : resolveSitePermission({
          role: site.businessRole,
          permissionKey,
          scope: { organizationId: site.organizationId, projectId: site.projectId, siteId: site.id },
          grants: grants as PermissionGrantForResolution[],
          now,
        })
        : false;
    }
    return { siteId: site.id, ...capabilities };
  });
}

function sitesWithPermission(capabilities: SiteCapability[], siteIds: string[], permissionKey: PermissionKey) {
  const requested = new Set(siteIds);
  return capabilities.filter((capability) => requested.has(capability.siteId) && capability[permissionKey]).map((capability) => capability.siteId);
}

async function createAudit(tx: any, input: {
  organizationId: string;
  siteId?: string | null;
  actorUserId: number;
  action: string;
  entityType: string;
  entityId: string;
  requestId?: string;
  beforeSummary?: string;
  afterSummary?: string;
  reason?: string;
}) {
  await tx.insert(auditEvents).values({ id: randomUUID(), ...input });
}

const reportListProcedure = protectedProcedure.input(z.object({ siteId: z.string().uuid().optional() }).optional()).query(async ({ ctx, input }) => {
  assertActiveAccount(ctx.user);
  const db = requireDb(await (await import("../db")).getDb());
  const capabilities = await siteCapabilities(ctx.user, await getAccessibleSites(ctx.user));
  const candidateSiteIds = input?.siteId
    ? [(await getSiteScope(ctx.user, input.siteId)).siteId]
    : capabilities.map((capability) => capability.siteId);
  if (candidateSiteIds.length === 0) return [];
  const dprSiteIds = sitesWithPermission(capabilities, candidateSiteIds, "dpr.view");
  const dlrSiteIds = sitesWithPermission(capabilities, candidateSiteIds, "dlr.view");
  if (input?.siteId && dprSiteIds.length === 0 && dlrSiteIds.length === 0) throw new TRPCError({ code: "FORBIDDEN", message: "Your current role cannot view reports for this site." });
  const predicates = [];
  if (dprSiteIds.length) predicates.push(and(eq(dailyReports.reportKind, "DPR"), inArray(dailyReports.siteId, dprSiteIds))!);
  if (dlrSiteIds.length) predicates.push(and(eq(dailyReports.reportKind, "DLR"), inArray(dailyReports.siteId, dlrSiteIds))!);
  if (predicates.length === 0) return [];
  const condition = predicates.length === 1 ? predicates[0] : or(...predicates);
  if (!condition) return [];
  return db.select({
    id: dailyReports.id,
    siteId: dailyReports.siteId,
    siteName: sites.name,
    reportKind: dailyReports.reportKind,
    reportDate: dailyReports.reportDate,
    shiftCode: dailyReports.shiftCode,
    title: dailyReports.title,
    status: dailyReports.status,
    revisionNumber: dailyReports.revisionNumber,
    remarks: dailyReports.remarks,
    createdBy: dailyReports.createdBy,
    creatorName: users.name,
    submittedAt: dailyReports.submittedAt,
    reviewedAt: dailyReports.reviewedAt,
    returnReason: dailyReports.returnReason,
    createdAt: dailyReports.createdAt,
    updatedAt: dailyReports.updatedAt,
  }).from(dailyReports)
    .innerJoin(sites, eq(dailyReports.siteId, sites.id))
    .innerJoin(users, eq(dailyReports.createdBy, users.id))
    .where(condition)
    .orderBy(desc(dailyReports.updatedAt))
    .limit(100);
});

export const jpRouter = router({
  workforce: workforceRouter,
  inventory: inventoryRouter,
  finance: financeRouter,
  accounts: accountsRouter,
  workspace: router({
    mySites: protectedProcedure.query(async ({ ctx }) => getAccessibleSites(ctx.user)),

    myCapabilities: protectedProcedure.query(async ({ ctx }) => siteCapabilities(ctx.user, await getAccessibleSites(ctx.user))),

    onboardingState: protectedProcedure.query(async ({ ctx }) => {
      assertActiveAccount(ctx.user);
      const db = requireDb(await (await import("../db")).getDb());
      const [membership] = await db.select({ id: organizationMemberships.id, businessRole: organizationMemberships.businessRole }).from(organizationMemberships)
        .where(and(eq(organizationMemberships.userId, ctx.user.id), eq(organizationMemberships.status, "Active"))).limit(1);
      return {
        hasOrganizationMembership: Boolean(membership),
        businessRole: membership?.businessRole ?? null,
        canInitializeOrganization: ctx.user.role === "super_admin" && !membership,
      };
    }),

    initializeFirstWorkspace: protectedProcedure.input(z.object({
      organizationName: z.string().trim().min(2).max(160),
      organizationCode: codeSchema,
      projectName: z.string().trim().min(2).max(180),
      projectCode: codeSchema,
      projectType: z.string().trim().max(64).optional(),
      siteName: z.string().trim().min(2).max(180),
      siteCode: codeSchema,
      address: z.string().trim().max(1000).optional(),
    })).mutation(async ({ ctx, input }) => {
      assertActiveAccount(ctx.user);
      if (ctx.user.role !== "super_admin") throw new TRPCError({ code: "FORBIDDEN", message: "Only the designated Super Admin can initialise the first organisation." });
      const db = requireDb(await (await import("../db")).getDb());
      const existing = await db.select({ id: organizationMemberships.id }).from(organizationMemberships)
        .where(and(eq(organizationMemberships.userId, ctx.user.id), eq(organizationMemberships.status, "Active"))).limit(1);
      if (existing.length > 0) throw new TRPCError({ code: "CONFLICT", message: "This account already belongs to an organisation." });

      const organizationId = randomUUID();
      const projectId = randomUUID();
      const siteId = randomUUID();
      try {
        await db.transaction(async (tx) => {
          await tx.insert(organizations).values({ id: organizationId, name: input.organizationName, code: input.organizationCode.toUpperCase() });
          await tx.insert(organizationMemberships).values({ id: randomUUID(), organizationId, userId: ctx.user.id, businessRole: "owner", status: "Active", createdBy: ctx.user.id });
          await tx.insert(projects).values({ id: projectId, organizationId, projectCode: input.projectCode.toUpperCase(), name: input.projectName, projectType: input.projectType || null, createdBy: ctx.user.id });
          await tx.insert(sites).values({ id: siteId, organizationId, projectId, siteCode: input.siteCode.toUpperCase(), name: input.siteName, address: input.address || null, createdBy: ctx.user.id });
          await tx.insert(siteAssignments).values({ id: randomUUID(), siteId, userId: ctx.user.id, assignmentRole: "owner", status: "Active", assignedBy: ctx.user.id });
          await createAudit(tx, { organizationId, siteId, actorUserId: ctx.user.id, action: "workspace.initialized", entityType: "organization", entityId: organizationId, requestId: safeRequestId(ctx.req.headers["x-request-id"]), afterSummary: JSON.stringify({ projectId, siteId }) });
        });
      } catch (error) {
        if (error instanceof TRPCError) throw error;
        console.error("[JP] First workspace initialization failed");
        throw new TRPCError({ code: "CONFLICT", message: "The workspace could not be created. Check that the organisation, project, and site codes are unique." });
      }
      return { organizationId, projectId, siteId };
    }),

    dashboard: protectedProcedure.query(async ({ ctx }) => {
      assertActiveAccount(ctx.user);
      const db = requireDb(await (await import("../db")).getDb());
      const capabilities = await siteCapabilities(ctx.user, await getAccessibleSites(ctx.user));
      const siteIds = capabilities.map((capability) => capability.siteId);
      const asOf = new Date().toISOString();
      if (siteIds.length === 0) return { siteCount: 0, reportsNeedingReview: 0, reportsReturned: 0, pendingMaterialRequests: 0, asOf };
      const dprSiteIds = sitesWithPermission(capabilities, siteIds, "dpr.view");
      const dlrSiteIds = sitesWithPermission(capabilities, siteIds, "dlr.view");
      const requestSiteIds = sitesWithPermission(capabilities, siteIds, "material.request.view");
      const reviewDpr = dprSiteIds.length ? await db.select({ value: count() }).from(dailyReports).where(and(eq(dailyReports.reportKind, "DPR"), inArray(dailyReports.siteId, dprSiteIds), inArray(dailyReports.status, ["Submitted", "Under Review"]))) : [];
      const reviewDlr = dlrSiteIds.length ? await db.select({ value: count() }).from(dailyReports).where(and(eq(dailyReports.reportKind, "DLR"), inArray(dailyReports.siteId, dlrSiteIds), inArray(dailyReports.status, ["Submitted", "Under Review"]))) : [];
      const returnedDpr = dprSiteIds.length ? await db.select({ value: count() }).from(dailyReports).where(and(eq(dailyReports.reportKind, "DPR"), inArray(dailyReports.siteId, dprSiteIds), eq(dailyReports.status, "Returned for Correction"))) : [];
      const returnedDlr = dlrSiteIds.length ? await db.select({ value: count() }).from(dailyReports).where(and(eq(dailyReports.reportKind, "DLR"), inArray(dailyReports.siteId, dlrSiteIds), eq(dailyReports.status, "Returned for Correction"))) : [];
      const reportReviewCount = Number(reviewDpr[0]?.value ?? 0) + Number(reviewDlr[0]?.value ?? 0);
      const returnedCount = Number(returnedDpr[0]?.value ?? 0) + Number(returnedDlr[0]?.value ?? 0);
      const materialRequestCount = requestSiteIds.length ? Number((await db.select({ value: count() }).from(materialRequests).where(and(inArray(materialRequests.siteId, requestSiteIds), eq(materialRequests.status, "Submitted"))))[0]?.value ?? 0) : 0;
      return {
        siteCount: siteIds.length,
        reportsNeedingReview: reportReviewCount,
        reportsReturned: returnedCount,
        pendingMaterialRequests: materialRequestCount,
        asOf,
      };
    }),

    auditEvents: protectedProcedure.query(async ({ ctx }) => {
      const db = requireDb(await (await import("../db")).getDb());
      const capabilities = await siteCapabilities(ctx.user, await getAccessibleSites(ctx.user));
      const siteIds = capabilities.map((capability) => capability.siteId);
      if (siteIds.length === 0) return [];
      const auditSiteIds = sitesWithPermission(capabilities, siteIds, "audit.view");
      if (auditSiteIds.length === 0) return [];
      const compensationSiteIds = sitesWithPermission(capabilities, siteIds, "compensation.view");
      const kycVisibleSiteIds = sitesWithPermission(capabilities, siteIds, "workforce.kyc.view");
      const financeVisibleSiteIds = sitesWithPermission(capabilities, siteIds, "finance.invoice.view");
      const vendorVisibleSiteIds = sitesWithPermission(capabilities, siteIds, "vendor.view");
      const compensationAuditVisibility = compensationSiteIds.length > 0
        ? or(ne(auditEvents.entityType, "worker_engagement"), inArray(auditEvents.siteId, compensationSiteIds))!
        : ne(auditEvents.entityType, "worker_engagement");
      const kycAuditVisibility = kycVisibleSiteIds.length > 0
        ? or(ne(auditEvents.entityType, "person"), inArray(auditEvents.siteId, kycVisibleSiteIds))!
        : ne(auditEvents.entityType, "person");
      const financeAuditVisibility = financeVisibleSiteIds.length > 0
        ? or(ne(auditEvents.entityType, "supplier_invoice"), inArray(auditEvents.siteId, financeVisibleSiteIds))!
        : ne(auditEvents.entityType, "supplier_invoice");
      const vendorAuditVisibility = vendorVisibleSiteIds.length > 0
        ? or(ne(auditEvents.entityType, "vendor"), inArray(auditEvents.siteId, vendorVisibleSiteIds))!
        : ne(auditEvents.entityType, "vendor");
      const rows = await db.select({
        id: auditEvents.id,
        organizationId: auditEvents.organizationId,
        siteId: auditEvents.siteId,
        actorUserId: auditEvents.actorUserId,
        actorName: users.name,
        action: auditEvents.action,
        entityType: auditEvents.entityType,
        entityId: auditEvents.entityId,
        occurredAt: auditEvents.occurredAt,
        beforeSummary: auditEvents.beforeSummary,
        afterSummary: auditEvents.afterSummary,
        reason: auditEvents.reason,
      }).from(auditEvents).innerJoin(users, eq(auditEvents.actorUserId, users.id))
        .where(and(inArray(auditEvents.siteId, auditSiteIds), compensationAuditVisibility, kycAuditVisibility, financeAuditVisibility, vendorAuditVisibility)).orderBy(desc(auditEvents.occurredAt)).limit(100);
      return rows;
    }),
  }),

  reports: router({
    list: reportListProcedure,

    createDraft: protectedProcedure.input(z.object({
      siteId: z.string().uuid(),
      reportKind: z.enum(["DPR", "DLR"]),
      reportDate: dateSchema,
      shiftCode: z.string().trim().min(1).max(32).default("General"),
      title: z.string().trim().min(2).max(180),
      remarks: z.string().trim().max(5000).optional(),
      nextDayPlan: z.string().trim().max(3000).optional(),
      clientMutationId: mutationIdSchema,
    })).mutation(async ({ ctx, input }) => {
      const permission = input.reportKind === "DPR" ? "dpr.create" : "dlr.create";
      const scope = await getSiteScope(ctx.user, input.siteId, permission);
      const db = requireDb(await (await import("../db")).getDb());
      const [existing] = await db.select().from(dailyReports).where(eq(dailyReports.clientMutationId, input.clientMutationId)).limit(1);
      if (existing) {
        if (existing.createdBy !== ctx.user.id || existing.siteId !== scope.siteId) throw new TRPCError({ code: "CONFLICT", message: "This offline mutation key is already associated with a different record." });
        return existing;
      }

      const id = randomUUID();
      try {
        await db.transaction(async (tx) => {
          await tx.insert(dailyReports).values({
            id,
            organizationId: scope.organizationId,
            siteId: scope.siteId,
            reportKind: input.reportKind,
            reportDate: input.reportDate,
            shiftCode: input.shiftCode,
            title: input.title,
            remarks: input.remarks || null,
            nextDayPlan: input.nextDayPlan || null,
            status: "Draft",
            revisionNumber: 1,
            clientMutationId: input.clientMutationId,
            createdBy: ctx.user.id,
          });
          await createAudit(tx, { organizationId: scope.organizationId, siteId: scope.siteId, actorUserId: ctx.user.id, action: "report.draft_created", entityType: "daily_report", entityId: id, requestId: safeRequestId(ctx.req.headers["x-request-id"]), afterSummary: JSON.stringify({ reportKind: input.reportKind, reportDate: input.reportDate, siteId: scope.siteId }) });
        });
      } catch (error) {
        console.error("[JP] Daily report draft could not be saved");
        throw new TRPCError({ code: "CONFLICT", message: "A report may already exist for this site, date, and shift. Open the existing record or use a controlled correction workflow." });
      }
      const [created] = await db.select().from(dailyReports).where(eq(dailyReports.id, id)).limit(1);
      return created;
    }),

    submit: protectedProcedure.input(z.object({ reportId: z.string().uuid() })).mutation(async ({ ctx, input }) => {
      const db = requireDb(await (await import("../db")).getDb());
      const [report] = await db.select().from(dailyReports).where(eq(dailyReports.id, input.reportId)).limit(1);
      if (!report) throw new TRPCError({ code: "NOT_FOUND", message: "Report not found." });
      const permission = report.reportKind === "DPR" ? "dpr.submit" : "dlr.submit";
      const scope = await getSiteScope(ctx.user, report.siteId, permission);
      if (report.status !== "Draft" && report.status !== "Returned for Correction") throw new TRPCError({ code: "PRECONDITION_FAILED", message: "Only a draft or returned report can be submitted." });
      const now = new Date();
      await db.transaction(async (tx) => {
        const [lockedReport] = await tx.select().from(dailyReports).where(eq(dailyReports.id, report.id)).for("update").limit(1);
        if (!lockedReport) throw new TRPCError({ code: "NOT_FOUND", message: "Report not found." });
        if (lockedReport.status !== "Draft" && lockedReport.status !== "Returned for Correction") throw new TRPCError({ code: "PRECONDITION_FAILED", message: "This report was changed by another action and can no longer be submitted." });
        await tx.update(dailyReports).set({ status: "Submitted", submittedAt: now, reviewedBy: null, reviewedAt: null, returnReason: null, updatedAt: now }).where(eq(dailyReports.id, lockedReport.id));
        await createAudit(tx, { organizationId: scope.organizationId, siteId: scope.siteId, actorUserId: ctx.user.id, action: "report.submitted", entityType: "daily_report", entityId: lockedReport.id, requestId: safeRequestId(ctx.req.headers["x-request-id"]), beforeSummary: JSON.stringify({ status: lockedReport.status }), afterSummary: JSON.stringify({ status: "Submitted" }) });
      });
      return { id: report.id, status: "Submitted" as const, submittedAt: now };
    }),

    review: protectedProcedure.input(z.object({ reportId: z.string().uuid(), decision: z.enum(["Approved", "Returned for Correction"]), reason: z.string().trim().max(2000).optional() }).refine((input) => input.decision !== "Returned for Correction" || Boolean(input.reason), "A return reason is required.")).mutation(async ({ ctx, input }) => {
      const db = requireDb(await (await import("../db")).getDb());
      const [report] = await db.select().from(dailyReports).where(eq(dailyReports.id, input.reportId)).limit(1);
      if (!report) throw new TRPCError({ code: "NOT_FOUND", message: "Report not found." });
      const reviewPermission = report.reportKind === "DPR" ? "dpr.review" : "dlr.review";
      const scope = await getSiteScope(ctx.user, report.siteId, reviewPermission);
      if (report.createdBy === ctx.user.id) throw new TRPCError({ code: "FORBIDDEN", message: "The person who submitted this report cannot review it." });
      if (report.status !== "Submitted" && report.status !== "Under Review") throw new TRPCError({ code: "PRECONDITION_FAILED", message: "Only a submitted report can be reviewed." });
      const now = new Date();
      await db.transaction(async (tx) => {
        const [lockedReport] = await tx.select().from(dailyReports).where(eq(dailyReports.id, report.id)).for("update").limit(1);
        if (!lockedReport) throw new TRPCError({ code: "NOT_FOUND", message: "Report not found." });
        if (lockedReport.createdBy === ctx.user.id) throw new TRPCError({ code: "FORBIDDEN", message: "The person who submitted this report cannot review it." });
        if (lockedReport.status !== "Submitted" && lockedReport.status !== "Under Review") throw new TRPCError({ code: "PRECONDITION_FAILED", message: "This report was changed by another action and can no longer be reviewed." });
        await tx.update(dailyReports).set({ status: input.decision, reviewedBy: ctx.user.id, reviewedAt: now, returnReason: input.decision === "Returned for Correction" ? input.reason! : null, updatedAt: now }).where(eq(dailyReports.id, lockedReport.id));
        await createAudit(tx, { organizationId: scope.organizationId, siteId: scope.siteId, actorUserId: ctx.user.id, action: input.decision === "Approved" ? "report.approved" : "report.returned", entityType: "daily_report", entityId: lockedReport.id, requestId: safeRequestId(ctx.req.headers["x-request-id"]), beforeSummary: JSON.stringify({ status: lockedReport.status }), afterSummary: JSON.stringify({ status: input.decision }), reason: input.reason });
      });
      return { id: report.id, status: input.decision };
    }),
  }),

  materialRequests: router({
    list: protectedProcedure.input(z.object({ siteId: z.string().uuid().optional() }).optional()).query(async ({ ctx, input }) => {
      const db = requireDb(await (await import("../db")).getDb());
      const capabilities = await siteCapabilities(ctx.user, await getAccessibleSites(ctx.user));
      const candidateSiteIds = input?.siteId ? [(await getSiteScope(ctx.user, input.siteId)).siteId] : capabilities.map((capability) => capability.siteId);
      const siteIds = sitesWithPermission(capabilities, candidateSiteIds, "material.request.view");
      if (input?.siteId && siteIds.length === 0) throw new TRPCError({ code: "FORBIDDEN", message: "Your current role cannot view material requests for this site." });
      if (siteIds.length === 0) return [];
      const headers = await db.select({
        id: materialRequests.id,
        siteId: materialRequests.siteId,
        siteName: sites.name,
        requestedBy: materialRequests.requestedBy,
        requesterName: users.name,
        requiredBy: materialRequests.requiredBy,
        purpose: materialRequests.purpose,
        status: materialRequests.status,
        approvalNote: materialRequests.approvalNote,
        reviewedBy: materialRequests.reviewedBy,
        reviewedAt: materialRequests.reviewedAt,
        createdAt: materialRequests.createdAt,
        updatedAt: materialRequests.updatedAt,
      }).from(materialRequests).innerJoin(sites, eq(materialRequests.siteId, sites.id))
        .innerJoin(users, eq(materialRequests.requestedBy, users.id))
        .where(inArray(materialRequests.siteId, siteIds)).orderBy(desc(materialRequests.updatedAt)).limit(100);
      if (headers.length === 0) return [];
      const itemRows = await db.select().from(materialRequestItems).where(inArray(materialRequestItems.requestId, headers.map((row) => row.id)));
      return headers.map((header) => ({ ...header, items: itemRows.filter((item) => item.requestId === header.id) }));
    }),

    create: protectedProcedure.input(z.object({
      siteId: z.string().uuid(),
      itemName: z.string().trim().min(2).max(180),
      quantity: quantitySchema,
      unitCode: z.string().trim().min(1).max(32),
      purpose: z.string().trim().max(2000).optional(),
      requiredBy: dateSchema.optional(),
      clientMutationId: mutationIdSchema,
    })).mutation(async ({ ctx, input }) => {
      const scope = await getSiteScope(ctx.user, input.siteId, "material.request");
      const db = requireDb(await (await import("../db")).getDb());
      const [existing] = await db.select().from(materialRequests).where(eq(materialRequests.clientMutationId, input.clientMutationId)).limit(1);
      if (existing) {
        if (existing.requestedBy !== ctx.user.id || existing.siteId !== scope.siteId) throw new TRPCError({ code: "CONFLICT", message: "This offline mutation key is already associated with a different record." });
        const items = await db.select().from(materialRequestItems).where(eq(materialRequestItems.requestId, existing.id));
        return { ...existing, items };
      }

      const id = randomUUID();
      try {
        await db.transaction(async (tx) => {
          await tx.insert(materialRequests).values({
            id,
            organizationId: scope.organizationId,
            siteId: scope.siteId,
            requestedBy: ctx.user.id,
            requiredBy: input.requiredBy || null,
            purpose: input.purpose || null,
            status: "Submitted",
            clientMutationId: input.clientMutationId,
          });
          await tx.insert(materialRequestItems).values({ id: randomUUID(), requestId: id, itemNameSnapshot: input.itemName, requestedQuantity: input.quantity, unitCode: input.unitCode, remarks: input.purpose || null });
          await createAudit(tx, { organizationId: scope.organizationId, siteId: scope.siteId, actorUserId: ctx.user.id, action: "material_request.submitted", entityType: "material_request", entityId: id, requestId: safeRequestId(ctx.req.headers["x-request-id"]), afterSummary: JSON.stringify({ siteId: scope.siteId, item: input.itemName, quantity: input.quantity, unitCode: input.unitCode, status: "Submitted" }) });
        });
      } catch (error) {
        console.error("[JP] Material request could not be saved");
        throw new TRPCError({ code: "CONFLICT", message: "The material request could not be saved. Check the request and retry; the idempotency key prevents a duplicate." });
      }
      const [created] = await db.select().from(materialRequests).where(eq(materialRequests.id, id)).limit(1);
      const items = await db.select().from(materialRequestItems).where(eq(materialRequestItems.requestId, id));
      return { ...created, items };
    }),

    review: protectedProcedure.input(z.object({ requestId: z.string().uuid(), decision: z.enum(["Approved", "Returned", "Rejected"]), reason: z.string().trim().max(2000).optional() }).refine((input) => input.decision === "Approved" || Boolean(input.reason), "A reason is required when returning or rejecting a request.")).mutation(async ({ ctx, input }) => {
      const db = requireDb(await (await import("../db")).getDb());
      const [request] = await db.select().from(materialRequests).where(eq(materialRequests.id, input.requestId)).limit(1);
      if (!request) throw new TRPCError({ code: "NOT_FOUND", message: "Material request not found." });
      const scope = await getSiteScope(ctx.user, request.siteId, "material.review");
      if (request.requestedBy === ctx.user.id) throw new TRPCError({ code: "FORBIDDEN", message: "The requester cannot approve or reject their own request." });
      if (request.status !== "Submitted") throw new TRPCError({ code: "PRECONDITION_FAILED", message: "Only a submitted request can be reviewed." });
      const now = new Date();
      await db.transaction(async (tx) => {
        const [lockedRequest] = await tx.select().from(materialRequests).where(eq(materialRequests.id, request.id)).for("update").limit(1);
        if (!lockedRequest) throw new TRPCError({ code: "NOT_FOUND", message: "Material request not found." });
        if (lockedRequest.requestedBy === ctx.user.id) throw new TRPCError({ code: "FORBIDDEN", message: "The requester cannot approve or reject their own request." });
        if (lockedRequest.status !== "Submitted") throw new TRPCError({ code: "PRECONDITION_FAILED", message: "This request was changed by another action and can no longer be reviewed." });
        await tx.update(materialRequests).set({ status: input.decision, approvalNote: input.reason || null, reviewedBy: ctx.user.id, reviewedAt: now, updatedAt: now }).where(eq(materialRequests.id, lockedRequest.id));
        await createAudit(tx, { organizationId: scope.organizationId, siteId: scope.siteId, actorUserId: ctx.user.id, action: `material_request.${input.decision.toLowerCase()}`, entityType: "material_request", entityId: lockedRequest.id, requestId: safeRequestId(ctx.req.headers["x-request-id"]), beforeSummary: JSON.stringify({ status: lockedRequest.status }), afterSummary: JSON.stringify({ status: input.decision }), reason: input.reason });
      });
      return { id: request.id, status: input.decision };
    }),
  }),
  tasks: taskRouter,
});
