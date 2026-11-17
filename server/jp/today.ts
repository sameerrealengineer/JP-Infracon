import { and, count, eq, inArray, lt, notInArray } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { attendanceRecords, dailyReports, workTasks } from "../../drizzle/schema";
import { protectedProcedure, router } from "../_core/trpc";
import { getDb } from "../db";
import { getAccessibleSites } from "./access";
import { siteCapabilities } from "./capabilities";

/** India date today. */
function todayIst() {
  return new Date(Date.now() + 330 * 60_000).toISOString().slice(0, 10);
}

/**
 * Today on site, per Active site: attendance marked today, today's DPR and DLR status, and late
 * tasks — each only where the person may see it (null otherwise).
 */
export const todayRouter = router({
  sites: protectedProcedure.query(async ({ ctx }) => {
    const db = await getDb();
    if (!db)
      throw new TRPCError({
        code: "PRECONDITION_FAILED",
        message: "The business data service is temporarily unavailable.",
      });
    const today = todayIst();
    const active = (await getAccessibleSites(ctx.user)).filter((site) => site.status === "Active");
    if (!active.length) return { today, sites: [] };
    const caps = await siteCapabilities(ctx.user, active);
    const ids = active.map((site) => site.id);
    const [marks, reports, late] = await Promise.all([
      db
        .select({ siteId: attendanceRecords.siteId, n: count() })
        .from(attendanceRecords)
        .where(and(inArray(attendanceRecords.siteId, ids), eq(attendanceRecords.workDate, today)))
        .groupBy(attendanceRecords.siteId),
      db
        .select({
          siteId: dailyReports.siteId,
          kind: dailyReports.reportKind,
          status: dailyReports.status,
        })
        .from(dailyReports)
        .where(and(inArray(dailyReports.siteId, ids), eq(dailyReports.reportDate, today))),
      db
        .select({ siteId: workTasks.siteId, n: count() })
        .from(workTasks)
        .where(
          and(
            inArray(workTasks.siteId, ids),
            lt(workTasks.plannedEnd, today),
            notInArray(workTasks.status, ["Completed", "Cancelled"]),
          ),
        )
        .groupBy(workTasks.siteId),
    ]);
    return {
      today,
      sites: active.map((site) => {
        const can = caps.find((row) => row.siteId === site.id);
        const report = (kind: "DPR" | "DLR") =>
          reports.find((row) => row.siteId === site.id && row.kind === kind)?.status ?? null;
        return {
          siteId: site.id,
          name: site.name,
          project: site.project,
          attendance: can?.["attendance.view"]
            ? Number(marks.find((row) => row.siteId === site.id)?.n ?? 0)
            : null,
          canMark: Boolean(can?.["attendance.mark"]),
          dpr: can?.["dpr.view"] ? report("DPR") : undefined,
          canDpr: Boolean(can?.["dpr.create"]),
          dlr: can?.["dlr.view"] ? report("DLR") : undefined,
          lateTasks: can?.["task.view"]
            ? Number(late.find((row) => row.siteId === site.id)?.n ?? 0)
            : null,
        };
      }),
    };
  }),
});
