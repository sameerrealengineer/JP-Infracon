import { randomUUID } from "node:crypto";
import { and, desc, eq, inArray } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import {
  attendanceRecords,
  auditEvents,
  clientBills,
  clientReceipts,
  payrollLines,
  payrollRuns,
  pettyCashMovements,
  projects,
  sites,
  statutoryDeposits,
  subcontractBills,
  supplierInvoices,
  supplierPaymentAllocations,
  supplierPayments,
  vendors,
  workerEngagements,
} from "../../drizzle/schema";
import { protectedProcedure, router } from "../_core/trpc";
import { commercialAccess, type Db } from "./commercial-access";
import { approvedPayroll } from "./payroll";
import { parseRupeesToMinor } from "../../lib/jp/finance-domain";
import {
  estimateEarning,
  parseHours,
  type AttendanceStatus,
  type RateType,
} from "../../lib/jp/attendance-domain";
import {
  DUE_KINDS,
  checkDeposit,
  costHeadForSupplier,
  duesAgainstDeposits,
  gstSummary,
  projectPnl,
  type CostHead,
  type DueKind,
  type DueRow,
} from "../../lib/jp/accounts-domain";

/**
 * Accounts (company level, `accounts.*`): statutory dues from approved payroll (PF, ESI, PT,
 * salary TDS) and approved subcontract bills (contractor TDS) against the deposits accounts
 * records with the challan number; a monthly GST summary; receivables and payables; and project
 * profit from approved records only. Deposits are ledger records of payments made outside the
 * app, never payments themselves.
 */

const mutationId = z.string().trim().min(16).max(64);
const today = () => new Date().toISOString().slice(0, 10);

function bad(message: string): never {
  throw new TRPCError({ code: "BAD_REQUEST", message });
}

async function audit(
  db: Db,
  organizationId: string,
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
    organizationId,
    siteId: null,
    actorUserId: userId,
    action: args.action,
    entityType: "statutory_deposit",
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

const sum = <T>(rows: readonly T[], pick: (row: T) => string | bigint | null) =>
  rows.reduce((total, row) => total + BigInt(pick(row) ?? 0), 0n);

/** Every due for the company: payroll (by pay month) and contractor TDS (by bill month). */
export async function companyDues(db: Db, organizationId: string): Promise<DueRow[]> {
  const [payroll, subBills] = await Promise.all([
    approvedPayroll(db, organizationId),
    db
      .select({ date: subcontractBills.billDate, tds: subcontractBills.tdsMinor })
      .from(subcontractBills)
      .where(
        and(
          eq(subcontractBills.organizationId, organizationId),
          eq(subcontractBills.status, "Approved"),
        ),
      ),
  ]);
  const dues: DueRow[] = [];
  for (const run of payroll) {
    dues.push({ kind: "PF", period: run.month, amountMinor: BigInt(run.pfDueMinor) });
    dues.push({ kind: "ESI", period: run.month, amountMinor: BigInt(run.esiDueMinor) });
    dues.push({ kind: "PT", period: run.month, amountMinor: BigInt(run.ptDueMinor) });
    dues.push({ kind: "TDS salary", period: run.month, amountMinor: BigInt(run.tdsDueMinor) });
  }
  for (const bill of subBills)
    dues.push({
      kind: "TDS contractor",
      period: bill.date.slice(0, 7),
      amountMinor: BigInt(bill.tds),
    });
  return dues.filter((due) => due.amountMinor > 0n);
}

export async function companyDeposits(db: Db, organizationId: string) {
  return db
    .select()
    .from(statutoryDeposits)
    .where(eq(statutoryDeposits.organizationId, organizationId))
    .orderBy(desc(statutoryDeposits.paidOn), desc(statutoryDeposits.createdAt));
}

/** Dues still open (due or overdue), for the inbox. */
export async function openDues(db: Db, organizationId: string) {
  const [dues, deposits] = await Promise.all([
    companyDues(db, organizationId),
    companyDeposits(db, organizationId),
  ]);
  return duesAgainstDeposits(
    dues,
    deposits
      .filter((row) => row.status === "Recorded")
      .map((row) => ({
        kind: row.kind as DueKind,
        period: row.period,
        amountMinor: BigInt(row.amountMinor),
      })),
    today(),
  ).filter((line) => line.state === "Overdue" || line.state === "Due");
}

const serialiseLine = (line: ReturnType<typeof duesAgainstDeposits>[number]) => ({
  ...line,
  dueMinor: line.dueMinor.toString(),
  depositedMinor: line.depositedMinor.toString(),
  outstandingMinor: line.outstandingMinor.toString(),
});

export const booksRouter = router({
  /** Dues and deposits, GST by month, receivables and payables, client TDS to claim. */
  overview: protectedProcedure.query(async ({ ctx }) => {
    const access = await commercialAccess(ctx.user, "accounts.view");
    const { db, organizationId } = access;
    const since = `${Number(today().slice(0, 4)) - 1}${today().slice(4, 7)}-01`;
    const [dues, deposits, bills, receipts, invoices, allocations] = await Promise.all([
      companyDues(db, organizationId),
      companyDeposits(db, organizationId),
      db
        .select({
          id: clientBills.id,
          date: clientBills.billDate,
          gst: clientBills.gstMinor,
          tds: clientBills.tdsMinor,
          net: clientBills.netReceivableMinor,
        })
        .from(clientBills)
        .where(
          and(eq(clientBills.organizationId, organizationId), eq(clientBills.status, "Approved")),
        ),
      db
        .select({ billId: clientReceipts.billId, amount: clientReceipts.amountMinor })
        .from(clientReceipts)
        .where(
          and(
            eq(clientReceipts.organizationId, organizationId),
            eq(clientReceipts.status, "Recorded"),
          ),
        ),
      db
        .select({
          id: supplierInvoices.id,
          date: supplierInvoices.invoiceDate,
          tax: supplierInvoices.taxMinor,
          total: supplierInvoices.totalMinor,
        })
        .from(supplierInvoices)
        .where(
          and(
            eq(supplierInvoices.organizationId, organizationId),
            eq(supplierInvoices.status, "Approved"),
          ),
        ),
      db
        .select({
          invoiceId: supplierPaymentAllocations.invoiceId,
          amount: supplierPaymentAllocations.amountMinor,
        })
        .from(supplierPaymentAllocations)
        .innerJoin(supplierPayments, eq(supplierPaymentAllocations.paymentId, supplierPayments.id))
        .where(
          and(
            eq(supplierPayments.organizationId, organizationId),
            eq(supplierPayments.status, "Posted"),
          ),
        ),
    ]);
    const recorded = deposits.filter((row) => row.status === "Recorded");
    const lines = duesAgainstDeposits(
      dues,
      recorded.map((row) => ({
        kind: row.kind as DueKind,
        period: row.period,
        amountMinor: BigInt(row.amountMinor),
      })),
      today(),
    );
    const receivable = sum(bills, (b) => b.net) - sum(receipts, (r) => r.amount);
    const payable = sum(invoices, (i) => i.total) - sum(allocations, (a) => a.amount);
    const gst = gstSummary(
      bills.filter((b) => b.date >= since).map((b) => ({ date: b.date, taxMinor: BigInt(b.gst) })),
      invoices
        .filter((i) => i.date >= since)
        .map((i) => ({ date: i.date, taxMinor: BigInt(i.tax) })),
    );
    return {
      dues: lines.map(serialiseLine),
      deposits: deposits.slice(0, 100),
      gst: gst.map((row) => ({
        month: row.month,
        outputMinor: row.outputMinor.toString(),
        inputMinor: row.inputMinor.toString(),
        netMinor: row.netMinor.toString(),
      })),
      receivableMinor: receivable.toString(),
      payableMinor: payable.toString(),
      clientTdsMinor: sum(bills, (b) => b.tds).toString(),
      overdueCount: lines.filter((line) => line.state === "Overdue").length,
      can: { manage: access.can("accounts.manage") },
    };
  }),

  /** Profit per project from approved records; attendance not yet in payroll shown apart. */
  profit: protectedProcedure.query(async ({ ctx }) => {
    const access = await commercialAccess(ctx.user, "accounts.view");
    const { db, organizationId } = access;
    const projectRows = await db
      .select({ id: projects.id, name: projects.name })
      .from(projects)
      .where(eq(projects.organizationId, organizationId));
    const visible = projectRows.filter((p) => access.projectIds.has(p.id));
    const siteRows = await db
      .select({ id: sites.id, projectId: sites.projectId })
      .from(sites)
      .where(eq(sites.organizationId, organizationId));
    const projectOfSite = new Map(siteRows.map((s) => [s.id, s.projectId]));
    const [bills, invoices, runLines, petty, attendance] = await Promise.all([
      db
        .select({ projectId: clientBills.projectId, work: clientBills.workValueMinor })
        .from(clientBills)
        .where(
          and(eq(clientBills.organizationId, organizationId), eq(clientBills.status, "Approved")),
        ),
      db
        .select({
          siteId: supplierInvoices.siteId,
          subtotal: supplierInvoices.subtotalMinor,
          type: vendors.vendorType,
        })
        .from(supplierInvoices)
        .innerJoin(vendors, eq(supplierInvoices.vendorId, vendors.id))
        .where(
          and(
            eq(supplierInvoices.organizationId, organizationId),
            eq(supplierInvoices.status, "Approved"),
          ),
        ),
      db
        .select({
          siteId: payrollRuns.siteId,
          month: payrollRuns.month,
          payType: payrollLines.payType,
          cost: payrollLines.costMinor,
        })
        .from(payrollLines)
        .innerJoin(payrollRuns, eq(payrollLines.runId, payrollRuns.id))
        .where(
          and(
            eq(payrollRuns.organizationId, organizationId),
            inArray(payrollRuns.status, ["Approved", "Paid"]),
          ),
        ),
      db
        .select({ siteId: pettyCashMovements.siteId, amount: pettyCashMovements.amountMinor })
        .from(pettyCashMovements)
        .where(
          and(
            eq(pettyCashMovements.organizationId, organizationId),
            eq(pettyCashMovements.movementType, "Expense"),
            eq(pettyCashMovements.status, "Posted"),
          ),
        ),
      db
        .select({
          siteId: attendanceRecords.siteId,
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
        .innerJoin(
          workerEngagements,
          eq(attendanceRecords.workerEngagementId, workerEngagements.id),
        )
        .where(eq(attendanceRecords.organizationId, organizationId)),
    ]);
    const paidMonths = new Set(runLines.map((row) => `${row.siteId}|${row.month}`));
    type Totals = {
      revenue: bigint;
      costs: Partial<Record<CostHead, bigint>>;
      unpaidLabour: bigint;
    };
    const per = new Map<string, Totals>(
      visible.map((p) => [p.id, { revenue: 0n, costs: {}, unpaidLabour: 0n }]),
    );
    const add = (projectId: string | undefined, head: CostHead, amount: bigint) => {
      const row = projectId ? per.get(projectId) : undefined;
      if (row) row.costs[head] = (row.costs[head] ?? 0n) + amount;
    };
    for (const bill of bills) {
      const row = per.get(bill.projectId);
      if (row) row.revenue += BigInt(bill.work);
    }
    for (const invoice of invoices)
      add(
        projectOfSite.get(invoice.siteId),
        costHeadForSupplier(invoice.type),
        BigInt(invoice.subtotal),
      );
    for (const line of runLines)
      add(
        projectOfSite.get(line.siteId),
        line.payType === "Monthly" ? "Staff" : "Labour",
        BigInt(line.cost),
      );
    for (const move of petty)
      add(projectOfSite.get(move.siteId), "Petty cash", BigInt(move.amount));
    for (const day of attendance) {
      if (day.reviewedBy === null || paidMonths.has(`${day.siteId}|${day.date.slice(0, 7)}`))
        continue;
      const earning = estimateEarning({
        status: day.status as AttendanceStatus,
        rateType: day.rateType as RateType,
        rateMinor: day.rate,
        regularHundredths: parseHours(String(day.regular)) ?? 0n,
        overtimeHundredths: parseHours(String(day.overtime)) ?? 0n,
        overtimeApproved: day.overtimeStatus === "Approved",
      });
      const row = per.get(projectOfSite.get(day.siteId) ?? "");
      if (row && earning.kind === "amount") row.unpaidLabour += earning.minor;
    }
    return visible
      .map((project) => {
        const totals = per.get(project.id)!;
        const pnl = projectPnl(totals.revenue, totals.costs);
        return {
          projectId: project.id,
          name: project.name,
          revenueMinor: pnl.revenueMinor.toString(),
          costs: Object.fromEntries(
            Object.entries(pnl.costs).map(([k, v]) => [k, v.toString()]),
          ) as Record<CostHead, string>,
          totalCostMinor: pnl.totalCostMinor.toString(),
          profitMinor: pnl.profitMinor.toString(),
          marginBps: pnl.marginBps,
          labourNotInPayrollMinor: totals.unpaidLabour.toString(),
        };
      })
      .sort((a, b) => a.name.localeCompare(b.name));
  }),

  recordDeposit: protectedProcedure
    .input(
      z.object({
        kind: z.enum(DUE_KINDS),
        period: z.string().trim(),
        amountRupees: z.string().trim().max(20),
        paidOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use a date like 2026-11-04."),
        challan: z.string().trim().max(80),
        note: z.string().trim().max(1000).nullish(),
        clientMutationId: mutationId,
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const access = await commercialAccess(ctx.user, "accounts.manage");
      const { db, organizationId } = access;
      const prior = await replayed(db, ctx.user.id, input.clientMutationId);
      if (prior) return { id: prior.entityId };
      let amount: bigint;
      try {
        amount = BigInt(parseRupeesToMinor(input.amountRupees));
      } catch {
        bad("Enter the amount in rupees, like 4500 or 4500.50.");
      }
      const problem = checkDeposit({
        amountMinor: amount,
        period: input.period,
        paidOn: input.paidOn,
        challan: input.challan,
        today: today(),
      });
      if (problem) bad(problem.message);
      const id = randomUUID();
      await db.transaction(async (tx) => {
        await tx.insert(statutoryDeposits).values({
          id,
          organizationId,
          kind: input.kind,
          period: input.period,
          amountMinor: amount.toString(),
          paidOn: input.paidOn,
          challanReference: input.challan.trim(),
          note: input.note ?? null,
          status: "Recorded",
          clientMutationId: input.clientMutationId,
          createdBy: ctx.user.id,
        });
        await audit(tx as unknown as Db, organizationId, ctx.user.id, {
          action: "statutory_deposit.record",
          entityId: id,
          clientMutationId: input.clientMutationId,
          after: {
            kind: input.kind,
            period: input.period,
            amountMinor: amount.toString(),
            paidOn: input.paidOn,
            challan: input.challan.trim(),
          },
        });
      });
      return { id };
    }),

  reverseDeposit: protectedProcedure
    .input(
      z.object({
        depositId: z.string().uuid(),
        reason: z.string().trim().max(1000),
        clientMutationId: mutationId,
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const access = await commercialAccess(ctx.user, "accounts.manage");
      const { db, organizationId } = access;
      if (await replayed(db, ctx.user.id, input.clientMutationId)) return { ok: true };
      if (input.reason.length < 3) bad("Give a reason for the reversal.");
      await db.transaction(async (tx) => {
        const [deposit] = await tx
          .select()
          .from(statutoryDeposits)
          .where(eq(statutoryDeposits.id, input.depositId))
          .for("update");
        if (!deposit || deposit.organizationId !== organizationId)
          throw new TRPCError({ code: "NOT_FOUND", message: "Deposit not found." });
        if (deposit.status !== "Recorded") bad("This deposit is already reversed.");
        await tx
          .update(statutoryDeposits)
          .set({
            status: "Reversed",
            reversedBy: ctx.user.id,
            reversedAt: new Date(),
            reverseReason: input.reason,
          })
          .where(eq(statutoryDeposits.id, deposit.id));
        await audit(tx as unknown as Db, organizationId, ctx.user.id, {
          action: "statutory_deposit.reverse",
          entityId: deposit.id,
          clientMutationId: input.clientMutationId,
          before: { status: "Recorded", amountMinor: deposit.amountMinor },
          after: { status: "Reversed" },
          reason: input.reason,
        });
      });
      return { ok: true };
    }),
});
