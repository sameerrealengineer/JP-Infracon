import { and, desc, eq, inArray } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import {
  attachments,
  auditEvents,
  dailyReportItems,
  dailyReports,
  projects,
  sites,
  workTasks,
} from "../../drizzle/schema";
import { protectedProcedure, router } from "../_core/trpc";
import { getDb } from "../db";
import { storageGetSignedUrl } from "../storage";
import { getAccessibleSites, getSiteScope } from "./access";
import {
  summarizeProgress,
  taskProgressTenths,
  expectedTenths,
} from "../../lib/jp/progress-domain";
import { randomUUID } from "node:crypto";

/**
 * Project and site cards (cover photo and estimated progress) and the schedule dashboard.
 * Progress comes from task status and the latest submitted or approved DPR line per task.
 */

function requireDb(db: Awaited<ReturnType<typeof getDb>>) {
  if (!db)
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message: "The business data service is temporarily unavailable.",
    });
  return db;
}
type Db = ReturnType<typeof requireDb>;

function todayIn(timeZone = "Asia/Kolkata") {
  return new Intl.DateTimeFormat("en-CA", { timeZone }).format(new Date());
}

/** Latest reported percent per task, from DPRs that were submitted or approved. */
async function reportedPercents(db: Db, taskIds: string[]) {
  const map = new Map<string, number>();
  if (taskIds.length === 0) return map;
  const rows = await db
    .select({
      taskId: dailyReportItems.taskId,
      percent: dailyReportItems.estimatedPercent,
      reportDate: dailyReports.reportDate,
    })
    .from(dailyReportItems)
    .innerJoin(dailyReports, eq(dailyReportItems.dailyReportId, dailyReports.id))
    .where(
      and(
        inArray(dailyReportItems.taskId, taskIds),
        inArray(dailyReports.status, ["Submitted", "Under Review", "Approved"]),
      ),
    )
    .orderBy(desc(dailyReports.reportDate))
    .limit(20_000);
  for (const row of rows)
    if (row.taskId && !map.has(row.taskId) && row.percent !== null)
      map.set(row.taskId, Number(row.percent));
  return map;
}

async function coverUrls(db: Db, attachmentIds: string[]) {
  const map = new Map<string, string>();
  if (attachmentIds.length === 0) return map;
  const rows = await db
    .select({ id: attachments.id, storageKey: attachments.storageKey })
    .from(attachments)
    .where(inArray(attachments.id, attachmentIds));
  await Promise.all(
    rows.map(async (row) => {
      try {
        map.set(row.id, await storageGetSignedUrl(row.storageKey));
      } catch {
        // No cover link when storage is unavailable; the card shows an icon instead.
      }
    }),
  );
  return map;
}

/** Cover photo and estimated progress for the person's sites and their projects. */
export async function placeCards(user: Parameters<typeof getAccessibleSites>[0]) {
  const accessible = await getAccessibleSites(user);
  if (accessible.length === 0) return { sites: [], projects: [], today: todayIn() };
  const db = requireDb(await getDb());
  const siteIds = accessible.map((site) => site.id);
  const projectIds = [...new Set(accessible.map((site) => site.projectId))];
  const [siteRows, projectRows, taskRows] = await Promise.all([
    db
      .select({ id: sites.id, cover: sites.coverAttachmentId, timeZone: sites.timeZone })
      .from(sites)
      .where(inArray(sites.id, siteIds)),
    db
      .select({ id: projects.id, name: projects.name, cover: projects.coverAttachmentId })
      .from(projects)
      .where(inArray(projects.id, projectIds)),
    db
      .select({
        id: workTasks.id,
        siteId: workTasks.siteId,
        status: workTasks.status,
        plannedStart: workTasks.plannedStart,
        plannedEnd: workTasks.plannedEnd,
      })
      .from(workTasks)
      .where(inArray(workTasks.siteId, siteIds))
      .limit(20_000),
  ]);
  const percents = await reportedPercents(
    db,
    taskRows.map((task) => task.id),
  );
  const covers = await coverUrls(
    db,
    [...siteRows.map((row) => row.cover), ...projectRows.map((row) => row.cover)].filter(
      (id): id is string => Boolean(id),
    ),
  );
  const today = todayIn();
  const tasksFor = (ids: Set<string>) =>
    taskRows
      .filter((task) => ids.has(task.siteId))
      .map((task) => ({ ...task, reportedPercent: percents.get(task.id) ?? null }));
  const siteCovers = new Map(siteRows.map((row) => [row.id, row.cover]));
  return {
    today,
    sites: accessible.map((site) => {
      const cover = siteCovers.get(site.id);
      const projectCover = projectRows.find((row) => row.id === site.projectId)?.cover;
      return {
        siteId: site.id,
        projectId: site.projectId,
        coverUrl:
          (cover ? covers.get(cover) : undefined) ??
          (projectCover ? covers.get(projectCover) : undefined) ??
          null,
        progress: summarizeProgress(tasksFor(new Set([site.id])), today),
      };
    }),
    projects: projectRows.map((project) => ({
      projectId: project.id,
      name: project.name,
      coverAttachmentId: project.cover ?? null,
      coverUrl: project.cover ? (covers.get(project.cover) ?? null) : null,
      progress: summarizeProgress(
        tasksFor(new Set(accessible.filter((s) => s.projectId === project.id).map((s) => s.id))),
        today,
      ),
    })),
  };
}

export const placesRouter = router({
  /** Cards for the person's sites and their projects: cover photo and estimated progress. */
  cards: protectedProcedure.query(({ ctx }) => placeCards(ctx.user)),

  /** The schedule as a dashboard: every task with actual vs expected progress. */
  schedule: protectedProcedure
    .input(z.object({ siteId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const scope = await getSiteScope(ctx.user, input.siteId, "task.view");
      const db = requireDb(await getDb());
      const [site] = await db
        .select({ timeZone: sites.timeZone })
        .from(sites)
        .where(eq(sites.id, scope.siteId))
        .limit(1);
      const today = todayIn(site?.timeZone);
      const tasks = await db
        .select({
          id: workTasks.id,
          taskCode: workTasks.taskCode,
          title: workTasks.title,
          workCategory: workTasks.workCategory,
          status: workTasks.status,
          priority: workTasks.priority,
          plannedStart: workTasks.plannedStart,
          plannedEnd: workTasks.plannedEnd,
        })
        .from(workTasks)
        .where(eq(workTasks.siteId, scope.siteId))
        .limit(5_000);
      const percents = await reportedPercents(
        db,
        tasks.map((task) => task.id),
      );
      const withProgress = tasks
        .map((task) => {
          const reportedPercent = percents.get(task.id) ?? null;
          return {
            ...task,
            reportedPercent,
            progressTenths: taskProgressTenths({ status: task.status, reportedPercent }),
            expectedTenths: expectedTenths(task, today),
            overdue:
              task.status !== "Completed" && task.status !== "Cancelled" && task.plannedEnd < today,
          };
        })
        .sort(
          (a, b) =>
            a.plannedStart.localeCompare(b.plannedStart) || a.taskCode.localeCompare(b.taskCode),
        );
      const range = tasks.length
        ? {
            start: tasks.reduce(
              (min, t) => (t.plannedStart < min ? t.plannedStart : min),
              tasks[0].plannedStart,
            ),
            end: tasks.reduce(
              (max, t) => (t.plannedEnd > max ? t.plannedEnd : max),
              tasks[0].plannedEnd,
            ),
          }
        : null;
      return {
        today,
        siteName: scope.siteName,
        range,
        summary: summarizeProgress(
          withProgress.map((task) => ({ ...task, reportedPercent: task.reportedPercent })),
          today,
        ),
        tasks: withProgress,
      };
    }),

  /** Choose one of a project's or site's own photos as its cover (or clear it). */
  setCover: protectedProcedure
    .input(
      z.object({
        entityType: z.enum(["project", "site"]),
        entityId: z.string().uuid(),
        attachmentId: z.string().uuid().nullable(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const db = requireDb(await getDb());
      const siteIds =
        input.entityType === "site"
          ? [input.entityId]
          : (
              await db
                .select({ id: sites.id })
                .from(sites)
                .where(eq(sites.projectId, input.entityId))
            ).map((row) => row.id);
      let scope: Awaited<ReturnType<typeof getSiteScope>> | null = null;
      for (const siteId of siteIds) {
        try {
          scope = await getSiteScope(ctx.user, siteId, "site.manage");
          break;
        } catch {
          // Try the project's next site.
        }
      }
      if (!scope)
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "Only people who manage projects and sites can change the cover photo.",
        });
      if (input.attachmentId) {
        const [file] = await db
          .select({ contentType: attachments.contentType })
          .from(attachments)
          .where(
            and(
              eq(attachments.id, input.attachmentId),
              eq(attachments.entityType, input.entityType),
              eq(attachments.entityId, input.entityId),
            ),
          )
          .limit(1);
        if (!file?.contentType.startsWith("image/"))
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "Choose one of this place's photos as the cover.",
          });
      }
      const table = input.entityType === "site" ? sites : projects;
      await db.transaction(async (tx) => {
        await tx
          .update(table)
          .set({ coverAttachmentId: input.attachmentId })
          .where(eq(table.id, input.entityId));
        await tx.insert(auditEvents).values({
          id: randomUUID(),
          organizationId: scope!.organizationId,
          siteId: scope!.siteId,
          actorUserId: ctx.user.id,
          action: `${input.entityType}.cover_changed`,
          entityType: input.entityType,
          entityId: input.entityId,
          afterSummary: JSON.stringify({ coverAttachmentId: input.attachmentId }),
        });
      });
      return { ok: true };
    }),
});
