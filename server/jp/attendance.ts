import { randomUUID } from "node:crypto";
import { and, asc, eq, gte, isNull, lte, or } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import {
  attendanceRecords,
  auditEvents,
  people,
  sites,
  users,
  workerEngagements,
} from "../../drizzle/schema";
import { protectedProcedure, router } from "../_core/trpc";
import { getDb } from "../db";
import { getSiteScope, selfApprovalAllowed } from "./access";
import {
  attendanceStatuses,
  estimateEarning,
  formatHours,
  parseHours,
  validateAttendanceEntry,
  type RateType,
} from "../../lib/jp/attendance-domain";

const dateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD.");
const shiftSchema = z.string().trim().min(1).max(32).default("GEN");
const mutationIdSchema = z.string().trim().min(16).max(64);

function requireDb(db: Awaited<ReturnType<typeof getDb>>) {
  if (!db)
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message: "The business data service is temporarily unavailable.",
    });
  return db;
}
type Db = ReturnType<typeof requireDb>;

async function canSeeRates(user: Parameters<typeof getSiteScope>[0], siteId: string) {
  try {
    await getSiteScope(user, siteId, "compensation.view");
    return true;
  } catch {
    return false;
  }
}

/** Engagements active on the site for that date (approved rate in force). */
async function activeEngagements(db: Db, siteId: string, workDate: string) {
  return db
    .select({
      engagementId: workerEngagements.id,
      personId: people.id,
      name: people.fullName,
      trade: people.tradeType,
      engagementType: workerEngagements.engagementType,
      rateType: workerEngagements.rateType,
      rateMinor: workerEngagements.rateMinor,
    })
    .from(workerEngagements)
    .innerJoin(people, eq(workerEngagements.personId, people.id))
    .where(
      and(
        eq(workerEngagements.siteId, siteId),
        eq(workerEngagements.status, "Active"),
        lte(workerEngagements.effectiveFrom, workDate),
        or(isNull(workerEngagements.effectiveTo), gte(workerEngagements.effectiveTo, workDate)),
      ),
    )
    .orderBy(asc(people.fullName))
    .limit(500);
}

function today() {
  return new Date().toISOString().slice(0, 10);
}

export const attendanceRouter = router({
  roster: protectedProcedure
    .input(z.object({ siteId: z.string().uuid(), workDate: dateSchema, shiftCode: shiftSchema }))
    .query(async ({ ctx, input }) => {
      const scope = await getSiteScope(ctx.user, input.siteId, "attendance.view");
      const db = requireDb(await getDb());
      const showRates = await canSeeRates(ctx.user, scope.siteId);
      const engagements = await activeEngagements(db, scope.siteId, input.workDate);
      const marked = await db
        .select({
          id: attendanceRecords.id,
          engagementId: attendanceRecords.workerEngagementId,
          status: attendanceRecords.attendanceStatus,
          regularHours: attendanceRecords.regularHours,
          overtimeHours: attendanceRecords.overtimeHours,
          overtimeApprovalStatus: attendanceRecords.overtimeApprovalStatus,
          markedBy: attendanceRecords.markedBy,
          markedByName: users.name,
          reviewedBy: attendanceRecords.reviewedBy,
          updatedAt: attendanceRecords.updatedAt,
        })
        .from(attendanceRecords)
        .innerJoin(users, eq(attendanceRecords.markedBy, users.id))
        .where(
          and(
            eq(attendanceRecords.siteId, scope.siteId),
            eq(attendanceRecords.workDate, input.workDate),
            eq(attendanceRecords.shiftCode, input.shiftCode),
          ),
        );
      return {
        siteName: scope.siteName,
        rows: engagements.map((engagement) => {
          const record = marked.find((row) => row.engagementId === engagement.engagementId);
          return {
            engagementId: engagement.engagementId,
            name: engagement.name,
            trade: engagement.trade,
            engagementType: engagement.engagementType,
            rateType: showRates ? engagement.rateType : null,
            rateMinor: showRates ? engagement.rateMinor : null,
            record: record
              ? {
                  ...record,
                  regularHours: String(record.regularHours),
                  overtimeHours: String(record.overtimeHours),
                  approved: record.reviewedBy !== null,
                }
              : null,
          };
        }),
        me: ctx.user.id,
      };
    }),

  mark: protectedProcedure
    .input(
      z.object({
        siteId: z.string().uuid(),
        workDate: dateSchema,
        shiftCode: shiftSchema,
        entries: z
          .array(
            z.object({
              engagementId: z.string().uuid(),
              status: z.enum(attendanceStatuses),
              regularHours: z.string().max(6),
              overtimeHours: z.string().max(6),
            }),
          )
          .min(1)
          .max(500),
        clientMutationId: mutationIdSchema,
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const scope = await getSiteScope(ctx.user, input.siteId, "attendance.mark");
      if (input.workDate > today())
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Attendance cannot be marked for a future date.",
        });
      const db = requireDb(await getDb());
      const [prior] = await db
        .select({ id: auditEvents.id })
        .from(auditEvents)
        .where(
          and(
            eq(auditEvents.actorUserId, ctx.user.id),
            eq(auditEvents.clientMutationId, input.clientMutationId),
          ),
        )
        .limit(1);
      if (prior) return { saved: input.entries.length, locked: 0 };
      for (const entry of input.entries) {
        const problem = validateAttendanceEntry(entry);
        if (problem) throw new TRPCError({ code: "BAD_REQUEST", message: problem });
      }
      const engagements = await activeEngagements(db, scope.siteId, input.workDate);
      let saved = 0;
      let locked = 0;
      await db.transaction(async (tx) => {
        await tx
          .select({ id: sites.id })
          .from(sites)
          .where(eq(sites.id, scope.siteId))
          .for("update");
        for (const entry of input.entries) {
          const engagement = engagements.find((row) => row.engagementId === entry.engagementId);
          if (!engagement)
            throw new TRPCError({
              code: "BAD_REQUEST",
              message: "One of the workers has no active engagement on this site for that date.",
            });
          const regular = formatHours(parseHours(entry.regularHours)!);
          const overtime = parseHours(entry.overtimeHours)!;
          const [existing] = await tx
            .select()
            .from(attendanceRecords)
            .where(
              and(
                eq(attendanceRecords.workerEngagementId, entry.engagementId),
                eq(attendanceRecords.siteId, scope.siteId),
                eq(attendanceRecords.workDate, input.workDate),
                eq(attendanceRecords.shiftCode, input.shiftCode),
              ),
            )
            .for("update");
          const values = {
            attendanceStatus: entry.status,
            regularHours: regular,
            overtimeHours: formatHours(overtime),
            overtimeApprovalStatus:
              overtime > 0n ? ("Pending" as const) : ("Not Applicable" as const),
            rateSnapshotMinor: engagement.rateMinor,
            markedBy: ctx.user.id,
          };
          if (existing) {
            if (existing.reviewedBy !== null) {
              locked += 1;
              continue;
            }
            await tx
              .update(attendanceRecords)
              .set(values)
              .where(eq(attendanceRecords.id, existing.id));
          } else {
            await tx.insert(attendanceRecords).values({
              id: randomUUID(),
              organizationId: scope.organizationId,
              siteId: scope.siteId,
              workDate: input.workDate,
              shiftCode: input.shiftCode,
              workerEngagementId: entry.engagementId,
              ...values,
            });
          }
          saved += 1;
        }
        await tx.insert(auditEvents).values({
          id: randomUUID(),
          organizationId: scope.organizationId,
          siteId: scope.siteId,
          actorUserId: ctx.user.id,
          action: "attendance.marked",
          entityType: "attendance",
          entityId: randomUUID(),
          clientMutationId: input.clientMutationId,
          afterSummary: JSON.stringify({
            workDate: input.workDate,
            shiftCode: input.shiftCode,
            saved,
            locked,
          }),
        });
      });
      return { saved, locked };
    }),

  approve: protectedProcedure
    .input(
      z.object({
        siteId: z.string().uuid(),
        workDate: dateSchema,
        shiftCode: shiftSchema,
        overtime: z.enum(["approve", "reject"]),
        clientMutationId: mutationIdSchema,
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const scope = await getSiteScope(ctx.user, input.siteId, "attendance.approve");
      const selfOk = await selfApprovalAllowed(ctx.user, scope.siteId);
      const db = requireDb(await getDb());
      const [prior] = await db
        .select({ id: auditEvents.id })
        .from(auditEvents)
        .where(
          and(
            eq(auditEvents.actorUserId, ctx.user.id),
            eq(auditEvents.clientMutationId, input.clientMutationId),
          ),
        )
        .limit(1);
      if (prior) return { approved: 0, skippedOwn: 0 };
      let approved = 0;
      let skippedOwn = 0;
      await db.transaction(async (tx) => {
        const rows = await tx
          .select()
          .from(attendanceRecords)
          .where(
            and(
              eq(attendanceRecords.siteId, scope.siteId),
              eq(attendanceRecords.workDate, input.workDate),
              eq(attendanceRecords.shiftCode, input.shiftCode),
              isNull(attendanceRecords.reviewedBy),
            ),
          )
          .for("update");
        for (const row of rows) {
          // Maker-checker: nobody approves attendance they marked themselves.
          if (row.markedBy === ctx.user.id && !selfOk) {
            skippedOwn += 1;
            continue;
          }
          await tx
            .update(attendanceRecords)
            .set({
              reviewedBy: ctx.user.id,
              overtimeApprovalStatus:
                row.overtimeApprovalStatus === "Pending"
                  ? input.overtime === "approve"
                    ? "Approved"
                    : "Rejected"
                  : row.overtimeApprovalStatus,
            })
            .where(eq(attendanceRecords.id, row.id));
          approved += 1;
        }
        if (approved === 0)
          throw new TRPCError({
            code: "PRECONDITION_FAILED",
            message: skippedOwn
              ? "You marked this attendance yourself; a different person must approve it."
              : "There is no unapproved attendance for this date and shift.",
          });
        await tx.insert(auditEvents).values({
          id: randomUUID(),
          organizationId: scope.organizationId,
          siteId: scope.siteId,
          actorUserId: ctx.user.id,
          action: "attendance.approved",
          entityType: "attendance",
          entityId: randomUUID(),
          clientMutationId: input.clientMutationId,
          afterSummary: JSON.stringify({
            workDate: input.workDate,
            shiftCode: input.shiftCode,
            approved,
            overtime: input.overtime,
          }),
        });
      });
      return { approved, skippedOwn };
    }),

  /** Estimated labour cost per worker. Only approved attendance counts as approved earnings. */
  labourSummary: protectedProcedure
    .input(z.object({ siteId: z.string().uuid(), from: dateSchema, to: dateSchema }))
    .query(async ({ ctx, input }) => {
      const scope = await getSiteScope(ctx.user, input.siteId, "compensation.view");
      if (input.to < input.from)
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "The end date is before the start date.",
        });
      const db = requireDb(await getDb());
      const rows = await db
        .select({
          engagementId: attendanceRecords.workerEngagementId,
          name: people.fullName,
          rateType: workerEngagements.rateType,
          rateSnapshot: attendanceRecords.rateSnapshotMinor,
          status: attendanceRecords.attendanceStatus,
          regular: attendanceRecords.regularHours,
          overtime: attendanceRecords.overtimeHours,
          overtimeStatus: attendanceRecords.overtimeApprovalStatus,
          reviewedBy: attendanceRecords.reviewedBy,
        })
        .from(attendanceRecords)
        .innerJoin(
          workerEngagements,
          eq(attendanceRecords.workerEngagementId, workerEngagements.id),
        )
        .innerJoin(people, eq(workerEngagements.personId, people.id))
        .where(
          and(
            eq(attendanceRecords.siteId, scope.siteId),
            gte(attendanceRecords.workDate, input.from),
            lte(attendanceRecords.workDate, input.to),
          ),
        )
        .limit(20000);
      type Total = {
        engagementId: string;
        name: string;
        presentHalfDays: number;
        regularHundredths: bigint;
        overtimeApprovedHundredths: bigint;
        overtimePendingHundredths: bigint;
        approvedMinor: bigint;
        pendingMinor: bigint;
        missingRate: number;
        notAttendanceBased: boolean;
      };
      const byWorker = new Map<string, Total>();
      for (const row of rows) {
        const total =
          byWorker.get(row.engagementId) ??
          ({
            engagementId: row.engagementId,
            name: row.name,
            presentHalfDays: 0,
            regularHundredths: 0n,
            overtimeApprovedHundredths: 0n,
            overtimePendingHundredths: 0n,
            approvedMinor: 0n,
            pendingMinor: 0n,
            missingRate: 0,
            notAttendanceBased: false,
          } satisfies Total);
        const regular = parseHours(String(row.regular)) ?? 0n;
        const overtime = parseHours(String(row.overtime)) ?? 0n;
        total.presentHalfDays += row.status === "Full Day" ? 2 : row.status === "Half Day" ? 1 : 0;
        total.regularHundredths += regular;
        if (row.overtimeStatus === "Approved") total.overtimeApprovedHundredths += overtime;
        if (row.overtimeStatus === "Pending") total.overtimePendingHundredths += overtime;
        const earning = estimateEarning({
          status: row.status,
          rateType: row.rateType as RateType,
          rateMinor: row.rateSnapshot,
          regularHundredths: regular,
          overtimeHundredths: overtime,
          overtimeApproved: row.overtimeStatus === "Approved",
        });
        if (earning.kind === "missing_rate") total.missingRate += 1;
        else if (earning.kind === "not_attendance_based") total.notAttendanceBased = true;
        else if (row.reviewedBy !== null) total.approvedMinor += earning.minor;
        else total.pendingMinor += earning.minor;
        byWorker.set(row.engagementId, total);
      }
      const workers = [...byWorker.values()].sort((a, b) => a.name.localeCompare(b.name));
      const sum = (pick: (row: Total) => bigint) =>
        workers.reduce((acc, row) => acc + pick(row), 0n);
      return {
        siteName: scope.siteName,
        from: input.from,
        to: input.to,
        workers: workers.map((row) => ({
          ...row,
          presentDays: row.presentHalfDays / 2,
          regularHours: formatHours(row.regularHundredths),
          overtimeApprovedHours: formatHours(row.overtimeApprovedHundredths),
          overtimePendingHours: formatHours(row.overtimePendingHundredths),
          approvedMinor: row.approvedMinor.toString(),
          pendingMinor: row.pendingMinor.toString(),
          regularHundredths: undefined,
          overtimeApprovedHundredths: undefined,
          overtimePendingHundredths: undefined,
        })),
        totals: {
          approvedMinor: sum((row) => row.approvedMinor).toString(),
          pendingMinor: sum((row) => row.pendingMinor).toString(),
          records: rows.length,
        },
      };
    }),
});
