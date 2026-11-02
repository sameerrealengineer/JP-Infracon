import { randomUUID } from "node:crypto";
import { and, asc, desc, eq, inArray, ne } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import {
  auditEvents,
  dailyReportItems,
  dailyReports,
  sites,
  users,
  workTasks,
} from "../../drizzle/schema";
import { protectedProcedure } from "../_core/trpc";
import { getSiteScope } from "./access";
import {
  MAX_DPR_ITEMS,
  SITE_STATUS_OPTIONS,
  WEATHER_OPTIONS,
  validateDprItems,
  type DprItem,
} from "../../lib/jp/dpr-domain";

/** DPR progress lines, the report detail view, and correcting a draft or returned report. */

const optionalText = (max: number) => z.string().trim().max(max).optional().nullable();

export const dprItemSchema = z.object({
  taskId: z.string().uuid().optional().nullable(),
  workItemCode: optionalText(80),
  description: z.string().trim().min(2).max(240),
  locationLabel: optionalText(180),
  unitCode: optionalText(32),
  plannedQuantity: optionalText(20),
  completedQuantityToday: optionalText(20),
  cumulativeQuantity: optionalText(20),
  remarks: optionalText(2000),
});

export const reportHeaderFields = {
  weatherCode: z.enum(WEATHER_OPTIONS).optional().nullable(),
  overallStatus: z.enum(SITE_STATUS_OPTIONS).optional().nullable(),
  items: z.array(dprItemSchema).max(MAX_DPR_ITEMS).default([]),
};

async function db() {
  const instance = await (await import("../db")).getDb();
  if (!instance)
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message: "The business data service is temporarily unavailable.",
    });
  return instance;
}

function requestId(value: string | string[] | undefined) {
  return typeof value === "string" && value.length <= 100 ? value : undefined;
}

/**
 * Checks DPR lines and that each linked task belongs to the report's site.
 * DLR reports carry no progress lines.
 */
export async function checkReportItems(
  reportKind: "DPR" | "DLR",
  siteId: string,
  items: z.infer<typeof dprItemSchema>[],
): Promise<DprItem[]> {
  if (reportKind === "DLR") {
    if (items.length)
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: "A labour report records people through attendance, not work lines.",
      });
    return [];
  }
  const result = validateDprItems(items);
  if (result.error) throw new TRPCError({ code: "BAD_REQUEST", message: result.error.message });
  const taskIds = [...new Set(result.items.map((item) => item.taskId).filter(Boolean))] as string[];
  if (taskIds.length) {
    const found = await (
      await db()
    )
      .select({ id: workTasks.id })
      .from(workTasks)
      .where(and(eq(workTasks.siteId, siteId), inArray(workTasks.id, taskIds)));
    if (found.length !== taskIds.length)
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: "A work line points to a task that is not on this site.",
      });
  }
  return result.items;
}

export async function insertReportItems(tx: any, reportId: string, items: DprItem[]) {
  if (!items.length) return;
  await tx.insert(dailyReportItems).values(
    items.map((item) => ({
      id: randomUUID(),
      dailyReportId: reportId,
      ...item,
    })),
  );
}

async function loadReport(reportId: string) {
  const [report] = await (await db())
    .select()
    .from(dailyReports)
    .where(eq(dailyReports.id, reportId))
    .limit(1);
  if (!report) throw new TRPCError({ code: "NOT_FOUND", message: "Report not found." });
  return report;
}

const EDITABLE = ["Draft", "Returned for Correction"] as const;

export const dailyReportProcedures = {
  /** One report with its progress lines, for anyone who may view that report type on the site. */
  detail: protectedProcedure
    .input(z.object({ reportId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const report = await loadReport(input.reportId);
      await getSiteScope(
        ctx.user,
        report.siteId,
        report.reportKind === "DPR" ? "dpr.view" : "dlr.view",
      );
      const database = await db();
      const [site] = await database
        .select({ name: sites.name })
        .from(sites)
        .where(eq(sites.id, report.siteId))
        .limit(1);
      const [creator] = await database
        .select({ name: users.name })
        .from(users)
        .where(eq(users.id, report.createdBy))
        .limit(1);
      const items = await database
        .select()
        .from(dailyReportItems)
        .where(eq(dailyReportItems.dailyReportId, report.id))
        .orderBy(asc(dailyReportItems.createdAt), asc(dailyReportItems.id));
      return {
        report: { ...report, siteName: site?.name ?? "", creatorName: creator?.name ?? null },
        items,
        canEdit:
          report.createdBy === ctx.user.id &&
          (EDITABLE as readonly string[]).includes(report.status),
      };
    }),

  /**
   * Tasks on the site and the last reported quantities for each piece of work,
   * so a new line can start from yesterday's cumulative instead of being retyped.
   */
  progressContext: protectedProcedure
    .input(z.object({ siteId: z.string().uuid(), excludeReportId: z.string().uuid().optional() }))
    .query(async ({ ctx, input }) => {
      const scope = await getSiteScope(ctx.user, input.siteId, "dpr.create");
      const database = await db();
      const tasks = await database
        .select({
          id: workTasks.id,
          taskCode: workTasks.taskCode,
          title: workTasks.title,
          locationLabel: workTasks.locationLabel,
          status: workTasks.status,
        })
        .from(workTasks)
        .where(and(eq(workTasks.siteId, scope.siteId), ne(workTasks.status, "Cancelled")))
        .orderBy(asc(workTasks.plannedStart))
        .limit(200);
      const conditions = [
        eq(dailyReports.siteId, scope.siteId),
        eq(dailyReports.reportKind, "DPR"),
      ];
      if (input.excludeReportId) conditions.push(ne(dailyReports.id, input.excludeReportId));
      const lines = await database
        .select({
          taskId: dailyReportItems.taskId,
          description: dailyReportItems.description,
          locationLabel: dailyReportItems.locationLabel,
          unitCode: dailyReportItems.unitCode,
          plannedQuantity: dailyReportItems.plannedQuantity,
          cumulativeQuantity: dailyReportItems.cumulativeQuantity,
          reportDate: dailyReports.reportDate,
        })
        .from(dailyReportItems)
        .innerJoin(dailyReports, eq(dailyReportItems.dailyReportId, dailyReports.id))
        .where(and(...conditions))
        .orderBy(desc(dailyReports.reportDate), desc(dailyReportItems.createdAt))
        .limit(500);
      // Newest line per piece of work: a linked task, else the description.
      const latest = new Map<string, (typeof lines)[number]>();
      for (const line of lines) {
        const key = line.taskId ? `task:${line.taskId}` : `text:${line.description.toLowerCase()}`;
        if (!latest.has(key)) latest.set(key, line);
      }
      return { tasks, lastLines: [...latest.values()].slice(0, 100) };
    }),

  /** The creator corrects a draft or a returned report; lines are replaced as a whole. */
  updateDraft: protectedProcedure
    .input(
      z.object({
        reportId: z.string().uuid(),
        title: z.string().trim().min(2).max(180),
        remarks: z.string().trim().max(5000).optional(),
        nextDayPlan: z.string().trim().max(3000).optional(),
        ...reportHeaderFields,
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const report = await loadReport(input.reportId);
      const scope = await getSiteScope(
        ctx.user,
        report.siteId,
        report.reportKind === "DPR" ? "dpr.create" : "dlr.create",
      );
      const items = await checkReportItems(report.reportKind, scope.siteId, input.items);
      const database = await db();
      await database.transaction(async (tx) => {
        const [locked] = await tx
          .select()
          .from(dailyReports)
          .where(eq(dailyReports.id, report.id))
          .for("update")
          .limit(1);
        if (!locked) throw new TRPCError({ code: "NOT_FOUND", message: "Report not found." });
        if (locked.createdBy !== ctx.user.id)
          throw new TRPCError({
            code: "FORBIDDEN",
            message: "Only the person who wrote this report can correct it.",
          });
        if (!(EDITABLE as readonly string[]).includes(locked.status))
          throw new TRPCError({
            code: "PRECONDITION_FAILED",
            message: "Only a draft or a returned report can be changed.",
          });
        const before = await tx
          .select({ id: dailyReportItems.id })
          .from(dailyReportItems)
          .where(eq(dailyReportItems.dailyReportId, locked.id));
        await tx
          .update(dailyReports)
          .set({
            title: input.title,
            remarks: input.remarks || null,
            nextDayPlan: input.nextDayPlan || null,
            weatherCode: input.weatherCode ?? null,
            overallStatus: input.overallStatus ?? null,
            updatedAt: new Date(),
          })
          .where(eq(dailyReports.id, locked.id));
        await tx.delete(dailyReportItems).where(eq(dailyReportItems.dailyReportId, locked.id));
        await insertReportItems(tx, locked.id, items);
        await tx.insert(auditEvents).values({
          id: randomUUID(),
          organizationId: scope.organizationId,
          siteId: scope.siteId,
          actorUserId: ctx.user.id,
          action: "report.draft_updated",
          entityType: "daily_report",
          entityId: locked.id,
          requestId: requestId(ctx.req.headers["x-request-id"]),
          beforeSummary: JSON.stringify({ status: locked.status, lines: before.length }),
          afterSummary: JSON.stringify({ status: locked.status, lines: items.length }),
        });
      });
      return { id: report.id };
    }),
};
