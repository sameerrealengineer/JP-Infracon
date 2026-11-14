import { randomUUID } from "node:crypto";
import { and, desc, eq, inArray, ne, or } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { auditEvents, leaveRequests, people, sites, users } from "../../drizzle/schema";
import { LEAVE_TYPES, leaveHalfDays, leaveProblem, rangesOverlap } from "../../lib/jp/leave-domain";
import { protectedProcedure, router } from "../_core/trpc";
import { getDb } from "../db";
import { getAccessibleSites, getSiteScope } from "./access";
import { siteCapabilities } from "./capabilities";

function requireDb(db: Awaited<ReturnType<typeof getDb>>) {
  if (!db)
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message: "The business data service is temporarily unavailable.",
    });
  return db;
}
const bad = (message: string): never => {
  throw new TRPCError({ code: "BAD_REQUEST", message });
};
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use a date like 2026-11-14.");

async function sitesWith(user: Parameters<typeof getAccessibleSites>[0], key: string) {
  const accessible = await getAccessibleSites(user);
  const capabilities = await siteCapabilities(user, accessible);
  return capabilities
    .filter((row) => (row as Record<string, unknown>)[key] === true)
    .map((row) => row.siteId);
}

/**
 * Leave applications. Staff apply for themselves on one of their sites; a site supervisor
 * (workforce.manage) applies for a worker of the site. Someone with workforce.review on the
 * site approves or rejects, never their own. Every step is audited.
 */
export const leaveRouter = router({
  list: protectedProcedure
    .input(
      z.object({ scope: z.enum(["mine", "review"]).default("mine") }).default({ scope: "mine" }),
    )
    .query(async ({ ctx, input }) => {
      const db = requireDb(await getDb());
      const reviewSites = await sitesWith(ctx.user, "workforce.review");
      const where =
        input.scope === "mine"
          ? or(
              eq(leaveRequests.applicantUserId, ctx.user.id),
              eq(leaveRequests.createdBy, ctx.user.id),
            )
          : reviewSites.length
            ? inArray(leaveRequests.siteId, reviewSites)
            : eq(leaveRequests.id, "none");
      const rows = await db
        .select({
          leave: leaveRequests,
          siteName: sites.name,
          applicantName: users.name,
          personName: people.fullName,
        })
        .from(leaveRequests)
        .innerJoin(sites, eq(leaveRequests.siteId, sites.id))
        .leftJoin(users, eq(leaveRequests.applicantUserId, users.id))
        .leftJoin(people, eq(leaveRequests.personId, people.id))
        .where(where)
        .orderBy(desc(leaveRequests.fromDate))
        .limit(300);
      return {
        canReview: reviewSites.length > 0,
        rows: rows.map(({ leave, siteName, applicantName, personName }) => ({
          ...leave,
          siteName,
          who: personName ?? applicantName ?? "—",
          isMine: leave.applicantUserId === ctx.user.id,
          canReview:
            leave.status === "Pending" &&
            reviewSites.includes(leave.siteId) &&
            leave.applicantUserId !== ctx.user.id &&
            leave.createdBy !== ctx.user.id,
        })),
      };
    }),

  request: protectedProcedure
    .input(
      z.object({
        siteId: z.string().uuid(),
        personId: z.string().uuid().nullish(),
        leaveType: z.enum(LEAVE_TYPES),
        fromDate: date,
        toDate: date,
        halfDay: z.boolean().default(false),
        reason: z.string().trim().max(1000),
        clientMutationId: z.string().trim().min(16).max(64),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      // Applying for a worker needs workforce.manage; for yourself, being on the site is enough.
      const scope = await getSiteScope(
        ctx.user,
        input.siteId,
        input.personId ? "workforce.manage" : "site.view",
      );
      const problem = leaveProblem(input);
      if (problem) bad(problem);
      const db = requireDb(await getDb());
      const [prior] = await db
        .select({ id: leaveRequests.id })
        .from(leaveRequests)
        .where(
          and(
            eq(leaveRequests.createdBy, ctx.user.id),
            eq(leaveRequests.clientMutationId, input.clientMutationId),
          ),
        )
        .limit(1);
      if (prior) return { id: prior.id, replayed: true };
      if (input.personId) {
        const [person] = await db
          .select({ organizationId: people.organizationId })
          .from(people)
          .where(eq(people.id, input.personId))
          .limit(1);
        if (person?.organizationId !== scope.organizationId)
          bad("Choose a worker of this company.");
      }
      const same = await db
        .select({ fromDate: leaveRequests.fromDate, toDate: leaveRequests.toDate })
        .from(leaveRequests)
        .where(
          and(
            input.personId
              ? eq(leaveRequests.personId, input.personId)
              : eq(leaveRequests.applicantUserId, ctx.user.id),
            ne(leaveRequests.status, "Rejected"),
            ne(leaveRequests.status, "Cancelled"),
          ),
        );
      if (same.some((row) => rangesOverlap(row, input)))
        bad("There is already leave on some of these days.");
      const id = randomUUID();
      await db.transaction(async (tx) => {
        await tx.insert(leaveRequests).values({
          id,
          organizationId: scope.organizationId,
          siteId: scope.siteId,
          applicantUserId: input.personId ? null : ctx.user.id,
          personId: input.personId ?? null,
          leaveType: input.leaveType,
          fromDate: input.fromDate,
          toDate: input.toDate,
          halfDays: leaveHalfDays(input.fromDate, input.toDate, input.halfDay),
          reason: input.reason,
          createdBy: ctx.user.id,
          clientMutationId: input.clientMutationId,
        });
        await tx.insert(auditEvents).values({
          id: randomUUID(),
          organizationId: scope.organizationId,
          siteId: scope.siteId,
          actorUserId: ctx.user.id,
          action: "leave.applied",
          entityType: "leave_request",
          entityId: id,
          clientMutationId: input.clientMutationId,
          afterSummary: JSON.stringify({
            leaveType: input.leaveType,
            fromDate: input.fromDate,
            toDate: input.toDate,
            forWorker: Boolean(input.personId),
          }),
        });
      });
      return { id, replayed: false };
    }),

  review: protectedProcedure
    .input(
      z.object({
        leaveId: z.string().uuid(),
        decision: z.enum(["Approved", "Rejected"]),
        note: z.string().trim().max(1000).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const db = requireDb(await getDb());
      const [leave] = await db
        .select()
        .from(leaveRequests)
        .where(eq(leaveRequests.id, input.leaveId))
        .limit(1);
      if (!leave) throw new TRPCError({ code: "NOT_FOUND", message: "Leave request not found." });
      await getSiteScope(ctx.user, leave.siteId, "workforce.review");
      if (leave.applicantUserId === ctx.user.id || leave.createdBy === ctx.user.id)
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "Another person must decide on a leave you applied for.",
        });
      if (input.decision === "Rejected" && !input.note?.trim()) bad("Give a reason to reject.");
      if (leave.status !== "Pending") return { id: leave.id, status: leave.status };
      await db.transaction(async (tx) => {
        await tx
          .update(leaveRequests)
          .set({
            status: input.decision,
            reviewedBy: ctx.user.id,
            reviewedAt: new Date(),
            reviewNote: input.note ?? null,
          })
          .where(eq(leaveRequests.id, leave.id));
        await tx.insert(auditEvents).values({
          id: randomUUID(),
          organizationId: leave.organizationId,
          siteId: leave.siteId,
          actorUserId: ctx.user.id,
          action: input.decision === "Approved" ? "leave.approved" : "leave.rejected",
          entityType: "leave_request",
          entityId: leave.id,
          reason: input.note ?? null,
        });
      });
      return { id: leave.id, status: input.decision };
    }),

  cancel: protectedProcedure
    .input(z.object({ leaveId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const db = requireDb(await getDb());
      const [leave] = await db
        .select()
        .from(leaveRequests)
        .where(eq(leaveRequests.id, input.leaveId))
        .limit(1);
      if (!leave) throw new TRPCError({ code: "NOT_FOUND", message: "Leave request not found." });
      if (leave.createdBy !== ctx.user.id && leave.applicantUserId !== ctx.user.id)
        throw new TRPCError({ code: "FORBIDDEN", message: "Only the applicant can cancel." });
      const today = new Date().toISOString().slice(0, 10);
      if (leave.status === "Rejected" || leave.status === "Cancelled")
        return { id: leave.id, status: leave.status };
      if (leave.status === "Approved" && leave.fromDate <= today)
        bad("Leave that has started cannot be cancelled. Ask your manager.");
      await db.transaction(async (tx) => {
        await tx
          .update(leaveRequests)
          .set({ status: "Cancelled" })
          .where(eq(leaveRequests.id, leave.id));
        await tx.insert(auditEvents).values({
          id: randomUUID(),
          organizationId: leave.organizationId,
          siteId: leave.siteId,
          actorUserId: ctx.user.id,
          action: "leave.cancelled",
          entityType: "leave_request",
          entityId: leave.id,
        });
      });
      return { id: leave.id, status: "Cancelled" as const };
    }),
});
