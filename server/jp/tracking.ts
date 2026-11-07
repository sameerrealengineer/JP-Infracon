import { and, between, eq, gte, inArray, isNull, lte, or } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import {
  attendanceRecords,
  dailyReports,
  people,
  personSiteAssignments,
  siteAssignments,
  sitePresenceEvents,
  users,
  workerAccounts,
  workerEngagements,
  workTasks,
} from "../../drizzle/schema";
import { protectedProcedure, router } from "../_core/trpc";
import { getDb } from "../db";
import { getAccessibleSites } from "./access";
import { advanceLedger, runShares, unpaidAttendance } from "./advances";
import { siteCapabilities, sitesWithPermission } from "./capabilities";
import {
  estimateEarning,
  parseHours,
  type AttendanceStatus,
  type RateType,
} from "../../lib/jp/attendance-domain";
import { workerPosition } from "../../lib/jp/advance-domain";
import {
  countReports,
  countTasks,
  istDate,
  emptyAttendance,
  monthInstants,
  monthRange,
  summarizeMonthAttendance,
  summarizePresence,
  type PresenceSummary,
} from "../../lib/jp/tracking-domain";

/**
 * Team tracking (`jp.tracking`): for one month, each worker's attendance, hours, overtime, site
 * presence and money, and each staff member's daily reports and site presence. Leaders see every
 * site; project managers see the sites where they hold `workforce.review`. Wages and advances only
 * for sites where the caller holds `payroll.view`. Read only: nothing here changes a record.
 */

const MAX_SITES = 60;

function requireDb(db: Awaited<ReturnType<typeof getDb>>) {
  if (!db)
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message: "The business data service is temporarily unavailable.",
    });
  return db;
}

const presenceOut = (summary: PresenceSummary | undefined) =>
  summary
    ? {
        daysOnSite: summary.daysOnSite,
        lastEvent: summary.lastEvent,
        lastAt: summary.lastAt,
        onSiteNow: summary.onSiteNow,
        arrivedTodayAt: summary.arrivedTodayAt,
      }
    : null;

export const trackingRouter = router({
  overview: protectedProcedure
    .input(
      z.object({
        siteId: z.string().uuid().nullable(),
        month: z.string().regex(/^\d{4}-\d{2}$/),
      }),
    )
    .query(async ({ ctx, input }) => {
      const range = monthRange(input.month);
      const instants = monthInstants(input.month);
      if (!range || !instants)
        throw new TRPCError({ code: "BAD_REQUEST", message: "Choose a valid month." });
      const accessible = await getAccessibleSites(ctx.user);
      const capabilities = await siteCapabilities(ctx.user, accessible);
      const allIds = accessible.map((site) => site.id);
      const reviewable = sitesWithPermission(capabilities, allIds, "workforce.review");
      if (!reviewable.length)
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "Your role does not include workforce.review.",
        });
      if (input.siteId && !reviewable.includes(input.siteId))
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "Your current role does not include workforce.review for this site.",
        });
      const siteIds = input.siteId ? [input.siteId] : reviewable.slice(0, MAX_SITES);
      const moneySites = new Set(sitesWithPermission(capabilities, siteIds, "payroll.view"));
      const siteName = new Map(accessible.map((site) => [site.id, site.name]));
      const db = requireDb(await getDb());
      const now = new Date();

      const [workerRows, staffRows, attendance, events, reports, tasks] = await Promise.all([
        db
          .select({
            personId: people.id,
            name: people.fullName,
            trade: people.tradeType,
            skill: people.skillCategory,
            personType: people.personType,
            siteId: personSiteAssignments.siteId,
          })
          .from(personSiteAssignments)
          .innerJoin(people, eq(personSiteAssignments.personId, people.id))
          .where(
            and(
              inArray(personSiteAssignments.siteId, siteIds),
              eq(personSiteAssignments.status, "Active"),
              eq(people.status, "Active"),
            ),
          ),
        db
          .select({
            userId: siteAssignments.userId,
            role: siteAssignments.assignmentRole,
            siteId: siteAssignments.siteId,
            name: users.name,
          })
          .from(siteAssignments)
          .innerJoin(users, eq(siteAssignments.userId, users.id))
          .where(
            and(
              inArray(siteAssignments.siteId, siteIds),
              eq(siteAssignments.status, "Active"),
              lte(siteAssignments.effectiveFrom, now),
              or(isNull(siteAssignments.effectiveTo), gte(siteAssignments.effectiveTo, now)),
            ),
          ),
        db
          .select({
            personId: workerEngagements.personId,
            siteId: attendanceRecords.siteId,
            status: attendanceRecords.attendanceStatus,
            regular: attendanceRecords.regularHours,
            overtime: attendanceRecords.overtimeHours,
            overtimeStatus: attendanceRecords.overtimeApprovalStatus,
            reviewedBy: attendanceRecords.reviewedBy,
            rate: attendanceRecords.rateSnapshotMinor,
            rateType: workerEngagements.rateType,
          })
          .from(attendanceRecords)
          .innerJoin(
            workerEngagements,
            eq(attendanceRecords.workerEngagementId, workerEngagements.id),
          )
          .where(
            and(
              inArray(attendanceRecords.siteId, siteIds),
              between(attendanceRecords.workDate, range.from, range.to),
            ),
          ),
        db
          .select({
            userId: sitePresenceEvents.userId,
            eventType: sitePresenceEvents.eventType,
            occurredAt: sitePresenceEvents.occurredAt,
          })
          .from(sitePresenceEvents)
          .where(
            and(
              inArray(sitePresenceEvents.siteId, siteIds),
              between(sitePresenceEvents.occurredAt, instants.start, instants.end),
            ),
          ),
        db
          .select({ createdBy: dailyReports.createdBy, status: dailyReports.status })
          .from(dailyReports)
          .where(
            and(
              inArray(dailyReports.siteId, siteIds),
              between(dailyReports.reportDate, range.from, range.to),
            ),
          ),
        db
          .select({
            assigneeUserId: workTasks.assigneeUserId,
            status: workTasks.status,
            plannedEnd: workTasks.plannedEnd,
          })
          .from(workTasks)
          .where(inArray(workTasks.siteId, siteIds)),
      ]);
      const taskCounts = countTasks(
        tasks.map((row) => ({ ...row, plannedEnd: String(row.plannedEnd) })),
        istDate(now),
      );

      const personIds = [...new Set(workerRows.map((row) => row.personId))];
      const logins = personIds.length
        ? await db
            .select({ personId: workerAccounts.personId, userId: workerAccounts.userId })
            .from(workerAccounts)
            .where(inArray(workerAccounts.personId, personIds))
        : [];
      const loginOf = new Map(logins.map((row) => [row.personId, row.userId]));

      const attendanceSums = summarizeMonthAttendance(
        attendance.map((row) => ({
          personId: row.personId,
          status: row.status as AttendanceStatus,
          regularHundredths: parseHours(String(row.regular)) ?? 0n,
          overtimeHundredths: parseHours(String(row.overtime)) ?? 0n,
          // Only overtime still waiting for a decision counts as pending.
          overtimeApproved: row.overtimeStatus !== "Pending",
          approved: row.reviewedBy !== null,
        })),
      );
      // Earned this month from approved marks only, on sites where wages may be seen.
      const earnedMonth = new Map<string, bigint>();
      for (const row of attendance) {
        if (row.reviewedBy === null || !moneySites.has(row.siteId)) continue;
        const earning = estimateEarning({
          status: row.status as AttendanceStatus,
          rateType: row.rateType as RateType,
          rateMinor: row.rate,
          regularHundredths: parseHours(String(row.regular)) ?? 0n,
          overtimeHundredths: parseHours(String(row.overtime)) ?? 0n,
          overtimeApproved: row.overtimeStatus === "Approved",
        });
        if (earning.kind === "amount")
          earnedMonth.set(row.personId, (earnedMonth.get(row.personId) ?? 0n) + earning.minor);
      }

      // Money position (all time) per person, added up over the sites where wages may be seen.
      const money = new Map<string, { paid: bigint; due: bigint; advance: bigint }>();
      for (const siteId of moneySites) {
        const here = workerRows.filter((row) => row.siteId === siteId).map((row) => row.personId);
        if (!here.length) continue;
        const [ledger, shares, unpaid] = await Promise.all([
          advanceLedger(db, siteId, here),
          runShares(db, siteId),
          unpaidAttendance(db, siteId),
        ]);
        for (const personId of here) {
          const position = workerPosition({
            runs: shares
              .filter((row) => row.personId === personId)
              .map((row) => ({
                status: row.status,
                grossMinor: BigInt(row.grossMinor),
                netMinor: BigInt(row.netMinor),
                month: row.month,
                paidOn: row.paidOn ? String(row.paidOn) : null,
              })),
            unpaidAttendanceMinor: unpaid.get(personId) ?? 0n,
            entries: ledger.entriesOf(personId),
            deductions: ledger.deductionsOf(personId),
          });
          const sum = money.get(personId) ?? { paid: 0n, due: 0n, advance: 0n };
          sum.paid += position.paidMinor;
          sum.due += position.dueMinor;
          sum.advance += position.advanceOutstandingMinor;
          money.set(personId, sum);
        }
      }

      const presence = summarizePresence(
        events.map((row) => ({
          userId: row.userId,
          eventType: row.eventType,
          occurredAt: new Date(row.occurredAt),
        })),
        now,
      );
      const reportCounts = countReports(
        reports.map((row) => ({ createdBy: row.createdBy, status: row.status })),
      );

      const workers = personIds
        .map((personId) => {
          const rows = workerRows.filter((row) => row.personId === personId);
          const sum = attendanceSums.get(personId) ?? emptyAttendance();
          const userId = loginOf.get(personId);
          const wages = rows.some((row) => moneySites.has(row.siteId));
          const position = money.get(personId);
          return {
            personId,
            name: rows[0].name,
            trade: rows[0].trade,
            skill: rows[0].skill,
            personType: rows[0].personType,
            sites: [...new Set(rows.map((row) => siteName.get(row.siteId) ?? ""))],
            presentHalfDays: sum.presentHalfDays,
            absentDays: sum.absentDays,
            leaveDays: sum.leaveDays,
            markedDays: sum.markedDays,
            regularHundredths: sum.regularHundredths.toString(),
            overtimeHundredths: sum.overtimeHundredths.toString(),
            overtimePendingHundredths: sum.overtimePendingHundredths.toString(),
            pendingRows: sum.pendingRows,
            hasPhoneLogin: userId !== undefined,
            presence: userId !== undefined ? presenceOut(presence.get(userId)) : null,
            earnedMonthMinor: wages ? (earnedMonth.get(personId) ?? 0n).toString() : null,
            paidMinor: wages && position ? position.paid.toString() : wages ? "0" : null,
            dueMinor: wages && position ? position.due.toString() : wages ? "0" : null,
            advanceOutstandingMinor:
              wages && position ? position.advance.toString() : wages ? "0" : null,
          };
        })
        .sort((a, b) => a.name.localeCompare(b.name));

      const staffIds = [...new Set(staffRows.map((row) => row.userId))];
      const staff = staffIds
        .map((userId) => {
          const rows = staffRows.filter((row) => row.userId === userId);
          const count = reportCounts.get(userId) ?? {
            submitted: 0,
            approved: 0,
            returned: 0,
            drafts: 0,
          };
          return {
            userId,
            name: rows[0].name ?? "—",
            roles: [...new Set(rows.map((row) => row.role))],
            sites: [...new Set(rows.map((row) => siteName.get(row.siteId) ?? ""))],
            reportsSubmitted: count.submitted,
            reportsApproved: count.approved,
            reportsReturned: count.returned,
            reportDrafts: count.drafts,
            tasks: taskCounts.get(userId) ?? { open: 0, done: 0, overdue: 0 },
            presence: presenceOut(presence.get(userId)),
          };
        })
        .sort((a, b) => a.name.localeCompare(b.name));

      const sumMoney = (key: "earnedMonthMinor" | "dueMinor" | "advanceOutstandingMinor") =>
        moneySites.size
          ? workers.reduce((total, row) => total + BigInt(row[key] ?? "0"), 0n).toString()
          : null;
      const onSite = (row: { presence: { onSiteNow: boolean } | null }) =>
        Boolean(row.presence?.onSiteNow);
      return {
        month: input.month,
        sites: reviewable.map((id) => ({ id, name: siteName.get(id) ?? "" })),
        canSeeMoney: moneySites.size > 0,
        generatedAt: now,
        totals: {
          workers: workers.length,
          staff: staff.length,
          onSiteNow: workers.filter(onSite).length + staff.filter(onSite).length,
          presentHalfDays: workers.reduce((total, row) => total + row.presentHalfDays, 0),
          markedDays: workers.reduce((total, row) => total + row.markedDays, 0),
          overtimeHundredths: workers
            .reduce((total, row) => total + BigInt(row.overtimeHundredths), 0n)
            .toString(),
          pendingRows: workers.reduce((total, row) => total + row.pendingRows, 0),
          reportsSubmitted: staff.reduce((total, row) => total + row.reportsSubmitted, 0),
          earnedMonthMinor: sumMoney("earnedMonthMinor"),
          dueMinor: sumMoney("dueMinor"),
          advanceOutstandingMinor: sumMoney("advanceOutstandingMinor"),
        },
        workers,
        staff,
      };
    }),
});
