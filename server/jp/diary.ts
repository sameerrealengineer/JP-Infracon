import { randomUUID } from "node:crypto";
import { and, asc, count, desc, eq, gte, isNull, lte, or } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import {
  attendanceRecords,
  auditEvents,
  dailyReports,
  hindrances,
  inventoryMovements,
  materialItems,
  people,
  pettyCashMovements,
  siteDiaryNotes,
  siteIssues,
  workerEngagements,
} from "../../drizzle/schema";
import {
  HINDRANCE_CATEGORIES,
  eotSummary,
  hindranceCode,
  hindranceDays,
  hindranceProblem,
} from "../../lib/jp/hindrance-domain";
import { protectedProcedure, router } from "../_core/trpc";
import { getDb } from "../db";
import { getAccessibleSites, getSiteScope } from "./access";
import { siteCapabilities } from "./capabilities";

const mutationIdSchema = z.string().trim().min(16).max(64);
const dateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

function requireDb(db: Awaited<ReturnType<typeof getDb>>) {
  if (!db)
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message: "The business data service is temporarily unavailable.",
    });
  return db;
}

function todayIst() {
  return new Date(Date.now() + 330 * 60_000).toISOString().slice(0, 10);
}

/**
 * Site diary: one page per site and day pulling together the day's DPR/DLR, attendance, store
 * movements, petty cash, issues, hindrances and diary notes (each only with its view
 * permission), plus the hindrance register with the extension-of-time summary.
 */
export const diaryRouter = router({
  day: protectedProcedure
    .input(z.object({ siteId: z.string().uuid(), date: dateSchema }))
    .query(async ({ ctx, input }) => {
      const scope = await getSiteScope(ctx.user, input.siteId, "site.view");
      const db = requireDb(await getDb());
      const site = (await getAccessibleSites(ctx.user)).find((row) => row.id === input.siteId);
      const [caps] = site ? await siteCapabilities(ctx.user, [site]) : [];
      const can = (key: string) => Boolean((caps as Record<string, unknown> | undefined)?.[key]);
      const day = input.date;
      const [reports, marks, moves, cash, issues, hinders, notes] = await Promise.all([
        can("dpr.view") || can("dlr.view")
          ? db
              .select({
                id: dailyReports.id,
                kind: dailyReports.reportKind,
                status: dailyReports.status,
                weather: dailyReports.weatherCode,
              })
              .from(dailyReports)
              .where(and(eq(dailyReports.siteId, input.siteId), eq(dailyReports.reportDate, day)))
          : Promise.resolve([]),
        can("attendance.view")
          ? db
              .select({ status: attendanceRecords.attendanceStatus, trade: people.tradeType })
              .from(attendanceRecords)
              .innerJoin(
                workerEngagements,
                eq(attendanceRecords.workerEngagementId, workerEngagements.id),
              )
              .innerJoin(people, eq(workerEngagements.personId, people.id))
              .where(
                and(
                  eq(attendanceRecords.siteId, input.siteId),
                  eq(attendanceRecords.workDate, day),
                ),
              )
          : Promise.resolve([]),
        can("inventory.view")
          ? db
              .select({
                item: materialItems.name,
                unit: inventoryMovements.unitCode,
                direction: inventoryMovements.direction,
                quantity: inventoryMovements.quantity,
                type: inventoryMovements.movementType,
                status: inventoryMovements.status,
                createdAt: inventoryMovements.createdAt,
              })
              .from(inventoryMovements)
              .innerJoin(materialItems, eq(inventoryMovements.materialItemId, materialItems.id))
              .where(eq(inventoryMovements.siteId, input.siteId))
              .orderBy(desc(inventoryMovements.createdAt))
              .limit(300)
          : Promise.resolve([]),
        can("finance.cash.view")
          ? db
              .select({
                payee: pettyCashMovements.payeeName,
                amountMinor: pettyCashMovements.amountMinor,
                purpose: pettyCashMovements.purpose,
                status: pettyCashMovements.status,
              })
              .from(pettyCashMovements)
              .where(
                and(
                  eq(pettyCashMovements.siteId, input.siteId),
                  eq(pettyCashMovements.movementDate, day),
                  eq(pettyCashMovements.movementType, "Expense"),
                ),
              )
          : Promise.resolve([]),
        can("issue.view")
          ? db
              .select({
                code: siteIssues.issueCode,
                title: siteIssues.title,
                severity: siteIssues.severity,
                status: siteIssues.status,
                observedAt: siteIssues.observedAt,
              })
              .from(siteIssues)
              .where(eq(siteIssues.siteId, input.siteId))
              .orderBy(desc(siteIssues.observedAt))
              .limit(200)
              .catch(() => [])
          : Promise.resolve([]),
        can("dpr.view")
          ? db
              .select()
              .from(hindrances)
              .where(
                and(
                  eq(hindrances.siteId, input.siteId),
                  lte(hindrances.startDate, day),
                  or(isNull(hindrances.endDate), gte(hindrances.endDate, day)),
                ),
              )
              .catch(() => [])
          : Promise.resolve([]),
        can("dpr.view")
          ? db
              .select()
              .from(siteDiaryNotes)
              .where(and(eq(siteDiaryNotes.siteId, input.siteId), eq(siteDiaryNotes.noteDate, day)))
              .orderBy(asc(siteDiaryNotes.createdAt))
              .catch(() => [])
          : Promise.resolve([]),
      ]);
      const sameDay = (value: Date | string) =>
        new Date(new Date(value).getTime() + 330 * 60_000).toISOString().slice(0, 10) === day;
      const trades = new Map<string, number>();
      for (const mark of marks)
        if (mark.status !== "Absent" && mark.status !== "Leave") {
          const trade = mark.trade?.trim() || "Not specified";
          trades.set(trade, (trades.get(trade) ?? 0) + (mark.status === "Half Day" ? 0.5 : 1));
        }
      return {
        site: {
          id: input.siteId,
          name: scope.siteName,
          code: scope.siteCode,
          status: scope.siteStatus,
        },
        date: day,
        today: todayIst(),
        can: {
          writeReport: can("dpr.create"),
          markAttendance: can("attendance.mark"),
          addNote: can("dpr.create"),
          hindrance: can("dpr.create"),
        },
        reports: can("dpr.view") || can("dlr.view") ? reports : null,
        attendance: can("attendance.view")
          ? {
              present: marks.filter(
                (m) => m.status === "Full Day" || m.status === "Present-hours-based",
              ).length,
              half: marks.filter((m) => m.status === "Half Day").length,
              absent: marks.filter((m) => m.status === "Absent").length,
              leave: marks.filter((m) => m.status === "Leave").length,
              trades: [...trades.entries()].map(([trade, people]) => ({ trade, people })),
            }
          : null,
        store: can("inventory.view")
          ? moves
              .filter((m) => sameDay(m.createdAt))
              .map(({ createdAt: _c, ...m }) => ({ ...m, quantity: String(m.quantity) }))
          : null,
        pettyCash: can("finance.cash.view")
          ? cash.map((row) => ({ ...row, amountMinor: String(row.amountMinor) }))
          : null,
        issues: can("issue.view")
          ? issues.filter((row) => sameDay(row.observedAt)).map(({ observedAt: _o, ...row }) => row)
          : null,
        hindrances: can("dpr.view")
          ? hinders.map((row) => ({
              code: row.code,
              category: row.category,
              description: row.description,
              startDate: row.startDate,
              affectsWork: row.affectsWork,
            }))
          : null,
        notes: can("dpr.view")
          ? notes.map((row) => ({
              id: row.id,
              kind: row.kind,
              personName: row.personName,
              personRole: row.personRole,
              text: row.text,
            }))
          : null,
      };
    }),

  addNote: protectedProcedure
    .input(
      z.object({
        siteId: z.string().uuid(),
        date: dateSchema,
        kind: z.enum(["Visitor", "Instruction", "Meeting", "Weather", "General"]),
        personName: z.string().trim().max(180).optional(),
        personRole: z.string().trim().max(120).optional(),
        text: z.string().trim().min(2).max(2000),
        clientMutationId: mutationIdSchema,
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const scope = await getSiteScope(ctx.user, input.siteId, "dpr.create");
      if (input.date > todayIst())
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "A diary note cannot be for a future day.",
        });
      const db = requireDb(await getDb());
      const [prior] = await db
        .select({ id: siteDiaryNotes.id })
        .from(siteDiaryNotes)
        .where(eq(siteDiaryNotes.clientMutationId, input.clientMutationId))
        .limit(1);
      if (prior) return { id: prior.id };
      const id = randomUUID();
      await db.transaction(async (tx) => {
        await tx.insert(siteDiaryNotes).values({
          id,
          organizationId: scope.organizationId,
          siteId: input.siteId,
          noteDate: input.date,
          kind: input.kind,
          personName: input.personName || null,
          personRole: input.personRole || null,
          text: input.text,
          clientMutationId: input.clientMutationId,
          createdBy: ctx.user.id,
        });
        await tx.insert(auditEvents).values({
          id: randomUUID(),
          organizationId: scope.organizationId,
          siteId: input.siteId,
          actorUserId: ctx.user.id,
          action: "diary.note_added",
          entityType: "site_diary_note",
          entityId: id,
          afterSummary: JSON.stringify({ kind: input.kind, date: input.date }),
        });
      });
      return { id };
    }),

  hindrances: protectedProcedure
    .input(z.object({ siteId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      await getSiteScope(ctx.user, input.siteId, "dpr.view");
      const db = requireDb(await getDb());
      const today = todayIst();
      const rows = await db
        .select()
        .from(hindrances)
        .where(eq(hindrances.siteId, input.siteId))
        .orderBy(desc(hindrances.startDate))
        .catch(() => []);
      return {
        today,
        categories: HINDRANCE_CATEGORIES,
        summary: eotSummary(rows, today),
        rows: rows.map((row) => ({
          id: row.id,
          code: row.code,
          category: row.category,
          description: row.description,
          startDate: row.startDate,
          endDate: row.endDate,
          affectsWork: row.affectsWork,
          letterReference: row.letterReference,
          letterDate: row.letterDate,
          status: row.status,
          closeNote: row.closeNote,
          days: hindranceDays(row.startDate, row.endDate, today),
        })),
      };
    }),

  addHindrance: protectedProcedure
    .input(
      z.object({
        siteId: z.string().uuid(),
        category: z.string(),
        description: z.string().trim().max(2000),
        startDate: dateSchema,
        endDate: dateSchema.nullable(),
        affectsWork: z.enum(["Full stop", "Partial"]),
        letterReference: z.string().trim().max(160).optional(),
        letterDate: dateSchema.optional(),
        clientMutationId: mutationIdSchema,
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const scope = await getSiteScope(ctx.user, input.siteId, "dpr.create");
      const problem = hindranceProblem({ ...input, today: todayIst() });
      if (problem) throw new TRPCError({ code: "BAD_REQUEST", message: problem });
      const db = requireDb(await getDb());
      const [prior] = await db
        .select({ id: hindrances.id, code: hindrances.code })
        .from(hindrances)
        .where(eq(hindrances.clientMutationId, input.clientMutationId))
        .limit(1);
      if (prior) return prior;
      const id = randomUUID();
      let code = "";
      await db.transaction(async (tx) => {
        const [existing] = await tx
          .select({ n: count() })
          .from(hindrances)
          .where(eq(hindrances.siteId, input.siteId));
        code = hindranceCode(scope.siteCode, Number(existing?.n ?? 0) + 1);
        await tx.insert(hindrances).values({
          id,
          organizationId: scope.organizationId,
          siteId: input.siteId,
          code,
          category: input.category,
          description: input.description,
          startDate: input.startDate,
          endDate: input.endDate,
          affectsWork: input.affectsWork,
          letterReference: input.letterReference || null,
          letterDate: input.letterDate || null,
          status: input.endDate ? "Closed" : "Open",
          clientMutationId: input.clientMutationId,
          createdBy: ctx.user.id,
          closedBy: input.endDate ? ctx.user.id : null,
        });
        await tx.insert(auditEvents).values({
          id: randomUUID(),
          organizationId: scope.organizationId,
          siteId: input.siteId,
          actorUserId: ctx.user.id,
          action: "hindrance.recorded",
          entityType: "hindrance",
          entityId: id,
          afterSummary: JSON.stringify({
            code,
            category: input.category,
            startDate: input.startDate,
            endDate: input.endDate,
          }),
        });
      });
      return { id, code };
    }),

  closeHindrance: protectedProcedure
    .input(
      z.object({
        siteId: z.string().uuid(),
        id: z.string().uuid(),
        endDate: dateSchema,
        closeNote: z.string().trim().min(3).max(1000),
        letterReference: z.string().trim().max(160).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const scope = await getSiteScope(ctx.user, input.siteId, "dpr.create");
      const db = requireDb(await getDb());
      await db.transaction(async (tx) => {
        const [row] = await tx
          .select()
          .from(hindrances)
          .where(and(eq(hindrances.id, input.id), eq(hindrances.siteId, input.siteId)))
          .for("update")
          .limit(1);
        if (!row) throw new TRPCError({ code: "NOT_FOUND", message: "Hindrance not found." });
        if (row.status === "Closed")
          throw new TRPCError({ code: "CONFLICT", message: "This hindrance is already closed." });
        if (input.endDate < row.startDate)
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "The end date is before the start date.",
          });
        if (input.endDate > todayIst())
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "The end date cannot be in the future.",
          });
        await tx
          .update(hindrances)
          .set({
            endDate: input.endDate,
            status: "Closed",
            closeNote: input.closeNote,
            closedBy: ctx.user.id,
            letterReference: input.letterReference || row.letterReference,
          })
          .where(eq(hindrances.id, row.id));
        await tx.insert(auditEvents).values({
          id: randomUUID(),
          organizationId: scope.organizationId,
          siteId: input.siteId,
          actorUserId: ctx.user.id,
          action: "hindrance.closed",
          entityType: "hindrance",
          entityId: row.id,
          beforeSummary: JSON.stringify({ endDate: null }),
          afterSummary: JSON.stringify({ endDate: input.endDate }),
          reason: input.closeNote,
        });
      });
      return { ok: true as const };
    }),
});
