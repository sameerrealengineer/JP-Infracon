import { and, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import {
  clientBills,
  clientReceipts,
  payrollRuns,
  projects,
  sites,
  supplierInvoices,
  supplierPaymentAllocations,
  supplierPayments,
  vendors,
} from "../../drizzle/schema";
import { expectedDate, forecast, type CashEntry } from "../../lib/jp/cashflow";
import { protectedProcedure, router } from "../_core/trpc";
import { commercialAccess } from "./commercial-access";

function todayIst() {
  return new Date(Date.now() + 330 * 60_000).toISOString().slice(0, 10);
}

/** Last day of a YYYY-MM month. */
function monthEnd(month: string) {
  const [y, m] = month.split("-").map(Number);
  return new Date(Date.UTC(y!, m!, 0)).toISOString().slice(0, 10);
}

/**
 * Cash-flow forecast (`contract.view`, only the person's projects): approved client bills still
 * to be received, approved supplier/subcontract bills still to be paid, approved pay runs not
 * yet paid — by week, overdue first, with an opening cash figure the person enters.
 */
export const cashflowRouter = router({
  forecast: protectedProcedure
    .input(
      z.object({
        days: z.union([z.literal(30), z.literal(60), z.literal(90)]).default(60),
        openingRupees: z
          .string()
          .trim()
          .regex(/^-?\d{0,13}$/)
          .default("0"),
      }),
    )
    .query(async ({ ctx, input }) => {
      const access = await commercialAccess(ctx.user, "contract.view");
      const db = access.db;
      const today = todayIst();
      const projectIds = [...access.projectIds];
      if (!projectIds.length) return { today, ...forecast([], today, input.days), entries: [] };
      const siteRows = await db
        .select({ id: sites.id })
        .from(sites)
        .where(inArray(sites.projectId, projectIds));
      const siteIds = siteRows.map((s) => s.id);
      const none = ["-"];
      const [bills, receipts, invoices, allocations, runs, projectRows] = await Promise.all([
        db
          .select()
          .from(clientBills)
          .where(
            and(inArray(clientBills.projectId, projectIds), eq(clientBills.status, "Approved")),
          ),
        db
          .select({
            billId: clientReceipts.billId,
            amountMinor: clientReceipts.amountMinor,
            status: clientReceipts.status,
          })
          .from(clientReceipts)
          .where(eq(clientReceipts.organizationId, access.organizationId)),
        db
          .select({
            id: supplierInvoices.id,
            total: supplierInvoices.totalMinor,
            invoiceDate: supplierInvoices.invoiceDate,
            dueDate: supplierInvoices.dueDate,
            number: supplierInvoices.invoiceNumber,
            vendor: vendors.legalName,
            terms: vendors.paymentTermsDays,
          })
          .from(supplierInvoices)
          .innerJoin(vendors, eq(supplierInvoices.vendorId, vendors.id))
          .where(
            and(
              inArray(supplierInvoices.siteId, siteIds.length ? siteIds : none),
              eq(supplierInvoices.status, "Approved"),
            ),
          ),
        db
          .select({
            invoiceId: supplierPaymentAllocations.invoiceId,
            amountMinor: supplierPaymentAllocations.amountMinor,
            status: supplierPayments.status,
          })
          .from(supplierPaymentAllocations)
          .innerJoin(
            supplierPayments,
            eq(supplierPaymentAllocations.paymentId, supplierPayments.id),
          )
          .where(inArray(supplierPaymentAllocations.siteId, siteIds.length ? siteIds : none)),
        db
          .select()
          .from(payrollRuns)
          .where(
            and(
              inArray(payrollRuns.siteId, siteIds.length ? siteIds : none),
              eq(payrollRuns.status, "Approved"),
            ),
          )
          .catch(() => []),
        db
          .select({ id: projects.id, name: projects.name })
          .from(projects)
          .where(inArray(projects.id, projectIds)),
      ]);
      const projectName = new Map(projectRows.map((p) => [p.id, p.name]));
      const entries: CashEntry[] = [];
      for (const bill of bills) {
        const received = receipts
          .filter((r) => r.billId === bill.id && r.status === "Recorded")
          .reduce((s, r) => s + BigInt(String(r.amountMinor)), 0n);
        const due = BigInt(String(bill.netReceivableMinor)) - received;
        if (due > 0n)
          entries.push({
            date: expectedDate(null, bill.billDate, 30),
            direction: "in",
            amountMinor: due.toString(),
            kind: "Client bill",
            who: projectName.get(bill.projectId) ?? "",
            reference: bill.billNumber,
          });
      }
      for (const inv of invoices) {
        const paid = allocations
          .filter(
            (a) => a.invoiceId === inv.id && (a.status === "Approved" || a.status === "Posted"),
          )
          .reduce((s, a) => s + BigInt(String(a.amountMinor)), 0n);
        const due = BigInt(String(inv.total)) - paid;
        if (due > 0n)
          entries.push({
            date: expectedDate(inv.dueDate, inv.invoiceDate, inv.terms ?? 30),
            direction: "out",
            amountMinor: due.toString(),
            kind: "Supplier bill",
            who: inv.vendor,
            reference: inv.number,
          });
      }
      for (const run of runs)
        entries.push({
          date: expectedDate(null, monthEnd(run.month), 7),
          direction: "out",
          amountMinor: String(run.netMinor),
          kind: "Wages",
          who: run.month,
          reference: run.month,
        });
      entries.sort((a, b) => a.date.localeCompare(b.date));
      const opening =
        BigInt(
          input.openingRupees === "" || input.openingRupees === "-" ? "0" : input.openingRupees,
        ) * 100n;
      return {
        today,
        ...forecast(entries, today, input.days, opening),
        entries: entries.slice(0, 60),
      };
    }),
});
