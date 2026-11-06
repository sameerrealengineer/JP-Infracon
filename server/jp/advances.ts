import { randomUUID } from "node:crypto";
import { and, asc, desc, eq, inArray, ne } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import {
  attendanceRecords,
  auditEvents,
  payrollLines,
  payrollRuns,
  people,
  personSiteAssignments,
  workerAdvances,
  workerEngagements,
} from "../../drizzle/schema";
import { protectedProcedure, router } from "../_core/trpc";
import { getDb } from "../db";
import { getSiteScope, selfApprovalAllowed, type SiteScope } from "./access";
import {
  estimateEarning,
  parseHours,
  type AttendanceStatus,
  type RateType,
} from "../../lib/jp/attendance-domain";
import { parseRupeesToMinor } from "../../lib/jp/finance-domain";
import {
  advancePosition,
  checkAdvanceEntry,
  workerPosition,
  type LedgerEntry,
  type RunDeduction,
} from "../../lib/jp/advance-domain";

/**
 * Worker khaata: advances given and repaid (each approved by a different person) and each
 * worker's money position on a site: wages paid, approved but unpaid, attendance not yet in a
 * pay run, and the advance still to recover. Pay runs recover advances (see payroll.ts).
 * Entries are ledger records; money moves outside the app.
 */

const uuid = z.string().uuid();
const mutationId = z.string().trim().min(16).max(64);
const today = () => new Date().toISOString().slice(0, 10);

type Db = NonNullable<Awaited<ReturnType<typeof getDb>>>;
function requireDb(db: Awaited<ReturnType<typeof getDb>>): Db {
  if (!db)
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message: "The business data service is temporarily unavailable.",
    });
  return db;
}
function bad(message: string): never {
  throw new TRPCError({ code: "BAD_REQUEST", message });
}
function rupees(value: string | null | undefined, label: string) {
  if (!value?.trim()) return 0n;
  try {
    return BigInt(parseRupeesToMinor(value, true));
  } catch {
    bad(`${label}: enter an amount in rupees, like 500 or 1500.50.`);
  }
}
async function can(user: Parameters<typeof getSiteScope>[0], siteId: string, key: string) {
  return getSiteScope(user, siteId, key)
    .then(() => true)
    .catch(() => false);
}
/** View needs payroll.view, or payroll.advance for someone who hands out advances. */
async function viewScope(user: Parameters<typeof getSiteScope>[0], siteId: string) {
  try {
    return { scope: await getSiteScope(user, siteId, "payroll.view"), wages: true };
  } catch (cause) {
    try {
      return { scope: await getSiteScope(user, siteId, "payroll.advance"), wages: false };
    } catch {
      throw cause;
    }
  }
}

async function audit(
  db: Db,
  scope: SiteScope,
  userId: number,
  args: {
    action: string;
    entityId: string;
    clientMutationId?: string;
    before?: unknown;
    after?: unknown;
    reason?: string | null;
  },
) {
  await db.insert(auditEvents).values({
    id: randomUUID(),
    organizationId: scope.organizationId,
    siteId: scope.siteId,
    actorUserId: userId,
    action: args.action,
    entityType: "worker_advance",
    entityId: args.entityId,
    clientMutationId: args.clientMutationId ?? null,
    beforeSummary: args.before === undefined ? null : JSON.stringify(args.before),
    afterSummary: args.after === undefined ? null : JSON.stringify(args.after),
    reason: args.reason ?? null,
  });
}

async function replayed(db: Db, userId: number, clientMutationId: string) {
  const [event] = await db
    .select({ entityId: auditEvents.entityId })
    .from(auditEvents)
    .where(
      and(eq(auditEvents.actorUserId, userId), eq(auditEvents.clientMutationId, clientMutationId)),
    )
    .limit(1);
  return event ?? null;
}

const toEntry = (row: typeof workerAdvances.$inferSelect): LedgerEntry => ({
  entryType: row.entryType,
  status: row.status,
  amountMinor: BigInt(row.amountMinor),
  installmentMinor: BigInt(row.installmentMinor),
  entryDate: String(row.entryDate),
});

/** Advance entries and pay-run deductions for people on a site (all people when ids is null). */
export async function advanceLedger(db: Db, siteId: string, personIds: readonly string[] | null) {
  const entries = await db
    .select()
    .from(workerAdvances)
    .where(
      personIds
        ? and(eq(workerAdvances.siteId, siteId), inArray(workerAdvances.personId, [...personIds]))
        : eq(workerAdvances.siteId, siteId),
    )
    .orderBy(desc(workerAdvances.entryDate), desc(workerAdvances.createdAt));
  const deductions = await db
    .select({
      personId: payrollLines.personId,
      runId: payrollRuns.id,
      status: payrollRuns.status,
      advanceMinor: payrollLines.advanceMinor,
    })
    .from(payrollLines)
    .innerJoin(payrollRuns, eq(payrollLines.runId, payrollRuns.id))
    .where(
      personIds
        ? and(eq(payrollRuns.siteId, siteId), inArray(payrollLines.personId, [...personIds]))
        : eq(payrollRuns.siteId, siteId),
    );
  const entriesOf = (personId: string) =>
    entries.filter((row) => row.personId === personId).map(toEntry);
  const deductionsOf = (personId: string): RunDeduction[] =>
    deductions
      .filter((row) => row.personId === personId)
      .map((row) => ({
        runId: row.runId,
        status: row.status,
        advanceMinor: BigInt(row.advanceMinor),
      }));
  return { entries, entriesOf, deductionsOf };
}

/** Approved attendance earnings (estimate) in months with no approved or paid pay run. */
export async function unpaidAttendance(db: Db, siteId: string) {
  const covered = await db
    .select({ month: payrollRuns.month })
    .from(payrollRuns)
    .where(and(eq(payrollRuns.siteId, siteId), inArray(payrollRuns.status, ["Approved", "Paid"])));
  const months = new Set(covered.map((row) => row.month));
  const rows = await db
    .select({
      personId: workerEngagements.personId,
      date: attendanceRecords.workDate,
      status: attendanceRecords.attendanceStatus,
      rate: attendanceRecords.rateSnapshotMinor,
      rateType: workerEngagements.rateType,
      regular: attendanceRecords.regularHours,
      overtime: attendanceRecords.overtimeHours,
      overtimeStatus: attendanceRecords.overtimeApprovalStatus,
      reviewedBy: attendanceRecords.reviewedBy,
    })
    .from(attendanceRecords)
    .innerJoin(workerEngagements, eq(attendanceRecords.workerEngagementId, workerEngagements.id))
    .where(eq(attendanceRecords.siteId, siteId));
  const map = new Map<string, bigint>();
  for (const row of rows) {
    if (row.reviewedBy === null || months.has(String(row.date).slice(0, 7))) continue;
    const earning = estimateEarning({
      status: row.status as AttendanceStatus,
      rateType: row.rateType as RateType,
      rateMinor: row.rate,
      regularHundredths: parseHours(String(row.regular)) ?? 0n,
      overtimeHundredths: parseHours(String(row.overtime)) ?? 0n,
      overtimeApproved: row.overtimeStatus === "Approved",
    });
    if (earning.kind === "amount")
      map.set(row.personId, (map.get(row.personId) ?? 0n) + earning.minor);
  }
  return map;
}

export async function runShares(db: Db, siteId: string) {
  return db
    .select({
      personId: payrollLines.personId,
      runId: payrollRuns.id,
      runNumber: payrollRuns.runNumber,
      month: payrollRuns.month,
      status: payrollRuns.status,
      paidOn: payrollRuns.paidOn,
      grossMinor: payrollLines.grossMinor,
      deductionMinor: payrollLines.advanceMinor,
      netMinor: payrollLines.netMinor,
    })
    .from(payrollLines)
    .innerJoin(payrollRuns, eq(payrollLines.runId, payrollRuns.id))
    .where(and(eq(payrollRuns.siteId, siteId), ne(payrollRuns.status, "Cancelled")))
    .orderBy(desc(payrollRuns.month));
}

const money = (value: bigint) => value.toString();
function serialisePosition(position: ReturnType<typeof workerPosition>, wages: boolean) {
  return {
    paidMinor: wages ? money(position.paidMinor) : null,
    dueMinor: wages ? money(position.dueMinor) : null,
    approvedUnpaidMinor: wages ? money(position.approvedUnpaidMinor) : null,
    notInPayRunMinor: wages ? money(position.notInPayRunMinor) : null,
    lastPaidOn: wages ? position.lastPaidOn : null,
    advanceGivenMinor: money(position.advanceGivenMinor),
    advanceRecoveredMinor: money(position.advanceRecoveredMinor),
    advanceOutstandingMinor: money(position.advanceOutstandingMinor),
  };
}

/** One person's position on a site (shared with the worker's own view). */
export async function personPosition(db: Db, siteId: string, personId: string) {
  const [ledger, shares, unpaid] = await Promise.all([
    advanceLedger(db, siteId, [personId]),
    runShares(db, siteId),
    unpaidAttendance(db, siteId),
  ]);
  const mine = shares.filter((row) => row.personId === personId);
  const position = workerPosition({
    runs: mine.map((row) => ({
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
  return { position, runs: mine, entries: ledger.entries };
}

export const advancesRouter = router({
  /** Every person on the site with what was paid, what is due and the advance balance. */
  list: protectedProcedure.input(z.object({ siteId: uuid })).query(async ({ ctx, input }) => {
    const { scope, wages } = await viewScope(ctx.user, input.siteId);
    const db = requireDb(await getDb());
    const roster = await db
      .select({ id: people.id, name: people.fullName, trade: people.tradeType })
      .from(personSiteAssignments)
      .innerJoin(people, eq(personSiteAssignments.personId, people.id))
      .where(
        and(
          eq(personSiteAssignments.siteId, scope.siteId),
          eq(personSiteAssignments.status, "Active"),
        ),
      )
      .orderBy(asc(people.fullName));
    const [ledger, shares, unpaid] = await Promise.all([
      advanceLedger(db, scope.siteId, null),
      runShares(db, scope.siteId),
      unpaidAttendance(db, scope.siteId),
    ]);
    const [canApprove, selfOk] = await Promise.all([
      can(ctx.user, scope.siteId, "payroll.approve"),
      selfApprovalAllowed(ctx.user, scope.siteId),
    ]);
    const rows = roster.map((person) => {
      const position = workerPosition({
        runs: shares
          .filter((row) => row.personId === person.id)
          .map((row) => ({
            status: row.status,
            grossMinor: BigInt(row.grossMinor),
            netMinor: BigInt(row.netMinor),
            month: row.month,
            paidOn: row.paidOn ? String(row.paidOn) : null,
          })),
        unpaidAttendanceMinor: unpaid.get(person.id) ?? 0n,
        entries: ledger.entriesOf(person.id),
        deductions: ledger.deductionsOf(person.id),
      });
      return { ...person, ...serialisePosition(position, wages) };
    });
    const pending = ledger.entries
      .filter((row) => row.status === "Pending")
      .map((row) => ({
        ...row,
        personName: roster.find((p) => p.id === row.personId)?.name ?? "—",
        canReview: canApprove && (row.createdBy !== ctx.user.id || selfOk),
        canCancel: row.createdBy === ctx.user.id,
      }));
    const sum = (key: "dueMinor" | "advanceOutstandingMinor" | "paidMinor") =>
      rows.reduce((total, row) => total + BigInt(row[key] ?? "0"), 0n).toString();
    return {
      people: rows,
      pending,
      totals: wages
        ? {
            paidMinor: sum("paidMinor"),
            dueMinor: sum("dueMinor"),
            advanceMinor: sum("advanceOutstandingMinor"),
          }
        : { paidMinor: null, dueMinor: null, advanceMinor: sum("advanceOutstandingMinor") },
      can: {
        wages,
        request: await can(ctx.user, scope.siteId, "payroll.advance"),
        approve: canApprove,
      },
    };
  }),

  /** One person's khaata: position, pay runs and advance entries, newest first. */
  person: protectedProcedure
    .input(z.object({ siteId: uuid, personId: uuid }))
    .query(async ({ ctx, input }) => {
      const { scope, wages } = await viewScope(ctx.user, input.siteId);
      const db = requireDb(await getDb());
      const [person] = await db
        .select({
          id: people.id,
          name: people.fullName,
          trade: people.tradeType,
          organizationId: people.organizationId,
        })
        .from(people)
        .where(eq(people.id, input.personId))
        .limit(1);
      if (!person || person.organizationId !== scope.organizationId)
        throw new TRPCError({ code: "NOT_FOUND", message: "Person not found." });
      const result = await personPosition(db, scope.siteId, person.id);
      return {
        person: { id: person.id, name: person.name, trade: person.trade },
        siteName: scope.siteName,
        position: serialisePosition(result.position, wages),
        runs: wages
          ? result.runs.map((row) => ({ ...row, paidOn: row.paidOn ? String(row.paidOn) : null }))
          : [],
        entries: result.entries.map((row) => ({
          id: row.id,
          entryType: row.entryType,
          amountMinor: row.amountMinor,
          installmentMinor: row.installmentMinor,
          entryDate: String(row.entryDate),
          mode: row.mode,
          reference: row.reference,
          reason: row.reason,
          status: row.status,
          reviewReason: row.reviewReason,
        })),
      };
    }),

  /** Ask to give an advance, or record a cash repayment; a different person approves it. */
  request: protectedProcedure
    .input(
      z.object({
        siteId: uuid,
        personId: uuid,
        entryType: z.enum(["Advance", "Repayment"]),
        amountRupees: z.string().trim().max(20),
        installmentRupees: z.string().trim().max(20).nullish(),
        entryDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use a date like 2026-11-04."),
        mode: z.enum(["Bank transfer", "UPI", "Cheque", "Cash"]),
        reference: z.string().trim().max(120).nullish(),
        reason: z.string().trim().max(1000),
        clientMutationId: mutationId,
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const scope = await getSiteScope(ctx.user, input.siteId, "payroll.advance");
      const db = requireDb(await getDb());
      const prior = await replayed(db, ctx.user.id, input.clientMutationId);
      if (prior) return { id: prior.entityId };
      const [assigned] = await db
        .select({ id: personSiteAssignments.id })
        .from(personSiteAssignments)
        .where(
          and(
            eq(personSiteAssignments.siteId, scope.siteId),
            eq(personSiteAssignments.personId, input.personId),
            eq(personSiteAssignments.status, "Active"),
          ),
        )
        .limit(1);
      if (!assigned) bad("This person is not on this site's team.");
      const amount = rupees(input.amountRupees, "Amount");
      const installment =
        input.entryType === "Advance" ? rupees(input.installmentRupees, "Monthly recovery") : 0n;
      const ledger = await advanceLedger(db, scope.siteId, [input.personId]);
      const position = advancePosition(
        ledger.entriesOf(input.personId),
        ledger.deductionsOf(input.personId),
      );
      const problem = checkAdvanceEntry({
        entryType: input.entryType,
        amountMinor: amount,
        installmentMinor: installment,
        entryDate: input.entryDate,
        today: today(),
        reason: input.reason,
        outstandingMinor: position.outstanding - position.pending,
      });
      if (problem) bad(problem.message);
      if (input.mode !== "Cash" && !input.reference?.trim())
        bad("Enter the bank, UPI or cheque reference.");
      const id = randomUUID();
      await db.transaction(async (tx) => {
        await tx.insert(workerAdvances).values({
          id,
          organizationId: scope.organizationId,
          siteId: scope.siteId,
          personId: input.personId,
          entryType: input.entryType,
          amountMinor: amount.toString(),
          installmentMinor: installment.toString(),
          entryDate: input.entryDate,
          mode: input.mode,
          reference: input.reference?.trim() || null,
          reason: input.reason.trim(),
          status: "Pending",
          clientMutationId: input.clientMutationId,
          createdBy: ctx.user.id,
        });
        await audit(tx as unknown as Db, scope, ctx.user.id, {
          action: `payroll.advance_${input.entryType === "Advance" ? "request" : "repayment"}`,
          entityId: id,
          clientMutationId: input.clientMutationId,
          after: {
            personId: input.personId,
            entryType: input.entryType,
            amountMinor: amount.toString(),
            installmentMinor: installment.toString(),
            entryDate: input.entryDate,
            mode: input.mode,
          },
          reason: input.reason,
        });
      });
      return { id };
    }),

  review: protectedProcedure
    .input(
      z.object({
        siteId: uuid,
        entryId: uuid,
        action: z.enum(["approve", "reject", "cancel"]),
        reason: z.string().trim().max(1000).nullish(),
        clientMutationId: mutationId,
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const scope = await getSiteScope(
        ctx.user,
        input.siteId,
        input.action === "cancel" ? "payroll.advance" : "payroll.approve",
      );
      const db = requireDb(await getDb());
      if (await replayed(db, ctx.user.id, input.clientMutationId)) return { ok: true };
      if (input.action !== "approve" && !input.reason?.trim()) bad("Give a reason.");
      const selfOk = await selfApprovalAllowed(ctx.user, scope.siteId);
      await db.transaction(async (tx) => {
        const [entry] = await tx
          .select()
          .from(workerAdvances)
          .where(eq(workerAdvances.id, input.entryId))
          .for("update");
        if (!entry || entry.siteId !== scope.siteId)
          throw new TRPCError({ code: "NOT_FOUND", message: "Entry not found." });
        if (entry.status !== "Pending") bad(`This entry is already ${entry.status}.`);
        if (input.action === "cancel" && entry.createdBy !== ctx.user.id)
          throw new TRPCError({
            code: "FORBIDDEN",
            message: "Only the person who asked can cancel it.",
          });
        if (input.action !== "cancel" && entry.createdBy === ctx.user.id && !selfOk)
          throw new TRPCError({
            code: "FORBIDDEN",
            message: "A different person must approve or reject this entry.",
          });
        if (input.action === "approve" && entry.entryType === "Repayment") {
          const ledger = await advanceLedger(tx as unknown as Db, scope.siteId, [entry.personId]);
          const position = advancePosition(
            ledger.entriesOf(entry.personId),
            ledger.deductionsOf(entry.personId),
          );
          if (BigInt(entry.amountMinor) > position.outstanding - position.pending)
            bad("The repayment is more than the advance still to recover.");
        }
        const status =
          input.action === "approve"
            ? "Approved"
            : input.action === "reject"
              ? "Rejected"
              : "Cancelled";
        await tx
          .update(workerAdvances)
          .set({
            status,
            reviewedBy: input.action === "cancel" ? null : ctx.user.id,
            reviewedAt: new Date(),
            reviewReason: input.reason ?? null,
          })
          .where(eq(workerAdvances.id, entry.id));
        await audit(tx as unknown as Db, scope, ctx.user.id, {
          action: `payroll.advance_${input.action}`,
          entityId: entry.id,
          clientMutationId: input.clientMutationId,
          before: { status: entry.status },
          after: { status, amountMinor: entry.amountMinor, entryType: entry.entryType },
          reason: input.reason ?? null,
        });
      });
      return { ok: true };
    }),
});
