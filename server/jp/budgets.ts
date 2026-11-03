import { randomUUID } from "node:crypto";
import { and, desc, eq, inArray } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import {
  attendanceRecords,
  auditEvents,
  pettyCashMovements,
  projectBudgetLines,
  projectBudgets,
  projects,
  sites,
  supplierInvoices,
  users,
  vendors,
  workerEngagements,
} from "../../drizzle/schema";
import { protectedProcedure, router } from "../_core/trpc";
import { getDb } from "../db";
import { getAccessibleSites, getSiteScope, selfApprovalAllowed } from "./access";
import { siteCapabilities } from "./capabilities";
import { dispatchAlert, siteLeadIds } from "./notify";
import { estimateEarning, parseHours, type RateType } from "../../lib/jp/attendance-domain";
import {
  COST_HEADS,
  compareBudget,
  costHeadForVendor,
  marginMinor,
  validateBudgetLines,
  type CostHead,
  type HeadSpend,
  type VendorType,
} from "../../lib/jp/budget-domain";
import { normalizeMinorAmount } from "../../lib/jp/finance-domain";

/**
 * Project budgets: revisions per cost head with maker-checker approval, compared with the
 * approved spend already in the app (supplier bills, approved attendance, posted petty cash).
 * A person sees a project's budget when they hold the permission on any site of that project.
 */

type User = Parameters<typeof getSiteScope>[0];
type BudgetKey = "budget.view" | "budget.manage" | "budget.approve";

function requireDb(db: Awaited<ReturnType<typeof getDb>>) {
  if (!db)
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message: "The business data service is temporarily unavailable.",
    });
  return db;
}

function requestId(value: string | string[] | undefined) {
  return typeof value === "string" && value.length <= 100 ? value : undefined;
}

async function budgetReach(user: User) {
  const accessible = await getAccessibleSites(user);
  const capabilities = await siteCapabilities(user, accessible);
  const projectsWith = (key: BudgetKey) => {
    const allowed = new Set(capabilities.filter((row) => row[key]).map((row) => row.siteId));
    return new Set(accessible.filter((site) => allowed.has(site.id)).map((s) => s.projectId));
  };
  return {
    accessible,
    view: projectsWith("budget.view"),
    manage: projectsWith("budget.manage"),
    approve: projectsWith("budget.approve"),
  };
}

/** Checks a budget permission on the project through one of the person's sites in it. */
async function scopeForProject(user: User, projectId: string, key: BudgetKey) {
  const accessible = await getAccessibleSites(user);
  const candidates = accessible.filter((site) => site.projectId === projectId);
  for (const site of candidates) {
    try {
      return await getSiteScope(user, site.id, key);
    } catch {
      // Try the next site of this project.
    }
  }
  throw new TRPCError({
    code: "FORBIDDEN",
    message: "Your role does not allow this for the budget of this project.",
  });
}

const amountSchema = z
  .string()
  .trim()
  .regex(/^\d{1,18}$/);
const mutationIdSchema = z.string().trim().min(16).max(64);

/** Approved and awaiting-approval spend per cost head for all sites of a project. */
async function projectSpend(db: ReturnType<typeof requireDb>, projectId: string) {
  const siteRows = await db
    .select({ id: sites.id, name: sites.name })
    .from(sites)
    .where(eq(sites.projectId, projectId));
  const spend: Partial<Record<CostHead, HeadSpend>> = {};
  const bySite = new Map(siteRows.map((site) => [site.id, 0n]));
  let labourMissingRate = 0;
  const add = (head: CostHead, siteId: string, amount: bigint, approved: boolean) => {
    const row = spend[head] ?? { actualMinor: 0n, pendingMinor: 0n };
    if (approved) {
      row.actualMinor += amount;
      bySite.set(siteId, (bySite.get(siteId) ?? 0n) + amount);
    } else row.pendingMinor += amount;
    spend[head] = row;
  };
  const siteIds = siteRows.map((site) => site.id);
  if (siteIds.length > 0) {
    const invoices = await db
      .select({
        siteId: supplierInvoices.siteId,
        total: supplierInvoices.totalMinor,
        status: supplierInvoices.status,
        vendorType: vendors.vendorType,
      })
      .from(supplierInvoices)
      .innerJoin(vendors, eq(supplierInvoices.vendorId, vendors.id))
      .where(
        and(
          inArray(supplierInvoices.siteId, siteIds),
          inArray(supplierInvoices.status, ["Submitted", "Approved"]),
        ),
      )
      .limit(50_000);
    for (const row of invoices)
      add(
        costHeadForVendor(row.vendorType as VendorType),
        row.siteId,
        BigInt(String(row.total).split(".")[0]),
        row.status === "Approved",
      );

    const attendance = await db
      .select({
        siteId: attendanceRecords.siteId,
        rateType: workerEngagements.rateType,
        rate: attendanceRecords.rateSnapshotMinor,
        status: attendanceRecords.attendanceStatus,
        regular: attendanceRecords.regularHours,
        overtime: attendanceRecords.overtimeHours,
        overtimeStatus: attendanceRecords.overtimeApprovalStatus,
        reviewedBy: attendanceRecords.reviewedBy,
      })
      .from(attendanceRecords)
      .innerJoin(workerEngagements, eq(attendanceRecords.workerEngagementId, workerEngagements.id))
      .where(inArray(attendanceRecords.siteId, siteIds))
      .limit(200_000);
    for (const row of attendance) {
      const earning = estimateEarning({
        status: row.status,
        rateType: row.rateType as RateType,
        rateMinor: row.rate,
        regularHundredths: parseHours(String(row.regular)) ?? 0n,
        overtimeHundredths: parseHours(String(row.overtime)) ?? 0n,
        overtimeApproved: row.overtimeStatus === "Approved",
      });
      if (earning.kind === "missing_rate") labourMissingRate += 1;
      else if (earning.kind === "amount")
        add("Labour", row.siteId, earning.minor, row.reviewedBy !== null);
    }

    const cash = await db
      .select({
        siteId: pettyCashMovements.siteId,
        amount: pettyCashMovements.amountMinor,
        status: pettyCashMovements.status,
      })
      .from(pettyCashMovements)
      .where(
        and(
          inArray(pettyCashMovements.siteId, siteIds),
          eq(pettyCashMovements.movementType, "Expense"),
          inArray(pettyCashMovements.status, ["Submitted", "Approved", "Posted"]),
        ),
      )
      .limit(100_000);
    for (const row of cash)
      add(
        "Site expenses",
        row.siteId,
        BigInt(String(row.amount).split(".")[0]),
        row.status === "Posted",
      );
  }
  return {
    spend,
    labourMissingRate,
    sites: siteRows.map((site) => ({
      id: site.id,
      name: site.name,
      actualMinor: (bySite.get(site.id) ?? 0n).toString(),
    })),
  };
}

async function budgetLines(db: ReturnType<typeof requireDb>, budgetIds: string[]) {
  if (budgetIds.length === 0)
    return new Map<string, { costHead: CostHead; amountMinor: string; note: string | null }[]>();
  const rows = await db
    .select()
    .from(projectBudgetLines)
    .where(inArray(projectBudgetLines.budgetId, budgetIds));
  const map = new Map<string, { costHead: CostHead; amountMinor: string; note: string | null }[]>();
  for (const row of rows) {
    const list = map.get(row.budgetId) ?? [];
    list.push({
      costHead: row.costHead as CostHead,
      amountMinor: String(row.amountMinor).split(".")[0],
      note: row.note,
    });
    map.set(row.budgetId, list);
  }
  for (const list of map.values())
    list.sort((a, b) => COST_HEADS.indexOf(a.costHead) - COST_HEADS.indexOf(b.costHead));
  return map;
}

const minor = (value: string | null) => (value === null ? null : String(value).split(".")[0]);

export const budgetsRouter = router({
  /** Projects whose budget the person may see, with what they may do there. */
  options: protectedProcedure.query(async ({ ctx }) => {
    const reach = await budgetReach(ctx.user);
    if (reach.view.size === 0) return { costHeads: COST_HEADS, projects: [] };
    const db = requireDb(await getDb());
    const rows = await db
      .select({ id: projects.id, name: projects.name, code: projects.projectCode })
      .from(projects)
      .where(inArray(projects.id, [...reach.view]))
      .orderBy(projects.name);
    return {
      costHeads: COST_HEADS,
      projects: rows.map((row) => ({
        ...row,
        canManage: reach.manage.has(row.id),
        canApprove: reach.approve.has(row.id),
      })),
    };
  }),

  /** The current budget against spend, a waiting revision, and the revision history. */
  overview: protectedProcedure
    .input(z.object({ projectId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const scope = await scopeForProject(ctx.user, input.projectId, "budget.view");
      const reach = await budgetReach(ctx.user);
      const db = requireDb(await getDb());
      const [project] = await db
        .select({ id: projects.id, name: projects.name, code: projects.projectCode })
        .from(projects)
        .where(eq(projects.id, input.projectId))
        .limit(1);
      if (!project) throw new TRPCError({ code: "NOT_FOUND", message: "Project not found." });
      const revisions = await db
        .select({
          id: projectBudgets.id,
          revisionNumber: projectBudgets.revisionNumber,
          status: projectBudgets.status,
          contractValueMinor: projectBudgets.contractValueMinor,
          totalMinor: projectBudgets.totalMinor,
          reason: projectBudgets.reason,
          reviewReason: projectBudgets.reviewReason,
          proposedBy: projectBudgets.proposedBy,
          proposerName: users.name,
          reviewedBy: projectBudgets.reviewedBy,
          reviewedAt: projectBudgets.reviewedAt,
          createdAt: projectBudgets.createdAt,
        })
        .from(projectBudgets)
        .innerJoin(users, eq(projectBudgets.proposedBy, users.id))
        .where(eq(projectBudgets.projectId, input.projectId))
        .orderBy(desc(projectBudgets.revisionNumber))
        .limit(100);
      const reviewerIds = [
        ...new Set(revisions.map((row) => row.reviewedBy).filter((id): id is number => !!id)),
      ];
      const reviewers = reviewerIds.length
        ? await db
            .select({ id: users.id, name: users.name })
            .from(users)
            .where(inArray(users.id, reviewerIds))
        : [];
      const reviewerName = new Map(reviewers.map((row) => [row.id, row.name]));
      const current = revisions.find((row) => row.status === "Approved") ?? null;
      const proposed = revisions.find((row) => row.status === "Proposed") ?? null;
      const lines = await budgetLines(
        db,
        [current?.id, proposed?.id].filter((id): id is string => !!id),
      );
      const spend = await projectSpend(db, input.projectId);
      const currentLines = current ? (lines.get(current.id) ?? []) : [];
      const comparison = compareBudget(currentLines, spend.spend);
      const contract = current ? minor(current.contractValueMinor) : null;
      const canApprove =
        reach.approve.has(input.projectId) &&
        !!proposed &&
        (proposed.proposedBy !== ctx.user.id ||
          (await selfApprovalAllowed(ctx.user, scope.siteId)));
      const shape = (row: (typeof revisions)[number]) => ({
        id: row.id,
        revisionNumber: row.revisionNumber,
        status: row.status,
        contractValueMinor: minor(row.contractValueMinor),
        totalMinor: minor(row.totalMinor)!,
        reason: row.reason,
        reviewReason: row.reviewReason,
        proposerName: row.proposerName ?? "—",
        reviewerName: row.reviewedBy ? (reviewerName.get(row.reviewedBy) ?? "—") : null,
        reviewedAt: row.reviewedAt,
        createdAt: row.createdAt,
        mine: row.proposedBy === ctx.user.id,
      });
      return {
        project,
        current: current ? { ...shape(current), lines: currentLines } : null,
        proposed: proposed ? { ...shape(proposed), lines: lines.get(proposed.id) ?? [] } : null,
        comparison,
        margins: {
          plannedMinor: current ? marginMinor(contract, comparison.totals.budgetMinor) : null,
          toDateMinor: marginMinor(contract, comparison.totals.actualMinor),
        },
        sites: spend.sites,
        labourMissingRate: spend.labourMissingRate,
        history: revisions.map(shape),
        canManage: reach.manage.has(input.projectId),
        canApprove,
      };
    }),

  /** Propose a first budget or a revision. Only one revision may wait for approval. */
  propose: protectedProcedure
    .input(
      z.object({
        projectId: z.string().uuid(),
        contractValueMinor: amountSchema.nullable(),
        lines: z
          .array(
            z.object({
              costHead: z.enum(COST_HEADS),
              amountMinor: amountSchema,
              note: z.string().trim().max(300).nullish(),
            }),
          )
          .max(COST_HEADS.length),
        reason: z.string().trim().max(1000).nullish(),
        clientMutationId: mutationIdSchema,
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const scope = await scopeForProject(ctx.user, input.projectId, "budget.manage");
      const db = requireDb(await getDb());
      const [prior] = await db
        .select({ id: projectBudgets.id, revisionNumber: projectBudgets.revisionNumber })
        .from(projectBudgets)
        .where(eq(projectBudgets.clientMutationId, input.clientMutationId))
        .limit(1);
      if (prior) return { id: prior.id, revisionNumber: prior.revisionNumber };
      const checked = validateBudgetLines(input.lines);
      if ("code" in checked) throw new TRPCError({ code: "BAD_REQUEST", message: checked.message });
      let contract: string | null = null;
      if (input.contractValueMinor !== null) {
        try {
          contract = normalizeMinorAmount(input.contractValueMinor);
        } catch {
          throw new TRPCError({ code: "BAD_REQUEST", message: "Enter a positive contract value." });
        }
      }
      const id = randomUUID();
      const revisionNumber = await db.transaction(async (tx) => {
        await tx
          .select({ id: projects.id })
          .from(projects)
          .where(eq(projects.id, input.projectId))
          .for("update");
        const existing = await tx
          .select({ revisionNumber: projectBudgets.revisionNumber, status: projectBudgets.status })
          .from(projectBudgets)
          .where(eq(projectBudgets.projectId, input.projectId));
        if (existing.some((row) => row.status === "Proposed"))
          throw new TRPCError({
            code: "CONFLICT",
            message: "A budget revision is already waiting for approval.",
          });
        const hasApproved = existing.some((row) => row.status === "Approved");
        if (hasApproved && !input.reason?.trim())
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "Give a reason for revising the approved budget.",
          });
        const next = existing.reduce((max, row) => Math.max(max, row.revisionNumber), 0) + 1;
        await tx.insert(projectBudgets).values({
          id,
          organizationId: scope.organizationId,
          projectId: input.projectId,
          revisionNumber: next,
          status: "Proposed",
          contractValueMinor: contract,
          totalMinor: checked.totalMinor,
          reason: input.reason?.trim() || null,
          proposedBy: ctx.user.id,
          clientMutationId: input.clientMutationId,
        });
        await tx.insert(projectBudgetLines).values(
          checked.lines.map((line) => ({
            id: randomUUID(),
            budgetId: id,
            costHead: line.costHead,
            amountMinor: line.amountMinor,
            note: line.note ?? null,
          })),
        );
        await tx.insert(auditEvents).values({
          id: randomUUID(),
          organizationId: scope.organizationId,
          siteId: scope.siteId,
          actorUserId: ctx.user.id,
          action: "budget.proposed",
          entityType: "project_budget",
          entityId: id,
          clientMutationId: input.clientMutationId,
          requestId: requestId(ctx.req.headers["x-request-id"]),
          afterSummary: JSON.stringify({
            projectId: input.projectId,
            revisionNumber: next,
            totalMinor: checked.totalMinor,
            contractValueMinor: contract,
          }),
          reason: input.reason?.trim() || null,
        });
        return next;
      });
      void siteLeadIds(scope.organizationId, scope.siteId, ctx.user.id).then((recipientUserIds) =>
        dispatchAlert({
          organizationId: scope.organizationId,
          siteId: scope.siteId,
          siteName: scope.siteName,
          kind: "budget.proposed",
          title: `Budget revision ${revisionNumber} waiting for approval`,
          detail: input.reason?.trim() || null,
          route: "/project-budget",
          recipientUserIds,
        }),
      );
      return { id, revisionNumber };
    }),

  /**
   * Approve or reject a waiting revision. A different person decides, unless a delegation
   * allows approving one's own work. Rejection needs a reason. The proposer may withdraw it.
   */
  review: protectedProcedure
    .input(
      z.object({
        budgetId: z.string().uuid(),
        decision: z.enum(["Approve", "Reject", "Withdraw"]),
        reason: z.string().trim().max(1000).nullish(),
        clientMutationId: mutationIdSchema,
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const db = requireDb(await getDb());
      const [done] = await db
        .select({ entityId: auditEvents.entityId, action: auditEvents.action })
        .from(auditEvents)
        .where(
          and(
            eq(auditEvents.actorUserId, ctx.user.id),
            eq(auditEvents.clientMutationId, input.clientMutationId),
          ),
        )
        .limit(1);
      if (done) {
        if (done.entityId !== input.budgetId)
          throw new TRPCError({ code: "CONFLICT", message: "This request was already used." });
        return {
          id: done.entityId,
          status: done.action === "budget.approved" ? ("Approved" as const) : ("Rejected" as const),
        };
      }
      const [budget] = await db
        .select()
        .from(projectBudgets)
        .where(eq(projectBudgets.id, input.budgetId))
        .limit(1);
      if (!budget) throw new TRPCError({ code: "NOT_FOUND", message: "Budget not found." });
      const withdraw = input.decision === "Withdraw";
      const scope = await scopeForProject(
        ctx.user,
        budget.projectId,
        withdraw ? "budget.manage" : "budget.approve",
      );
      if (withdraw && budget.proposedBy !== ctx.user.id)
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "Only the person who proposed it can withdraw it.",
        });
      if (
        input.decision === "Approve" &&
        budget.proposedBy === ctx.user.id &&
        !(await selfApprovalAllowed(ctx.user, scope.siteId))
      )
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "Another person must approve a budget you proposed.",
        });
      const reason = input.reason?.trim() || null;
      if (input.decision === "Reject" && (!reason || reason.length < 3))
        throw new TRPCError({ code: "BAD_REQUEST", message: "Give a reason for rejecting." });
      const status: "Approved" | "Rejected" =
        input.decision === "Approve" ? "Approved" : "Rejected";
      await db.transaction(async (tx) => {
        const [locked] = await tx
          .select({ status: projectBudgets.status })
          .from(projectBudgets)
          .where(eq(projectBudgets.id, budget.id))
          .for("update");
        if (locked?.status !== "Proposed")
          throw new TRPCError({
            code: "CONFLICT",
            message: "This revision was already decided. Refresh to see it.",
          });
        if (status === "Approved")
          await tx
            .update(projectBudgets)
            .set({ status: "Superseded" })
            .where(
              and(
                eq(projectBudgets.projectId, budget.projectId),
                eq(projectBudgets.status, "Approved"),
              ),
            );
        await tx
          .update(projectBudgets)
          .set({
            status,
            reviewedBy: ctx.user.id,
            reviewedAt: new Date(),
            reviewReason: withdraw ? (reason ?? "Withdrawn by the proposer") : reason,
          })
          .where(eq(projectBudgets.id, budget.id));
        await tx.insert(auditEvents).values({
          id: randomUUID(),
          organizationId: scope.organizationId,
          siteId: scope.siteId,
          actorUserId: ctx.user.id,
          action: withdraw ? "budget.withdrawn" : `budget.${status.toLowerCase()}`,
          entityType: "project_budget",
          entityId: budget.id,
          clientMutationId: input.clientMutationId,
          requestId: requestId(ctx.req.headers["x-request-id"]),
          beforeSummary: JSON.stringify({ status: "Proposed" }),
          afterSummary: JSON.stringify({
            status,
            revisionNumber: budget.revisionNumber,
            totalMinor: minor(budget.totalMinor),
          }),
          reason: withdraw ? (reason ?? "Withdrawn by the proposer") : reason,
        });
      });
      if (!withdraw && budget.proposedBy !== ctx.user.id)
        void dispatchAlert({
          organizationId: scope.organizationId,
          siteId: scope.siteId,
          siteName: scope.siteName,
          kind: `budget.${status.toLowerCase()}`,
          title: `Budget revision ${budget.revisionNumber} was ${status.toLowerCase()}`,
          detail: reason,
          route: "/project-budget",
          recipientUserIds: [budget.proposedBy],
        });
      return { id: budget.id, status };
    }),
});
