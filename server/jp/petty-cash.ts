import { createHash, randomUUID } from "node:crypto";
import { and, asc, count, desc, eq, gte, inArray, isNull, lte, or, sql } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import {
  attachments,
  auditEvents,
  organizationMemberships,
  permissionGrants,
  pettyCashFunds,
  pettyCashMovements,
  siteAssignments,
  sites,
  users,
  workTasks,
} from "../../drizzle/schema";
import {
  assertPettyCashPostingWithinLimits,
  calculatePettyCashBalance,
  calculateRemainingPettyCashReturnMinor,
  parseRupeesToMinor,
} from "../../lib/jp/finance-domain";
import {
  pettyCashCustodianAcknowledgementError,
  pettyCashEvidenceRequirementError,
  pettyCashExpenseFundingSourceError,
  pettyCashMovementTransitionError,
} from "../../lib/jp/petty-cash-policy";
import { getDb } from "../db";
import { protectedProcedure, router } from "../_core/trpc";
import { getSiteScope, type SiteScope } from "./access";

type CashMovementType = "Funding" | "Expense" | "Cash Return";
type CashPermission = "finance.cash.movement.review" | "finance.cash.movement.post";
type ScopeIds = Pick<SiteScope, "organizationId" | "projectId" | "siteId">;

const uuidSchema = z.string().uuid();
const mutationIdSchema = z.string().trim().min(16).max(64);
const pageSchema = {
  offset: z.number().int().min(0).max(1_000_000).default(0),
  limit: z.number().int().min(1).max(100).default(25),
};
const dateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine((value) => {
    const parsed = new Date(`${value}T00:00:00.000Z`);
    return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
  }, "Enter a valid calendar date.");
const rupeesSchema = z
  .string()
  .trim()
  .regex(/^\d{1,16}(?:\.\d{1,2})?$/)
  .refine((value) => {
    try {
      parseRupeesToMinor(value);
      return true;
    } catch {
      return false;
    }
  }, "Enter a positive rupee amount with at most two decimal places.");
const reasonSchema = z.string().trim().min(3).max(1200);
const decisionSchema = z.enum(["Approved", "Rejected"]);
const paymentModeSchema = z.enum(["Cash", "UPI", "Bank Transfer", "Cheque", "Card", "Other"]);
const fundingSourceSchema = z.enum([
  "Company cash issue",
  "Approved bank/cash withdrawal",
  "Other approved source",
]);
const optionalText = (maximum: number) => z.string().trim().max(maximum).optional();

function requireDb(db: Awaited<ReturnType<typeof getDb>>) {
  if (!db)
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message: "The business data service is temporarily unavailable.",
    });
  return db;
}
function safeRequestId(value: string | string[] | undefined) {
  return typeof value === "string" && value.length <= 100 ? value : undefined;
}
function payloadHash(value: unknown) {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}
function conflict(message: string): never {
  throw new TRPCError({ code: "CONFLICT", message });
}
function enforcePolicyError(
  error: {
    code: "FORBIDDEN" | "CONFLICT" | "PRECONDITION_FAILED" | "BAD_REQUEST";
    message: string;
  } | null,
) {
  if (error) throw new TRPCError(error);
}
function grantAppliesToSite(grant: typeof permissionGrants.$inferSelect, scope: ScopeIds) {
  if (grant.scopeType === "organization") return grant.scopeId === scope.organizationId;
  if (grant.scopeType === "project") return grant.scopeId === scope.projectId;
  return grant.scopeId === scope.siteId;
}

async function findMutationEvent(queryable: any, actorUserId: number, clientMutationId: string) {
  const [event] = await queryable
    .select()
    .from(auditEvents)
    .where(
      and(
        eq(auditEvents.actorUserId, actorUserId),
        eq(auditEvents.clientMutationId, clientMutationId),
      ),
    )
    .limit(1);
  return event ?? null;
}
function verifyMutationEvent(
  event: typeof auditEvents.$inferSelect,
  expected: {
    action: string;
    entityType: string;
    entityId: string;
    afterSummary: string;
    reason: string | null;
  },
) {
  if (
    event.action !== expected.action ||
    event.entityType !== expected.entityType ||
    event.entityId !== expected.entityId ||
    event.afterSummary !== expected.afterSummary ||
    event.reason !== expected.reason
  ) {
    conflict("This retry key is already associated with a different petty-cash action or payload.");
  }
}
async function writeAudit(
  tx: any,
  input: {
    organizationId: string;
    siteId: string;
    actorUserId: number;
    action: string;
    entityType: string;
    entityId: string;
    clientMutationId: string;
    requestId?: string;
    beforeSummary?: string | null;
    afterSummary: string;
    reason?: string | null;
  },
) {
  await tx.insert(auditEvents).values({ id: randomUUID(), ...input });
}
async function loadFund(queryable: any, scope: ScopeIds, fundId: string, lock = false) {
  let query = queryable
    .select()
    .from(pettyCashFunds)
    .where(
      and(
        eq(pettyCashFunds.organizationId, scope.organizationId),
        eq(pettyCashFunds.siteId, scope.siteId),
        eq(pettyCashFunds.id, fundId),
      ),
    )
    .limit(1);
  if (lock) query = query.for("update");
  const [fund] = await query;
  if (!fund)
    throw new TRPCError({ code: "NOT_FOUND", message: "Petty-cash fund not found in this site." });
  return fund;
}
async function loadMovement(queryable: any, scope: ScopeIds, movementId: string, lock = false) {
  let query = queryable
    .select()
    .from(pettyCashMovements)
    .where(
      and(
        eq(pettyCashMovements.organizationId, scope.organizationId),
        eq(pettyCashMovements.siteId, scope.siteId),
        eq(pettyCashMovements.id, movementId),
      ),
    )
    .limit(1);
  if (lock) query = query.for("update");
  const [movement] = await query;
  if (!movement)
    throw new TRPCError({
      code: "NOT_FOUND",
      message: "Petty-cash movement not found in this site.",
    });
  return movement;
}
async function loadPostedFundBalance(queryable: any, scope: ScopeIds, fundId: string) {
  const rows = await queryable
    .select({
      movementType: pettyCashMovements.movementType,
      amountMinor: sql<string>`coalesce(sum(${pettyCashMovements.amountMinor}), 0)`,
    })
    .from(pettyCashMovements)
    .where(
      and(
        eq(pettyCashMovements.organizationId, scope.organizationId),
        eq(pettyCashMovements.siteId, scope.siteId),
        eq(pettyCashMovements.fundId, fundId),
        eq(pettyCashMovements.status, "Posted"),
      ),
    )
    .groupBy(pettyCashMovements.movementType);
  return calculatePettyCashBalance(
    rows.map((row: { movementType: CashMovementType; amountMinor: string }) => ({
      movementType: row.movementType,
      amountMinor: String(row.amountMinor),
      status: "Posted",
    })),
  );
}
async function loadReturnableBalance(
  queryable: any,
  scope: ScopeIds,
  fundId: string,
  expense: {
    id: string;
    amountMinor: string;
    taskId: string | null;
  },
) {
  const [aggregate] = await queryable
    .select({
      total: sql<string>`coalesce(sum(${pettyCashMovements.amountMinor}), 0)`,
    })
    .from(pettyCashMovements)
    .where(
      and(
        eq(pettyCashMovements.organizationId, scope.organizationId),
        eq(pettyCashMovements.siteId, scope.siteId),
        eq(pettyCashMovements.fundId, fundId),
        eq(pettyCashMovements.movementType, "Cash Return"),
        eq(pettyCashMovements.relatedMovementId, expense.id),
        eq(pettyCashMovements.status, "Posted"),
      ),
    );
  const remainingMinor = calculateRemainingPettyCashReturnMinor(expense.amountMinor, [
    String(aggregate?.total ?? "0"),
  ]);
  return { remainingMinor, taskId: expense.taskId };
}
async function loadMovementByEvent(
  queryable: any,
  scope: ScopeIds,
  event: typeof auditEvents.$inferSelect,
) {
  return loadMovement(queryable, scope, event.entityId);
}

/** Grant limits are applied to workflow actor/time, and required evidence is fail-closed. */
async function enforceConfiguredActionLimits(
  tx: any,
  input: {
    userId: number;
    scope: ScopeIds;
    permissionKey: CashPermission;
    movementId: string;
    amountMinor: string;
  },
) {
  const now = new Date();
  const grants = await tx
    .select()
    .from(permissionGrants)
    .where(
      and(
        eq(permissionGrants.organizationId, input.scope.organizationId),
        eq(permissionGrants.userId, input.userId),
        eq(permissionGrants.permissionKey, input.permissionKey),
        eq(permissionGrants.status, "Active"),
        lte(permissionGrants.effectiveFrom, now),
        or(isNull(permissionGrants.effectiveTo), gte(permissionGrants.effectiveTo, now)),
      ),
    )
    .for("update");
  const matching = (grants as (typeof permissionGrants.$inferSelect)[]).filter(
    (grant) => grant.effect === "allow" && grantAppliesToSite(grant, input.scope),
  );

  for (const grant of matching) {
    if (grant.maxAmountMinor !== null && BigInt(input.amountMinor) > BigInt(grant.maxAmountMinor)) {
      throw new TRPCError({
        code: "PRECONDITION_FAILED",
        message:
          "This petty-cash movement exceeds your configured per-action limit. It remains unposted and must be routed to another authorised reviewer/poster.",
      });
    }
    for (const [period, limit] of [
      ["daily", grant.dailyLimitMinor],
      ["monthly", grant.monthlyLimitMinor],
    ] as const) {
      if (limit === null) continue;
      const start = new Date(now);
      if (period === "daily") start.setUTCHours(0, 0, 0, 0);
      else {
        start.setUTCDate(1);
        start.setUTCHours(0, 0, 0, 0);
      }
      let siteIds: string[];
      if (grant.scopeType === "site") siteIds = [grant.scopeId];
      else {
        const siteQuery = tx
          .select({ id: sites.id })
          .from(sites)
          .where(
            and(
              eq(sites.organizationId, input.scope.organizationId),
              ...(grant.scopeType === "project" ? [eq(sites.projectId, grant.scopeId)] : []),
            ),
          );
        siteIds = (await siteQuery).map((row: { id: string }) => row.id);
      }
      if (siteIds.length === 0) continue;
      const actorColumn =
        input.permissionKey === "finance.cash.movement.post"
          ? pettyCashMovements.postedBy
          : pettyCashMovements.reviewedBy;
      const timeColumn =
        input.permissionKey === "finance.cash.movement.post"
          ? pettyCashMovements.postedAt
          : pettyCashMovements.reviewedAt;
      const statusCondition =
        input.permissionKey === "finance.cash.movement.post"
          ? eq(pettyCashMovements.status, "Posted")
          : inArray(pettyCashMovements.status, ["Approved", "Posted"]);
      const [sumRow] = await tx
        .select({
          total: sql<string>`coalesce(sum(${pettyCashMovements.amountMinor}), 0)`,
        })
        .from(pettyCashMovements)
        .where(
          and(
            eq(pettyCashMovements.organizationId, input.scope.organizationId),
            inArray(pettyCashMovements.siteId, siteIds),
            eq(actorColumn, input.userId),
            gte(timeColumn, start),
            lte(timeColumn, now),
            statusCondition,
          ),
        );
      if (BigInt(String(sumRow?.total ?? "0")) + BigInt(input.amountMinor) > BigInt(limit)) {
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message: `This petty-cash movement would exceed your configured ${period} limit. No posting was made.`,
        });
      }
    }
    if (grant.requiresEvidence === "yes") {
      const [evidence] = await tx
        .select({ id: attachments.id })
        .from(attachments)
        .where(
          and(
            eq(attachments.organizationId, input.scope.organizationId),
            eq(attachments.entityType, "petty_cash_movement"),
            eq(attachments.entityId, input.movementId),
            eq(attachments.accessClassification, "Private"),
            eq(attachments.scanStatus, "Accepted"),
          ),
        )
        .limit(1);
      enforcePolicyError(
        pettyCashEvidenceRequirementError({
          requiresEvidence: true,
          hasAcceptedPrivateEvidence: Boolean(evidence),
        }),
      );
    }
  }
}

const createMovementSchema = z
  .object({
    siteId: uuidSchema,
    fundId: uuidSchema,
    movementType: z.enum(["Funding", "Expense", "Cash Return"]),
    amountRupees: rupeesSchema,
    movementDate: dateSchema,
    paymentMode: paymentModeSchema,
    payeeName: z.string().trim().min(2).max(180),
    paidByName: z.string().trim().min(2).max(180),
    fundingSource: fundingSourceSchema.optional(),
    expenseFundingSource: z.enum(["Site Petty Cash", "Personal Funds"]).optional(),
    fundSourceAttested: z.boolean().optional(),
    category: z.string().trim().min(2).max(80),
    purpose: z.string().trim().min(4).max(1200),
    taskId: uuidSchema.optional(),
    relatedMovementId: uuidSchema.optional(),
    receiptReference: optionalText(160),
    receiptMissingReason: optionalText(1200),
    clientMutationId: mutationIdSchema,
  })
  .superRefine((input, ctx) => {
    if (input.movementType === "Funding" && !input.fundingSource)
      ctx.addIssue({
        code: "custom",
        path: ["fundingSource"],
        message: "Select the funding source label.",
      });
    if (input.movementType !== "Funding" && input.fundingSource)
      ctx.addIssue({
        code: "custom",
        path: ["fundingSource"],
        message: "Funding source is only valid for fund top-ups.",
      });
    const fundingSourceError = pettyCashExpenseFundingSourceError({
      movementType: input.movementType,
      expenseFundingSource: input.expenseFundingSource ?? null,
      fundSourceAttested: input.fundSourceAttested === true,
    });
    if (fundingSourceError)
      ctx.addIssue({
        code: "custom",
        path: ["expenseFundingSource"],
        message: fundingSourceError.message,
      });
    if (input.movementType === "Cash Return" && !input.relatedMovementId)
      ctx.addIssue({
        code: "custom",
        path: ["relatedMovementId"],
        message: "Select the original Posted expense for this cash return.",
      });
    if (input.movementType !== "Cash Return" && input.relatedMovementId)
      ctx.addIssue({
        code: "custom",
        path: ["relatedMovementId"],
        message: "Only a cash return can link to an original movement.",
      });
    if (input.movementType === "Cash Return" && input.paymentMode !== "Cash")
      ctx.addIssue({
        code: "custom",
        path: ["paymentMode"],
        message: "A return to the petty-cash fund must be recorded as Cash.",
      });
    if (input.movementType !== "Expense" && input.taskId)
      ctx.addIssue({
        code: "custom",
        path: ["taskId"],
        message: "Only an expense can be assigned to a work task.",
      });
    if (!input.receiptReference?.trim() && !input.receiptMissingReason?.trim()) {
      ctx.addIssue({
        code: "custom",
        path: ["receiptMissingReason"],
        message: "Enter a receipt reference or explain why the receipt is absent.",
      });
    }
  });

export const pettyCashRouter = router({
  listFunds: protectedProcedure
    .input(z.object({ siteId: uuidSchema, ...pageSchema }))
    .query(async ({ ctx, input }) => {
      const scope = await getSiteScope(ctx.user, input.siteId, "finance.cash.view");
      const db = requireDb(await getDb());
      const predicate = and(
        eq(pettyCashFunds.organizationId, scope.organizationId),
        eq(pettyCashFunds.siteId, scope.siteId),
      );
      const [{ total = 0 } = {}] = await db
        .select({ total: count() })
        .from(pettyCashFunds)
        .where(predicate);
      const funds = await db
        .select()
        .from(pettyCashFunds)
        .where(predicate)
        .orderBy(asc(pettyCashFunds.name))
        .offset(input.offset)
        .limit(input.limit);
      const fundIds = funds.map((fund) => fund.id);
      const aggregates =
        fundIds.length === 0
          ? []
          : await db
              .select({
                fundId: pettyCashMovements.fundId,
                movementType: pettyCashMovements.movementType,
                amountMinor: sql<string>`coalesce(sum(${pettyCashMovements.amountMinor}), 0)`,
              })
              .from(pettyCashMovements)
              .where(
                and(
                  eq(pettyCashMovements.organizationId, scope.organizationId),
                  eq(pettyCashMovements.siteId, scope.siteId),
                  inArray(pettyCashMovements.fundId, fundIds),
                  eq(pettyCashMovements.status, "Posted"),
                ),
              )
              .groupBy(pettyCashMovements.fundId, pettyCashMovements.movementType);
      const rowsByFund = new Map<string, typeof aggregates>();
      for (const aggregate of aggregates)
        rowsByFund.set(aggregate.fundId, [...(rowsByFund.get(aggregate.fundId) ?? []), aggregate]);
      return {
        offset: input.offset,
        limit: input.limit,
        total,
        items: funds.map((fund) => ({
          ...fund,
          ...calculatePettyCashBalance(
            (rowsByFund.get(fund.id) ?? []).map((row) => ({
              movementType: row.movementType,
              amountMinor: String(row.amountMinor),
              status: "Posted",
            })),
          ),
        })),
      };
    }),

  listCustodianCandidates: protectedProcedure
    .input(z.object({ siteId: uuidSchema }))
    .query(async ({ ctx, input }) => {
      const scope = await getSiteScope(ctx.user, input.siteId, "finance.cash.fund.manage");
      const db = requireDb(await getDb());
      const now = new Date();
      const candidates = await db
        .select({ id: users.id, name: users.name, businessRole: siteAssignments.assignmentRole })
        .from(siteAssignments)
        .innerJoin(sites, eq(siteAssignments.siteId, sites.id))
        .innerJoin(users, eq(siteAssignments.userId, users.id))
        .innerJoin(
          organizationMemberships,
          and(
            eq(organizationMemberships.organizationId, scope.organizationId),
            eq(organizationMemberships.userId, users.id),
            eq(organizationMemberships.status, "Active"),
          ),
        )
        .where(
          and(
            eq(siteAssignments.siteId, scope.siteId),
            eq(siteAssignments.status, "Active"),
            inArray(siteAssignments.assignmentRole, [
              "owner",
              "director",
              "admin",
              "project_manager",
              "supervisor",
              "accounts",
            ]),
            lte(siteAssignments.effectiveFrom, now),
            or(isNull(siteAssignments.effectiveTo), gte(siteAssignments.effectiveTo, now)),
            eq(users.accountStatus, "Active"),
          ),
        )
        .orderBy(asc(users.name))
        .limit(100);
      const unique = new Map(candidates.map((candidate) => [candidate.id, candidate]));
      return [...unique.values()].map((candidate) => ({
        id: candidate.id,
        name: candidate.name?.trim() || `User #${candidate.id}`,
        businessRole: candidate.businessRole,
      }));
    }),

  listTaskOptions: protectedProcedure
    .input(z.object({ siteId: uuidSchema }))
    .query(async ({ ctx, input }) => {
      const scope = await getSiteScope(ctx.user, input.siteId, "finance.cash.view");
      const db = requireDb(await getDb());
      return db
        .select({
          id: workTasks.id,
          taskCode: workTasks.taskCode,
          title: workTasks.title,
          status: workTasks.status,
        })
        .from(workTasks)
        .where(
          and(
            eq(workTasks.organizationId, scope.organizationId),
            eq(workTasks.siteId, scope.siteId),
            inArray(workTasks.status, [
              "Planned",
              "Ready",
              "In Progress",
              "Blocked",
              "Awaiting Inspection",
            ]),
          ),
        )
        .orderBy(asc(workTasks.taskCode))
        .limit(100);
    }),

  listMovements: protectedProcedure
    .input(
      z.object({
        siteId: uuidSchema,
        fundId: uuidSchema,
        ...pageSchema,
      }),
    )
    .query(async ({ ctx, input }) => {
      const scope = await getSiteScope(ctx.user, input.siteId, "finance.cash.view");
      const db = requireDb(await getDb());
      await loadFund(db, scope, input.fundId);
      const predicate = and(
        eq(pettyCashMovements.organizationId, scope.organizationId),
        eq(pettyCashMovements.siteId, scope.siteId),
        eq(pettyCashMovements.fundId, input.fundId),
      );
      const [{ total = 0 } = {}] = await db
        .select({ total: count() })
        .from(pettyCashMovements)
        .where(predicate);
      const rows = await db
        .select()
        .from(pettyCashMovements)
        .where(predicate)
        .orderBy(desc(pettyCashMovements.movementDate), desc(pettyCashMovements.createdAt))
        .offset(input.offset)
        .limit(input.limit);
      const actorIds = [
        ...new Set(
          rows.flatMap((movement) =>
            [
              movement.createdBy,
              movement.submittedBy,
              movement.reviewedBy,
              movement.postedBy,
              movement.cancelledBy,
            ].filter((id): id is number => id !== null),
          ),
        ),
      ];
      const actors =
        actorIds.length === 0
          ? []
          : await db
              .select({ id: users.id, name: users.name })
              .from(users)
              .where(inArray(users.id, actorIds));
      const actorNames = new Map(
        actors.map((actor) => [actor.id, actor.name?.trim() || `User #${actor.id}`]),
      );
      return {
        offset: input.offset,
        limit: input.limit,
        total,
        items: rows.map((movement) => ({
          ...movement,
          taskCode: movement.taskCodeSnapshot,
          taskTitle: movement.taskTitleSnapshot,
          taskStatus: movement.taskStatusSnapshot,
          createdByName: actorNames.get(movement.createdBy) ?? `User #${movement.createdBy}`,
          submittedByName:
            movement.submittedBy === null
              ? null
              : (actorNames.get(movement.submittedBy) ?? `User #${movement.submittedBy}`),
          reviewedByName:
            movement.reviewedBy === null
              ? null
              : (actorNames.get(movement.reviewedBy) ?? `User #${movement.reviewedBy}`),
          postedByName:
            movement.postedBy === null
              ? null
              : (actorNames.get(movement.postedBy) ?? `User #${movement.postedBy}`),
          cancelledByName:
            movement.cancelledBy === null
              ? null
              : (actorNames.get(movement.cancelledBy) ?? `User #${movement.cancelledBy}`),
        })),
      };
    }),

  listReturnCandidates: protectedProcedure
    .input(
      z.object({
        siteId: uuidSchema,
        fundId: uuidSchema,
        ...pageSchema,
      }),
    )
    .query(async ({ ctx, input }) => {
      const scope = await getSiteScope(ctx.user, input.siteId, "finance.cash.view");
      const db = requireDb(await getDb());
      await loadFund(db, scope, input.fundId);
      const predicate = and(
        eq(pettyCashMovements.organizationId, scope.organizationId),
        eq(pettyCashMovements.siteId, scope.siteId),
        eq(pettyCashMovements.fundId, input.fundId),
        eq(pettyCashMovements.movementType, "Expense"),
        eq(pettyCashMovements.status, "Posted"),
      );
      const [{ total = 0 } = {}] = await db
        .select({ total: count() })
        .from(pettyCashMovements)
        .where(predicate);
      const expenses = await db
        .select({
          id: pettyCashMovements.id,
          amountMinor: pettyCashMovements.amountMinor,
          movementDate: pettyCashMovements.movementDate,
          payeeName: pettyCashMovements.payeeName,
          purpose: pettyCashMovements.purpose,
          taskId: pettyCashMovements.taskId,
        })
        .from(pettyCashMovements)
        .where(predicate)
        .orderBy(desc(pettyCashMovements.movementDate), desc(pettyCashMovements.createdAt))
        .offset(input.offset)
        .limit(input.limit);
      const expenseIds = expenses.map((expense) => expense.id);
      const returns =
        expenseIds.length === 0
          ? []
          : await db
              .select({
                relatedMovementId: pettyCashMovements.relatedMovementId,
                totalMinor: sql<string>`coalesce(sum(${pettyCashMovements.amountMinor}), 0)`,
              })
              .from(pettyCashMovements)
              .where(
                and(
                  eq(pettyCashMovements.organizationId, scope.organizationId),
                  eq(pettyCashMovements.siteId, scope.siteId),
                  eq(pettyCashMovements.fundId, input.fundId),
                  eq(pettyCashMovements.movementType, "Cash Return"),
                  eq(pettyCashMovements.status, "Posted"),
                  inArray(pettyCashMovements.relatedMovementId, expenseIds),
                ),
              )
              .groupBy(pettyCashMovements.relatedMovementId);
      const returnedByExpense = new Map(
        returns.map((row) => [row.relatedMovementId, String(row.totalMinor)]),
      );
      const items = expenses
        .map((expense) => ({
          ...expense,
          remainingMinor: calculateRemainingPettyCashReturnMinor(expense.amountMinor, [
            returnedByExpense.get(expense.id) ?? "0",
          ]),
        }))
        .filter((expense) => BigInt(expense.remainingMinor) > 0n);
      return { offset: input.offset, limit: input.limit, total, items };
    }),

  createFund: protectedProcedure
    .input(
      z.object({
        siteId: uuidSchema,
        name: z.string().trim().min(2).max(120),
        custodianUserId: z.number().int().positive(),
        authorizedLimitRupees: rupeesSchema,
        reconciliationPeriod: z.enum(["Weekly", "Fortnightly", "Monthly", "Quarterly"]),
        clientMutationId: mutationIdSchema,
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const scope = await getSiteScope(ctx.user, input.siteId, "finance.cash.fund.manage");
      const db = requireDb(await getDb());
      const limitMinor = parseRupeesToMinor(input.authorizedLimitRupees);
      const normalizedName = input.name.trim();
      const nameKey = normalizedName.toLocaleLowerCase("en-US");
      const id = randomUUID();
      const afterSummary = payloadHash({
        name: normalizedName,
        custodianUserId: input.custodianUserId,
        limitMinor,
        period: input.reconciliationPeriod,
      });
      const existingEvent = await findMutationEvent(db, ctx.user.id, input.clientMutationId);
      if (existingEvent) {
        verifyMutationEvent(existingEvent, {
          action: "petty_cash.fund.create",
          entityType: "petty_cash_fund",
          entityId: existingEvent.entityId,
          afterSummary,
          reason: null,
        });
        return loadFund(db, scope, existingEvent.entityId);
      }
      await db.transaction(async (tx) => {
        const now = new Date();
        const [custodian] = await tx
          .select({ id: users.id, name: users.name })
          .from(users)
          .innerJoin(
            organizationMemberships,
            and(
              eq(organizationMemberships.organizationId, scope.organizationId),
              eq(organizationMemberships.userId, users.id),
              eq(organizationMemberships.status, "Active"),
            ),
          )
          .innerJoin(
            siteAssignments,
            and(
              eq(siteAssignments.siteId, scope.siteId),
              eq(siteAssignments.userId, users.id),
              eq(siteAssignments.status, "Active"),
              inArray(siteAssignments.assignmentRole, [
                "owner",
                "director",
                "admin",
                "project_manager",
                "supervisor",
                "accounts",
              ]),
              lte(siteAssignments.effectiveFrom, now),
              or(isNull(siteAssignments.effectiveTo), gte(siteAssignments.effectiveTo, now)),
            ),
          )
          .where(and(eq(users.id, input.custodianUserId), eq(users.accountStatus, "Active")))
          .limit(1);
        if (!custodian?.name?.trim())
          throw new TRPCError({
            code: "PRECONDITION_FAILED",
            message: "Choose an active, site-assigned custodian with a display name.",
          });
        const [duplicate] = await tx
          .select({ id: pettyCashFunds.id })
          .from(pettyCashFunds)
          .where(
            and(
              eq(pettyCashFunds.organizationId, scope.organizationId),
              eq(pettyCashFunds.siteId, scope.siteId),
              eq(pettyCashFunds.nameKey, nameKey),
            ),
          )
          .limit(1);
        if (duplicate) conflict("A petty-cash fund with this name already exists in the site.");
        await tx.insert(pettyCashFunds).values({
          id,
          organizationId: scope.organizationId,
          siteId: scope.siteId,
          name: normalizedName,
          nameKey,
          custodianUserId: custodian.id,
          custodianNameSnapshot: custodian.name.trim(),
          authorizedLimitMinor: limitMinor,
          reconciliationPeriod: input.reconciliationPeriod,
          status: "Pending Custodian",
          createdBy: ctx.user.id,
          clientMutationId: input.clientMutationId,
        });
        await writeAudit(tx, {
          organizationId: scope.organizationId,
          siteId: scope.siteId,
          actorUserId: ctx.user.id,
          action: "petty_cash.fund.create",
          entityType: "petty_cash_fund",
          entityId: id,
          clientMutationId: input.clientMutationId,
          requestId: safeRequestId(ctx.req.headers["x-request-id"]),
          afterSummary,
        });
      });
      return loadFund(db, scope, id);
    }),

  acknowledgeFund: protectedProcedure
    .input(
      z.object({
        siteId: uuidSchema,
        fundId: uuidSchema,
        clientMutationId: mutationIdSchema,
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const scope = await getSiteScope(ctx.user, input.siteId, "site.view");
      const db = requireDb(await getDb());
      const existingEvent = await findMutationEvent(db, ctx.user.id, input.clientMutationId);
      if (existingEvent) {
        verifyMutationEvent(existingEvent, {
          action: "petty_cash.fund.acknowledge",
          entityType: "petty_cash_fund",
          entityId: input.fundId,
          afterSummary: "Active",
          reason: null,
        });
        return loadFund(db, scope, input.fundId);
      }
      await db.transaction(async (tx) => {
        const fund = await loadFund(tx, scope, input.fundId, true);
        const now = new Date();
        const [siteState] = await tx
          .select({ status: sites.status })
          .from(sites)
          .where(and(eq(sites.organizationId, scope.organizationId), eq(sites.id, scope.siteId)))
          .for("update")
          .limit(1);
        if (!siteState)
          throw new TRPCError({ code: "NOT_FOUND", message: "Assigned site not found." });
        const [activeAssignment] = await tx
          .select({ id: siteAssignments.id })
          .from(siteAssignments)
          .innerJoin(users, eq(siteAssignments.userId, users.id))
          .innerJoin(
            organizationMemberships,
            and(
              eq(organizationMemberships.organizationId, scope.organizationId),
              eq(organizationMemberships.userId, users.id),
              eq(organizationMemberships.status, "Active"),
            ),
          )
          .where(
            and(
              eq(siteAssignments.siteId, scope.siteId),
              eq(siteAssignments.userId, ctx.user.id),
              eq(siteAssignments.status, "Active"),
              inArray(siteAssignments.assignmentRole, [
                "owner",
                "director",
                "admin",
                "project_manager",
                "supervisor",
                "accounts",
              ]),
              lte(siteAssignments.effectiveFrom, now),
              or(isNull(siteAssignments.effectiveTo), gte(siteAssignments.effectiveTo, now)),
              eq(users.accountStatus, "Active"),
            ),
          )
          .for("update")
          .limit(1);
        enforcePolicyError(
          pettyCashCustodianAcknowledgementError({
            siteStatus: siteState.status,
            fundStatus: fund.status,
            actorIsNamedCustodian: fund.custodianUserId === ctx.user.id,
            hasCurrentActiveSiteAssignment: Boolean(activeAssignment),
          }),
        );
        await tx
          .update(pettyCashFunds)
          .set({
            status: "Active",
            custodianAcknowledgedBy: ctx.user.id,
            custodianAcknowledgedAt: now,
          })
          .where(
            and(
              eq(pettyCashFunds.organizationId, scope.organizationId),
              eq(pettyCashFunds.siteId, scope.siteId),
              eq(pettyCashFunds.id, input.fundId),
            ),
          );
        await writeAudit(tx, {
          organizationId: scope.organizationId,
          siteId: scope.siteId,
          actorUserId: ctx.user.id,
          action: "petty_cash.fund.acknowledge",
          entityType: "petty_cash_fund",
          entityId: input.fundId,
          clientMutationId: input.clientMutationId,
          requestId: safeRequestId(ctx.req.headers["x-request-id"]),
          beforeSummary: fund.status,
          afterSummary: "Active",
        });
      });
      return loadFund(db, scope, input.fundId);
    }),

  createMovement: protectedProcedure
    .input(createMovementSchema)
    .mutation(async ({ ctx, input }) => {
      const scope = await getSiteScope(ctx.user, input.siteId, "finance.cash.movement.create");
      const db = requireDb(await getDb());
      const amountMinor = parseRupeesToMinor(input.amountRupees);
      const normalized = {
        fundId: input.fundId,
        movementType: input.movementType,
        amountMinor,
        movementDate: input.movementDate,
        paymentMode: input.paymentMode,
        payeeName: input.payeeName.trim(),
        paidByName: input.paidByName.trim(),
        fundingSource: input.fundingSource ?? null,
        expenseFundingSource: input.expenseFundingSource ?? null,
        fundSourceAttested: input.fundSourceAttested === true,
        category: input.category.trim(),
        purpose: input.purpose.trim(),
        taskId: input.taskId ?? null,
        relatedMovementId: input.relatedMovementId ?? null,
        receiptReference: input.receiptReference?.trim() || null,
        receiptMissingReason: input.receiptMissingReason?.trim() || null,
      };
      const afterSummary = payloadHash(normalized);
      const createAuditReason =
        normalized.movementType === "Expense"
          ? "Creator confirmed this Expense was paid directly from the selected site petty-cash fund; Personal Funds are not eligible in this ledger."
          : null;
      const existingEvent = await findMutationEvent(db, ctx.user.id, input.clientMutationId);
      if (existingEvent) {
        verifyMutationEvent(existingEvent, {
          action: "petty_cash.movement.create",
          entityType: "petty_cash_movement",
          entityId: existingEvent.entityId,
          afterSummary,
          reason: createAuditReason,
        });
        return loadMovement(db, scope, existingEvent.entityId);
      }
      const id = randomUUID();
      await db.transaction(async (tx) => {
        const fund = await loadFund(tx, scope, input.fundId, true);
        if (fund.status !== "Active")
          throw new TRPCError({
            code: "PRECONDITION_FAILED",
            message:
              "The petty-cash fund must be Active after custodian acknowledgement before a movement can be recorded.",
          });
        let taskId = normalized.taskId;
        let taskSnapshot: {
          taskCode: string | null;
          taskTitle: string | null;
          taskStatus: string | null;
        } | null = null;
        if (input.movementType === "Cash Return") {
          const original = await loadMovement(tx, scope, input.relatedMovementId!, true);
          if (
            original.fundId !== fund.id ||
            original.movementType !== "Expense" ||
            original.status !== "Posted"
          ) {
            throw new TRPCError({
              code: "PRECONDITION_FAILED",
              message: "Choose a Posted expense from the same site fund for a cash return.",
            });
          }
          const { remainingMinor, taskId: originalTaskId } = await loadReturnableBalance(
            tx,
            scope,
            fund.id,
            { id: original.id, amountMinor: original.amountMinor, taskId: original.taskId },
          );
          if (BigInt(amountMinor) > BigInt(remainingMinor))
            throw new TRPCError({
              code: "PRECONDITION_FAILED",
              message: "The cash return exceeds the remaining amount of its linked Posted expense.",
            });
          taskId = originalTaskId;
          taskSnapshot = originalTaskId
            ? {
                taskCode: original.taskCodeSnapshot,
                taskTitle: original.taskTitleSnapshot,
                taskStatus: original.taskStatusSnapshot,
              }
            : null;
        }
        if (taskId && input.movementType === "Expense") {
          const [task] = await tx
            .select({
              id: workTasks.id,
              taskCode: workTasks.taskCode,
              taskTitle: workTasks.title,
              taskStatus: workTasks.status,
            })
            .from(workTasks)
            .where(
              and(
                eq(workTasks.organizationId, scope.organizationId),
                eq(workTasks.siteId, scope.siteId),
                eq(workTasks.id, taskId),
              ),
            )
            .limit(1);
          if (!task)
            throw new TRPCError({
              code: "PRECONDITION_FAILED",
              message: "The selected task does not belong to this site.",
            });
          taskSnapshot = {
            taskCode: task.taskCode,
            taskTitle: task.taskTitle,
            taskStatus: task.taskStatus,
          };
        }
        const sourceAccountLabel =
          input.movementType === "Funding"
            ? input.fundingSource!
            : input.movementType === "Expense"
              ? `Petty-cash fund: ${fund.name}`
              : `Cash returned to petty-cash fund: ${fund.name}`;
        const payeeName =
          input.movementType === "Funding" ? fund.custodianNameSnapshot : normalized.payeeName;
        await tx.insert(pettyCashMovements).values({
          id,
          organizationId: scope.organizationId,
          siteId: scope.siteId,
          fundId: fund.id,
          movementType: input.movementType,
          amountMinor,
          currency: "INR",
          movementDate: input.movementDate,
          paymentMode: input.paymentMode,
          payeeName,
          paidByName: normalized.paidByName,
          sourceAccountLabel,
          expenseFundingSource: normalized.movementType === "Expense" ? "Site Petty Cash" : null,
          fundSourceAttestation:
            normalized.movementType === "Expense" ? "Confirmed" : "Not Applicable",
          category: normalized.category,
          purpose: normalized.purpose,
          taskId,
          taskCodeSnapshot: taskSnapshot?.taskCode ?? null,
          taskTitleSnapshot: taskSnapshot?.taskTitle ?? null,
          taskStatusSnapshot: taskSnapshot?.taskStatus ?? null,
          relatedMovementId: normalized.relatedMovementId,
          receiptReference: normalized.receiptReference,
          receiptMissingReason: normalized.receiptMissingReason,
          status: "Draft",
          createdBy: ctx.user.id,
          clientMutationId: input.clientMutationId,
        });
        await writeAudit(tx, {
          organizationId: scope.organizationId,
          siteId: scope.siteId,
          actorUserId: ctx.user.id,
          action: "petty_cash.movement.create",
          entityType: "petty_cash_movement",
          entityId: id,
          clientMutationId: input.clientMutationId,
          requestId: safeRequestId(ctx.req.headers["x-request-id"]),
          afterSummary,
          reason: createAuditReason,
        });
      });
      return loadMovement(db, scope, id);
    }),

  submitMovement: protectedProcedure
    .input(
      z.object({
        siteId: uuidSchema,
        movementId: uuidSchema,
        clientMutationId: mutationIdSchema,
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const scope = await getSiteScope(ctx.user, input.siteId, "finance.cash.movement.submit");
      const db = requireDb(await getDb());
      const existingEvent = await findMutationEvent(db, ctx.user.id, input.clientMutationId);
      if (existingEvent) {
        verifyMutationEvent(existingEvent, {
          action: "petty_cash.movement.submit",
          entityType: "petty_cash_movement",
          entityId: input.movementId,
          afterSummary: "Submitted",
          reason: null,
        });
        return loadMovementByEvent(db, scope, existingEvent);
      }
      await db.transaction(async (tx) => {
        const movement = await loadMovement(tx, scope, input.movementId, true);
        const fund = await loadFund(tx, scope, movement.fundId);
        enforcePolicyError(
          pettyCashMovementTransitionError({
            action: "submit",
            status: movement.status,
            actorUserId: ctx.user.id,
            createdBy: movement.createdBy,
            fundStatus: fund.status,
          }),
        );
        const now = new Date();
        await tx
          .update(pettyCashMovements)
          .set({ status: "Submitted", submittedBy: ctx.user.id, submittedAt: now })
          .where(
            and(
              eq(pettyCashMovements.organizationId, scope.organizationId),
              eq(pettyCashMovements.siteId, scope.siteId),
              eq(pettyCashMovements.id, input.movementId),
            ),
          );
        await writeAudit(tx, {
          organizationId: scope.organizationId,
          siteId: scope.siteId,
          actorUserId: ctx.user.id,
          action: "petty_cash.movement.submit",
          entityType: "petty_cash_movement",
          entityId: input.movementId,
          clientMutationId: input.clientMutationId,
          requestId: safeRequestId(ctx.req.headers["x-request-id"]),
          beforeSummary: movement.status,
          afterSummary: "Submitted",
        });
      });
      return loadMovement(db, scope, input.movementId);
    }),

  reviewMovement: protectedProcedure
    .input(
      z.object({
        siteId: uuidSchema,
        movementId: uuidSchema,
        decision: decisionSchema,
        reason: reasonSchema,
        clientMutationId: mutationIdSchema,
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const scope = await getSiteScope(ctx.user, input.siteId, "finance.cash.movement.review");
      const db = requireDb(await getDb());
      const existingEvent = await findMutationEvent(db, ctx.user.id, input.clientMutationId);
      if (existingEvent) {
        verifyMutationEvent(existingEvent, {
          action: `petty_cash.movement.${input.decision.toLowerCase()}`,
          entityType: "petty_cash_movement",
          entityId: input.movementId,
          afterSummary: input.decision,
          reason: input.reason.trim(),
        });
        return loadMovementByEvent(db, scope, existingEvent);
      }
      await db.transaction(async (tx) => {
        const movement = await loadMovement(tx, scope, input.movementId, true);
        enforcePolicyError(
          pettyCashMovementTransitionError({
            action: "review",
            status: movement.status,
            actorUserId: ctx.user.id,
            createdBy: movement.createdBy,
          }),
        );
        await enforceConfiguredActionLimits(tx, {
          userId: ctx.user.id,
          scope,
          permissionKey: "finance.cash.movement.review",
          movementId: movement.id,
          amountMinor: movement.amountMinor,
        });
        const now = new Date();
        await tx
          .update(pettyCashMovements)
          .set({
            status: input.decision,
            reviewedBy: ctx.user.id,
            reviewedAt: now,
            reviewReason: input.reason.trim(),
          })
          .where(
            and(
              eq(pettyCashMovements.organizationId, scope.organizationId),
              eq(pettyCashMovements.siteId, scope.siteId),
              eq(pettyCashMovements.id, input.movementId),
            ),
          );
        await writeAudit(tx, {
          organizationId: scope.organizationId,
          siteId: scope.siteId,
          actorUserId: ctx.user.id,
          action: `petty_cash.movement.${input.decision.toLowerCase()}`,
          entityType: "petty_cash_movement",
          entityId: input.movementId,
          clientMutationId: input.clientMutationId,
          requestId: safeRequestId(ctx.req.headers["x-request-id"]),
          beforeSummary: movement.status,
          afterSummary: input.decision,
          reason: input.reason.trim(),
        });
      });
      return loadMovement(db, scope, input.movementId);
    }),

  postMovement: protectedProcedure
    .input(
      z.object({
        siteId: uuidSchema,
        movementId: uuidSchema,
        reason: optionalText(1200),
        clientMutationId: mutationIdSchema,
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const scope = await getSiteScope(ctx.user, input.siteId, "finance.cash.movement.post");
      const db = requireDb(await getDb());
      const cleanReason = input.reason?.trim() || null;
      const existingEvent = await findMutationEvent(db, ctx.user.id, input.clientMutationId);
      if (existingEvent) {
        verifyMutationEvent(existingEvent, {
          action: "petty_cash.movement.post",
          entityType: "petty_cash_movement",
          entityId: input.movementId,
          afterSummary: "Posted",
          reason: cleanReason,
        });
        return loadMovementByEvent(db, scope, existingEvent);
      }
      const candidate = await loadMovement(db, scope, input.movementId);
      const hasReviewAuthority = candidate.status === "Submitted";
      if (hasReviewAuthority)
        await getSiteScope(ctx.user, input.siteId, "finance.cash.movement.review");
      await db.transaction(async (tx) => {
        const [fund] = await tx
          .select()
          .from(pettyCashFunds)
          .where(
            and(
              eq(pettyCashFunds.organizationId, scope.organizationId),
              eq(pettyCashFunds.siteId, scope.siteId),
              eq(pettyCashFunds.id, (await loadMovement(tx, scope, input.movementId)).fundId),
            ),
          )
          .for("update")
          .limit(1);
        if (!fund)
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "Petty-cash fund not found in this site.",
          });
        const movement = await loadMovement(tx, scope, input.movementId, true);
        if (movement.fundId !== fund.id)
          conflict("The movement's site-fund scope changed; refresh and try again.");
        if (fund.status !== "Active")
          throw new TRPCError({
            code: "PRECONDITION_FAILED",
            message: "The petty-cash fund is not Active.",
          });
        const directPost = movement.status === "Submitted";
        enforcePolicyError(
          pettyCashMovementTransitionError({
            action: "post",
            status: movement.status,
            actorUserId: ctx.user.id,
            createdBy: movement.createdBy,
            hasReviewAuthority,
            hasDirectPostReason: Boolean(cleanReason),
          }),
        );
        if (directPost) {
          await enforceConfiguredActionLimits(tx, {
            userId: ctx.user.id,
            scope,
            permissionKey: "finance.cash.movement.review",
            movementId: movement.id,
            amountMinor: movement.amountMinor,
          });
        }
        await enforceConfiguredActionLimits(tx, {
          userId: ctx.user.id,
          scope,
          permissionKey: "finance.cash.movement.post",
          movementId: movement.id,
          amountMinor: movement.amountMinor,
        });
        if (movement.movementType === "Cash Return") {
          if (!movement.relatedMovementId)
            throw new TRPCError({
              code: "PRECONDITION_FAILED",
              message: "Cash Return has no original expense link.",
            });
          const original = await loadMovement(tx, scope, movement.relatedMovementId, true);
          if (
            original.fundId !== fund.id ||
            original.movementType !== "Expense" ||
            original.status !== "Posted"
          ) {
            throw new TRPCError({
              code: "PRECONDITION_FAILED",
              message: "The linked original expense is not Posted in this fund.",
            });
          }
          const { remainingMinor } = await loadReturnableBalance(tx, scope, fund.id, {
            id: original.id,
            amountMinor: original.amountMinor,
            taskId: original.taskId,
          });
          if (BigInt(movement.amountMinor) > BigInt(remainingMinor))
            throw new TRPCError({
              code: "PRECONDITION_FAILED",
              message:
                "Posted returns already consume the remaining amount of the original expense.",
            });
        }
        const balance = await loadPostedFundBalance(tx, scope, fund.id);
        let balanceAfterMinor: string;
        try {
          balanceAfterMinor = assertPettyCashPostingWithinLimits({
            movementType: movement.movementType,
            amountMinor: movement.amountMinor,
            balanceMinor: balance.balanceMinor,
            authorizedLimitMinor: fund.authorizedLimitMinor,
          });
        } catch (error) {
          throw new TRPCError({
            code: "PRECONDITION_FAILED",
            message:
              error instanceof Error ? error.message : "Petty-cash posting limits were not met.",
          });
        }
        const now = new Date();
        await tx
          .update(pettyCashMovements)
          .set({
            status: "Posted",
            ...(directPost
              ? {
                  reviewedBy: ctx.user.id,
                  reviewedAt: now,
                  reviewReason: `Direct post: ${cleanReason}`,
                }
              : {}),
            postedBy: ctx.user.id,
            postedAt: now,
          })
          .where(
            and(
              eq(pettyCashMovements.organizationId, scope.organizationId),
              eq(pettyCashMovements.siteId, scope.siteId),
              eq(pettyCashMovements.id, movement.id),
            ),
          );
        await writeAudit(tx, {
          organizationId: scope.organizationId,
          siteId: scope.siteId,
          actorUserId: ctx.user.id,
          action: "petty_cash.movement.post",
          entityType: "petty_cash_movement",
          entityId: movement.id,
          clientMutationId: input.clientMutationId,
          requestId: safeRequestId(ctx.req.headers["x-request-id"]),
          beforeSummary: movement.status,
          afterSummary: "Posted",
          reason: cleanReason,
        });
        // The balance is recalculated from Posted rows on the next read; this value is only a transaction result.
        void balanceAfterMinor;
      });
      return loadMovement(db, scope, input.movementId);
    }),

  cancelMovement: protectedProcedure
    .input(
      z.object({
        siteId: uuidSchema,
        movementId: uuidSchema,
        reason: reasonSchema,
        clientMutationId: mutationIdSchema,
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const scope = await getSiteScope(ctx.user, input.siteId, "finance.cash.movement.cancel");
      const db = requireDb(await getDb());
      const reason = input.reason.trim();
      const existingEvent = await findMutationEvent(db, ctx.user.id, input.clientMutationId);
      if (existingEvent) {
        verifyMutationEvent(existingEvent, {
          action: "petty_cash.movement.cancel",
          entityType: "petty_cash_movement",
          entityId: input.movementId,
          afterSummary: "Cancelled",
          reason,
        });
        return loadMovementByEvent(db, scope, existingEvent);
      }
      await db.transaction(async (tx) => {
        const movement = await loadMovement(tx, scope, input.movementId, true);
        enforcePolicyError(
          pettyCashMovementTransitionError({
            action: "cancel",
            status: movement.status,
            actorUserId: ctx.user.id,
            createdBy: movement.createdBy,
          }),
        );
        await tx
          .update(pettyCashMovements)
          .set({
            status: "Cancelled",
            cancelledBy: ctx.user.id,
            cancelledAt: new Date(),
            cancellationReason: reason,
          })
          .where(
            and(
              eq(pettyCashMovements.organizationId, scope.organizationId),
              eq(pettyCashMovements.siteId, scope.siteId),
              eq(pettyCashMovements.id, input.movementId),
            ),
          );
        await writeAudit(tx, {
          organizationId: scope.organizationId,
          siteId: scope.siteId,
          actorUserId: ctx.user.id,
          action: "petty_cash.movement.cancel",
          entityType: "petty_cash_movement",
          entityId: input.movementId,
          clientMutationId: input.clientMutationId,
          requestId: safeRequestId(ctx.req.headers["x-request-id"]),
          beforeSummary: movement.status,
          afterSummary: "Cancelled",
          reason,
        });
      });
      return loadMovement(db, scope, input.movementId);
    }),
});
