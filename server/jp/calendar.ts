import { and, gte, inArray, lte, ne } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { supplierInvoices, warranties, workOrders, workTasks } from "../../drizzle/schema";
import { protectedProcedure, router } from "../_core/trpc";
import { getDb } from "../db";
import { getAccessibleSites } from "./access";
import { siteCapabilities } from "./capabilities";

export type CalendarEvent = {
  date: string;
  kind: "task_start" | "task_due" | "bill_due" | "warranty_end" | "work_order_end";
  title: string;
  siteId: string;
  siteName: string;
  route: string;
  done: boolean;
};

const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

/**
 * One calendar for everything with a date: task starts and due dates, supplier bills due,
 * warranties ending and work orders ending, each only where the person may see it.
 */
export const calendarRouter = router({
  range: protectedProcedure
    .input(z.object({ from: date, to: date }))
    .query(async ({ ctx, input }) => {
      if (input.to < input.from)
        throw new TRPCError({ code: "BAD_REQUEST", message: "The end is before the start." });
      const db = await getDb();
      if (!db)
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message: "The business data service is temporarily unavailable.",
        });
      const accessible = await getAccessibleSites(ctx.user);
      const capabilities = await siteCapabilities(ctx.user, accessible);
      const with_ = (key: string) =>
        capabilities
          .filter((row) => (row as Record<string, unknown>)[key] === true)
          .map((row) => row.siteId);
      const names = new Map(accessible.map((site) => [site.id, site.name]));
      const events: CalendarEvent[] = [];
      const { from, to } = input;

      const taskSites = with_("task.view");
      if (taskSites.length) {
        const rows = await db
          .select()
          .from(workTasks)
          .where(
            and(
              inArray(workTasks.siteId, taskSites),
              lte(workTasks.plannedStart, to),
              gte(workTasks.plannedEnd, from),
            ),
          )
          .limit(1000);
        for (const task of rows) {
          const base = {
            siteId: task.siteId,
            siteName: names.get(task.siteId) ?? "",
            route: `/schedule?siteId=${task.siteId}`,
            done: task.status === "Completed",
          };
          if (task.plannedStart >= from && task.plannedStart <= to)
            events.push({
              ...base,
              date: task.plannedStart,
              kind: "task_start",
              title: task.title,
            });
          if (task.plannedEnd >= from && task.plannedEnd <= to)
            events.push({ ...base, date: task.plannedEnd, kind: "task_due", title: task.title });
        }
      }

      const billSites = with_("finance.invoice.view");
      if (billSites.length) {
        const rows = await db
          .select()
          .from(supplierInvoices)
          .where(
            and(
              inArray(supplierInvoices.siteId, billSites),
              gte(supplierInvoices.dueDate, from),
              lte(supplierInvoices.dueDate, to),
              ne(supplierInvoices.status, "Rejected"),
            ),
          )
          .limit(500);
        for (const bill of rows)
          if (bill.dueDate)
            events.push({
              date: bill.dueDate,
              kind: "bill_due",
              title: `Bill ${bill.invoiceNumber} due`,
              siteId: bill.siteId,
              siteName: names.get(bill.siteId) ?? "",
              route: `/finance?siteId=${bill.siteId}`,
              done: false,
            });
      }

      const documentSites = with_("document.view");
      if (documentSites.length) {
        const rows = await db
          .select()
          .from(warranties)
          .where(
            and(
              inArray(warranties.siteId, documentSites),
              gte(warranties.endDate, from),
              lte(warranties.endDate, to),
            ),
          )
          .limit(500)
          .catch(() => []);
        for (const warranty of rows)
          events.push({
            date: warranty.endDate,
            kind: "warranty_end",
            title: `Warranty ends: ${warranty.itemName}`,
            siteId: warranty.siteId,
            siteName: names.get(warranty.siteId) ?? "",
            route: "/warranties",
            done: warranty.status === "Closed",
          });
      }

      const woSites = with_("subcontract.view");
      if (woSites.length) {
        const rows = await db
          .select()
          .from(workOrders)
          .where(
            and(
              inArray(workOrders.siteId, woSites),
              gte(workOrders.endDate, from),
              lte(workOrders.endDate, to),
              inArray(workOrders.status, ["Approved", "Closed"]),
            ),
          )
          .limit(500);
        for (const wo of rows)
          if (wo.endDate)
            events.push({
              date: wo.endDate,
              kind: "work_order_end",
              title: `${wo.woNumber} ends: ${wo.title}`,
              siteId: wo.siteId,
              siteName: names.get(wo.siteId) ?? "",
              route: `/subcontract?siteId=${wo.siteId}`,
              done: wo.status === "Closed",
            });
      }
      events.sort((a, b) => a.date.localeCompare(b.date) || a.kind.localeCompare(b.kind));
      return events;
    }),
});
