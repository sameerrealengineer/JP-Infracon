import { randomUUID } from "node:crypto";
import { and, asc, count, desc, eq, inArray, like, or, sql } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import {
  auditEvents,
  organizationMemberships,
  siteAssignments,
  siteIssueEvents,
  siteIssues,
  sites,
  users,
} from "../../drizzle/schema";
import { protectedProcedure, router } from "../_core/trpc";
import { getDb } from "../db";
import {
  assertActiveAccount,
  getAccessibleSites,
  getSiteScope,
  selfApprovalAllowed,
} from "./access";
import { siteCapabilities, sitesWithPermission } from "./capabilities";
import { dispatchAlert, siteLeadIds } from "./notify";
import {
  formatIssueCode,
  isIssuePolicyError,
  issueActionPermission,
  issueCategories,
  issueSeverities,
  issueStatuses,
  validateIssueTransition,
} from "../../lib/jp/issue-policy";

const mutationIdSchema = z.string().trim().min(16).max(64);
const dateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD.");

function requireDb(db: Awaited<ReturnType<typeof getDb>>) {
  if (!db)
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message: "The business data service is temporarily unavailable.",
    });
  return db;
}
type Db = ReturnType<typeof requireDb>;

async function priorMutation(db: Db, actorUserId: number, clientMutationId: string) {
  const [row] = await db
    .select({ entityId: auditEvents.entityId })
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

async function loadIssue(db: Db, issueId: string) {
  const [issue] = await db.select().from(siteIssues).where(eq(siteIssues.id, issueId)).limit(1);
  if (!issue) throw new TRPCError({ code: "NOT_FOUND", message: "Issue not found." });
  return issue;
}

function summary(issue: typeof siteIssues.$inferSelect) {
  return JSON.stringify({
    status: issue.status,
    severity: issue.severity,
    ownerUserId: issue.ownerUserId,
    targetDate: issue.targetDate,
  });
}

/** Active members of the site who can work an issue: site team plus organisation-wide roles. */
async function eligibleOwners(db: Db, siteId: string, organizationId: string) {
  const team = await db
    .select({ userId: users.id, name: users.name })
    .from(siteAssignments)
    .innerJoin(users, eq(siteAssignments.userId, users.id))
    .where(
      and(
        eq(siteAssignments.siteId, siteId),
        eq(siteAssignments.status, "Active"),
        eq(users.accountStatus, "Active"),
      ),
    );
  const leaders = await db
    .select({ userId: users.id, name: users.name })
    .from(organizationMemberships)
    .innerJoin(users, eq(organizationMemberships.userId, users.id))
    .where(
      and(
        eq(organizationMemberships.organizationId, organizationId),
        eq(organizationMemberships.status, "Active"),
        inArray(organizationMemberships.businessRole, ["owner", "director", "admin"]),
        eq(users.accountStatus, "Active"),
      ),
    );
  const byId = new Map<number, { userId: number; name: string | null }>();
  for (const person of [...team, ...leaders]) byId.set(person.userId, person);
  return [...byId.values()].sort((a, b) => (a.name ?? "").localeCompare(b.name ?? ""));
}

export const issuesRouter = router({
  list: protectedProcedure
    .input(
      z.object({
        siteId: z.string().uuid().optional(),
        status: z.enum(["Active", ...issueStatuses]).default("Active"),
        severity: z.enum(issueSeverities).optional(),
        search: z.string().trim().max(80).optional(),
        offset: z.number().int().min(0).default(0),
        limit: z.number().int().min(1).max(100).default(30),
      }),
    )
    .query(async ({ ctx, input }) => {
      assertActiveAccount(ctx.user);
      const db = requireDb(await getDb());
      const capabilities = await siteCapabilities(ctx.user, await getAccessibleSites(ctx.user));
      const candidate = input.siteId ? [input.siteId] : capabilities.map((row) => row.siteId);
      const siteIds = sitesWithPermission(capabilities, candidate, "issue.view");
      if (input.siteId && !siteIds.length)
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "You cannot view issues for this site.",
        });
      if (!siteIds.length)
        return { rows: [], total: 0, counts: { open: 0, critical: 0, stopWork: 0 } };
      const filters = [inArray(siteIssues.siteId, siteIds)];
      if (input.status === "Active")
        filters.push(inArray(siteIssues.status, ["Open", "In Progress", "Resolved"]));
      else filters.push(eq(siteIssues.status, input.status));
      if (input.severity) filters.push(eq(siteIssues.severity, input.severity));
      if (input.search) {
        const term = `%${input.search.replace(/[%_]/g, "")}%`;
        filters.push(or(like(siteIssues.title, term), like(siteIssues.issueCode, term))!);
      }
      const where = and(...filters);
      const [{ total }] = await db.select({ total: count() }).from(siteIssues).where(where);
      const rows = await db
        .select({
          id: siteIssues.id,
          siteId: siteIssues.siteId,
          siteName: sites.name,
          issueCode: siteIssues.issueCode,
          category: siteIssues.category,
          severity: siteIssues.severity,
          title: siteIssues.title,
          status: siteIssues.status,
          stopWork: siteIssues.stopWork,
          ownerName: siteIssues.ownerNameSnapshot,
          targetDate: siteIssues.targetDate,
          observedAt: siteIssues.observedAt,
          updatedAt: siteIssues.updatedAt,
        })
        .from(siteIssues)
        .innerJoin(sites, eq(siteIssues.siteId, sites.id))
        .where(where)
        .orderBy(
          sql`FIELD(${siteIssues.severity}, 'Critical', 'High', 'Medium', 'Low')`,
          desc(siteIssues.observedAt),
        )
        .limit(input.limit)
        .offset(input.offset);
      const openWhere = and(
        inArray(siteIssues.siteId, siteIds),
        inArray(siteIssues.status, ["Open", "In Progress"]),
      );
      const [counts] = await db
        .select({
          open: count(),
          critical: sql<number>`SUM(CASE WHEN ${siteIssues.severity} = 'Critical' THEN 1 ELSE 0 END)`,
          stopWork: sql<number>`SUM(CASE WHEN ${siteIssues.stopWork} = 'Yes' THEN 1 ELSE 0 END)`,
        })
        .from(siteIssues)
        .where(openWhere);
      return {
        rows,
        total: Number(total),
        counts: {
          open: Number(counts?.open ?? 0),
          critical: Number(counts?.critical ?? 0),
          stopWork: Number(counts?.stopWork ?? 0),
        },
      };
    }),

  detail: protectedProcedure
    .input(z.object({ issueId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const db = requireDb(await getDb());
      const issue = await loadIssue(db, input.issueId);
      const scope = await getSiteScope(ctx.user, issue.siteId, "issue.view");
      const capabilities = await siteCapabilities(ctx.user, await getAccessibleSites(ctx.user));
      const mine = capabilities.find((row) => row.siteId === issue.siteId);
      const events = await db
        .select({
          id: siteIssueEvents.id,
          eventType: siteIssueEvents.eventType,
          fromStatus: siteIssueEvents.fromStatus,
          toStatus: siteIssueEvents.toStatus,
          note: siteIssueEvents.note,
          actorName: users.name,
          createdAt: siteIssueEvents.createdAt,
        })
        .from(siteIssueEvents)
        .innerJoin(users, eq(siteIssueEvents.actorUserId, users.id))
        .where(eq(siteIssueEvents.issueId, issue.id))
        .orderBy(asc(siteIssueEvents.createdAt))
        .limit(500);
      const people = await db
        .select({ id: users.id, name: users.name })
        .from(users)
        .where(
          inArray(
            users.id,
            [issue.raisedBy, issue.resolvedBy, issue.closedBy].filter(
              (value): value is number => typeof value === "number",
            ),
          ),
        );
      const nameOf = (id: number | null) => people.find((person) => person.id === id)?.name ?? null;
      return {
        issue: {
          ...issue,
          siteName: scope.siteName,
          projectName: scope.projectName,
          raisedByName: nameOf(issue.raisedBy),
          resolvedByName: nameOf(issue.resolvedBy),
          closedByName: nameOf(issue.closedBy),
        },
        events,
        permissions: {
          manage: Boolean(mine?.["issue.manage"]),
          close: Boolean(mine?.["issue.close"]),
          comment: Boolean(mine?.["issue.create"] || mine?.["issue.manage"]),
        },
        me: ctx.user.id,
      };
    }),

  owners: protectedProcedure
    .input(z.object({ siteId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const scope = await getSiteScope(ctx.user, input.siteId, "issue.view");
      const db = requireDb(await getDb());
      return eligibleOwners(db, scope.siteId, scope.organizationId);
    }),

  create: protectedProcedure
    .input(
      z.object({
        siteId: z.string().uuid(),
        category: z.enum(issueCategories),
        severity: z.enum(issueSeverities),
        title: z.string().trim().min(3).max(180),
        description: z.string().trim().min(5).max(4000),
        locationLabel: z.string().trim().max(180).optional(),
        immediateAction: z.string().trim().max(2000).optional(),
        stopWork: z.boolean().default(false),
        observedAt: z.coerce.date().optional(),
        clientMutationId: mutationIdSchema,
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const scope = await getSiteScope(ctx.user, input.siteId, "issue.create");
      const db = requireDb(await getDb());
      const [existing] = await db
        .select({ id: siteIssues.id, issueCode: siteIssues.issueCode })
        .from(siteIssues)
        .where(eq(siteIssues.clientMutationId, input.clientMutationId))
        .limit(1);
      if (existing) return existing;
      const observedAt = input.observedAt ?? new Date();
      if (observedAt.getTime() > Date.now() + 5 * 60_000)
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "The observed time is in the future.",
        });
      if (input.stopWork && input.severity !== "High" && input.severity !== "Critical")
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Stop-work can only be flagged on a High or Critical issue.",
        });
      const id = randomUUID();
      let issueCode = "";
      await db.transaction(async (tx) => {
        await tx
          .select({ id: sites.id })
          .from(sites)
          .where(eq(sites.id, scope.siteId))
          .for("update");
        const [{ value }] = await tx
          .select({ value: count() })
          .from(siteIssues)
          .where(eq(siteIssues.siteId, scope.siteId));
        issueCode = formatIssueCode(scope.siteCode, new Date(), Number(value) + 1);
        await tx.insert(siteIssues).values({
          id,
          organizationId: scope.organizationId,
          siteId: scope.siteId,
          issueCode,
          category: input.category,
          severity: input.severity,
          title: input.title,
          description: input.description,
          locationLabel: input.locationLabel || null,
          immediateAction: input.immediateAction || null,
          stopWork: input.stopWork ? "Yes" : "No",
          observedAt,
          raisedBy: ctx.user.id,
          clientMutationId: input.clientMutationId,
        });
        await tx.insert(siteIssueEvents).values({
          id: randomUUID(),
          issueId: id,
          organizationId: scope.organizationId,
          siteId: scope.siteId,
          eventType: "Raised",
          toStatus: "Open",
          note: input.immediateAction || null,
          actorUserId: ctx.user.id,
        });
        await tx.insert(auditEvents).values({
          id: randomUUID(),
          organizationId: scope.organizationId,
          siteId: scope.siteId,
          actorUserId: ctx.user.id,
          action: "issue.raised",
          entityType: "site_issue",
          entityId: id,
          clientMutationId: input.clientMutationId,
          afterSummary: JSON.stringify({
            issueCode,
            category: input.category,
            severity: input.severity,
            stopWork: input.stopWork,
          }),
        });
      });
      if (input.stopWork || input.severity === "High" || input.severity === "Critical")
        void siteLeadIds(scope.organizationId, scope.siteId, ctx.user.id).then((recipientUserIds) =>
          dispatchAlert({
            organizationId: scope.organizationId,
            siteId: scope.siteId,
            siteName: scope.siteName,
            kind: "issue.raised",
            title: input.stopWork
              ? "STOP WORK flagged on site"
              : `${input.severity} ${input.category.toLowerCase()} reported`,
            detail: `${issueCode} · ${input.title}`,
            route: `/issue/${id}`,
            recipientUserIds,
            urgent: input.stopWork || input.severity === "Critical",
          }),
        );
      return { id, issueCode };
    }),

  assign: protectedProcedure
    .input(
      z.object({
        issueId: z.string().uuid(),
        ownerUserId: z.number().int().positive(),
        targetDate: dateSchema.optional(),
        note: z.string().trim().max(1000).optional(),
        clientMutationId: mutationIdSchema,
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const db = requireDb(await getDb());
      const issue = await loadIssue(db, input.issueId);
      const scope = await getSiteScope(ctx.user, issue.siteId, "issue.manage");
      const prior = await priorMutation(db, ctx.user.id, input.clientMutationId);
      if (prior) return { id: prior.entityId };
      const owners = await eligibleOwners(db, scope.siteId, scope.organizationId);
      const owner = owners.find((person) => person.userId === input.ownerUserId);
      if (!owner)
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Choose an active person who works on this site.",
        });
      await db.transaction(async (tx) => {
        const [locked] = await tx
          .select()
          .from(siteIssues)
          .where(eq(siteIssues.id, issue.id))
          .for("update");
        if (locked.status === "Closed")
          throw new TRPCError({
            code: "CONFLICT",
            message: "Reopen the issue before reassigning it.",
          });
        await tx
          .update(siteIssues)
          .set({
            ownerUserId: owner.userId,
            ownerNameSnapshot: owner.name,
            targetDate: input.targetDate ?? locked.targetDate,
            recordVersion: locked.recordVersion + 1,
          })
          .where(eq(siteIssues.id, issue.id));
        await tx.insert(siteIssueEvents).values({
          id: randomUUID(),
          issueId: issue.id,
          organizationId: scope.organizationId,
          siteId: scope.siteId,
          eventType: "Assigned",
          note:
            `Assigned to ${owner.name ?? "user"}` +
            (input.targetDate ? ` · target ${input.targetDate}` : "") +
            (input.note ? ` · ${input.note}` : ""),
          actorUserId: ctx.user.id,
        });
        await tx.insert(auditEvents).values({
          id: randomUUID(),
          organizationId: scope.organizationId,
          siteId: scope.siteId,
          actorUserId: ctx.user.id,
          action: "issue.assigned",
          entityType: "site_issue",
          entityId: issue.id,
          clientMutationId: input.clientMutationId,
          beforeSummary: summary(locked),
          afterSummary: JSON.stringify({ ownerUserId: owner.userId, targetDate: input.targetDate }),
          reason: input.note || null,
        });
      });
      if (owner.userId !== ctx.user.id)
        void dispatchAlert({
          organizationId: scope.organizationId,
          siteId: scope.siteId,
          siteName: scope.siteName,
          kind: "issue.assigned",
          title: "An issue has been assigned to you",
          detail: `${issue.issueCode} · ${issue.title}`,
          route: `/issue/${issue.id}`,
          recipientUserIds: [owner.userId],
          urgent: issue.severity === "Critical",
        });
      return { id: issue.id };
    }),

  transition: protectedProcedure
    .input(
      z.object({
        issueId: z.string().uuid(),
        action: z.enum(["start", "resolve", "close", "send_back", "reopen"]),
        note: z.string().trim().max(2000).optional(),
        correctiveAction: z.string().trim().max(4000).optional(),
        preventiveAction: z.string().trim().max(4000).optional(),
        clientMutationId: mutationIdSchema,
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const db = requireDb(await getDb());
      const issue = await loadIssue(db, input.issueId);
      const scope = await getSiteScope(ctx.user, issue.siteId, issueActionPermission[input.action]);
      const selfOk = await selfApprovalAllowed(ctx.user, scope.siteId);
      const prior = await priorMutation(db, ctx.user.id, input.clientMutationId);
      if (prior) return { id: prior.entityId };
      let nextStatus = issue.status;
      await db.transaction(async (tx) => {
        const [locked] = await tx
          .select()
          .from(siteIssues)
          .where(eq(siteIssues.id, issue.id))
          .for("update");
        const result = validateIssueTransition({
          action: input.action,
          status: locked.status,
          severity: locked.severity,
          actorUserId: ctx.user.id,
          resolvedBy: selfOk ? null : locked.resolvedBy,
          note: input.note,
          correctiveAction: input.correctiveAction,
        });
        if (isIssuePolicyError(result))
          throw new TRPCError({ code: result.code, message: result.message });
        nextStatus = result.next;
        const now = new Date();
        const patch: Partial<typeof siteIssues.$inferInsert> = {
          status: result.next,
          recordVersion: locked.recordVersion + 1,
        };
        if (input.action === "resolve") {
          patch.correctiveAction = input.correctiveAction ?? null;
          patch.preventiveAction = input.preventiveAction || null;
          patch.resolvedBy = ctx.user.id;
          patch.resolvedAt = now;
        }
        if (input.action === "close") {
          patch.closedBy = ctx.user.id;
          patch.closedAt = now;
          patch.closureNote = input.note ?? null;
        }
        if (input.action === "reopen") {
          patch.reopenCount = locked.reopenCount + 1;
          patch.closedBy = null;
          patch.closedAt = null;
          patch.resolvedBy = null;
          patch.resolvedAt = null;
        }
        if (input.action === "send_back") {
          patch.resolvedBy = null;
          patch.resolvedAt = null;
        }
        await tx.update(siteIssues).set(patch).where(eq(siteIssues.id, issue.id));
        await tx.insert(siteIssueEvents).values({
          id: randomUUID(),
          issueId: issue.id,
          organizationId: scope.organizationId,
          siteId: scope.siteId,
          eventType: input.action === "reopen" ? "Reopened" : "Status Changed",
          fromStatus: locked.status,
          toStatus: result.next,
          note:
            input.action === "resolve"
              ? [
                  input.correctiveAction,
                  input.preventiveAction && `Prevention: ${input.preventiveAction}`,
                ]
                  .filter(Boolean)
                  .join(" · ")
              : input.note || null,
          actorUserId: ctx.user.id,
        });
        await tx.insert(auditEvents).values({
          id: randomUUID(),
          organizationId: scope.organizationId,
          siteId: scope.siteId,
          actorUserId: ctx.user.id,
          action: `issue.${input.action}`,
          entityType: "site_issue",
          entityId: issue.id,
          clientMutationId: input.clientMutationId,
          beforeSummary: summary(locked),
          afterSummary: JSON.stringify({ status: result.next }),
          reason: input.note || input.correctiveAction || null,
        });
      });
      return { id: issue.id, status: nextStatus };
    }),

  comment: protectedProcedure
    .input(
      z.object({
        issueId: z.string().uuid(),
        note: z.string().trim().min(2).max(2000),
        clientMutationId: mutationIdSchema,
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const db = requireDb(await getDb());
      const issue = await loadIssue(db, input.issueId);
      let scope;
      try {
        scope = await getSiteScope(ctx.user, issue.siteId, "issue.manage");
      } catch {
        scope = await getSiteScope(ctx.user, issue.siteId, "issue.create");
      }
      const prior = await priorMutation(db, ctx.user.id, input.clientMutationId);
      if (prior) return { id: prior.entityId };
      const eventId = randomUUID();
      await db.transaction(async (tx) => {
        await tx.insert(siteIssueEvents).values({
          id: eventId,
          issueId: issue.id,
          organizationId: scope.organizationId,
          siteId: scope.siteId,
          eventType: "Comment",
          note: input.note,
          actorUserId: ctx.user.id,
        });
        await tx.insert(auditEvents).values({
          id: randomUUID(),
          organizationId: scope.organizationId,
          siteId: scope.siteId,
          actorUserId: ctx.user.id,
          action: "issue.commented",
          entityType: "site_issue",
          entityId: issue.id,
          clientMutationId: input.clientMutationId,
        });
      });
      return { id: eventId };
    }),
});
