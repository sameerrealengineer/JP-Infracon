import { randomUUID } from "node:crypto";
import { and, asc, desc, eq, gte, inArray, lte, ne, or, type SQL } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import {
  auditEvents,
  dailyReports,
  inventoryMovements,
  materialItems,
  materialRequestItems,
  materialRequests,
  organizations,
  pettyCashFunds,
  pettyCashMovements,
  siteIssues,
  sites,
  supplierInvoices,
  supplierPayments,
  users,
  vendors,
  workTasks,
} from "../../drizzle/schema";
import { protectedProcedure, router } from "../_core/trpc";
import { getDb } from "../db";
import { assertActiveAccount, getAccessibleSites } from "./access";
import { siteCapabilities, sitesWithPermission, type PermissionKey } from "./capabilities";
import { buildCsv, exportFileName, paiseToDecimal, type CsvValue } from "../../lib/jp/csv";

export const exportKinds = [
  "daily_reports",
  "material_requests",
  "stock_movements",
  "tasks",
  "issues",
  "supplier_invoices",
  "supplier_payments",
  "petty_cash",
  "audit",
] as const;
type ExportKind = (typeof exportKinds)[number];

const MAX_ROWS = 5000;

const permissionFor: Record<ExportKind, PermissionKey> = {
  daily_reports: "dpr.view",
  material_requests: "material.request.view",
  stock_movements: "inventory.view",
  tasks: "task.view",
  issues: "issue.view",
  supplier_invoices: "finance.invoice.view",
  supplier_payments: "finance.payment.view",
  petty_cash: "finance.cash.view",
  audit: "audit.view",
};

export const exportLabels: Record<ExportKind, string> = {
  daily_reports: "Daily reports (DPR/DLR)",
  material_requests: "Material requests",
  stock_movements: "Stock movements",
  tasks: "Tasks & schedule",
  issues: "Safety & quality issues",
  supplier_invoices: "Supplier invoices",
  supplier_payments: "Supplier payments",
  petty_cash: "Petty cash ledger",
  audit: "Audit trail",
};

function requireDb(db: Awaited<ReturnType<typeof getDb>>) {
  if (!db)
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message: "The business data service is temporarily unavailable.",
    });
  return db;
}

const dateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD.");

export const exportsRouter = router({
  /** Which exports the caller may run, and for which sites. */
  options: protectedProcedure.query(async ({ ctx }) => {
    assertActiveAccount(ctx.user);
    const capabilities = await siteCapabilities(ctx.user, await getAccessibleSites(ctx.user));
    const all = capabilities.map((row) => row.siteId);
    return exportKinds
      .map((kind) => ({
        kind,
        label: exportLabels[kind],
        siteIds:
          kind === "daily_reports"
            ? [
                ...new Set([
                  ...sitesWithPermission(capabilities, all, "dpr.view"),
                  ...sitesWithPermission(capabilities, all, "dlr.view"),
                ]),
              ]
            : sitesWithPermission(capabilities, all, permissionFor[kind]),
      }))
      .filter((option) => option.siteIds.length > 0);
  }),

  generate: protectedProcedure
    .input(
      z.object({
        kind: z.enum(exportKinds),
        siteId: z.string().uuid().optional(),
        from: dateSchema,
        to: dateSchema,
      }),
    )
    .mutation(async ({ ctx, input }) => {
      assertActiveAccount(ctx.user);
      if (input.to < input.from)
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "The end date is before the start date.",
        });
      const db = requireDb(await getDb());
      const accessible = await getAccessibleSites(ctx.user);
      const capabilities = await siteCapabilities(ctx.user, accessible);
      const all = capabilities.map((row) => row.siteId);
      const candidate = input.siteId ? [input.siteId] : all;
      const allowed = (key: PermissionKey) => sitesWithPermission(capabilities, candidate, key);
      const siteIds =
        input.kind === "daily_reports"
          ? [...new Set([...allowed("dpr.view"), ...allowed("dlr.view")])]
          : allowed(permissionFor[input.kind]);
      if (!siteIds.length)
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "You cannot export this data for the chosen site.",
        });

      const fromDate = new Date(`${input.from}T00:00:00.000Z`);
      const toDate = new Date(`${input.to}T23:59:59.999Z`);
      let header: string[] = [];
      let rows: CsvValue[][] = [];

      switch (input.kind) {
        case "daily_reports": {
          const dpr = allowed("dpr.view");
          const dlr = allowed("dlr.view");
          const kinds = [
            dpr.length
              ? and(eq(dailyReports.reportKind, "DPR"), inArray(dailyReports.siteId, dpr))
              : undefined,
            dlr.length
              ? and(eq(dailyReports.reportKind, "DLR"), inArray(dailyReports.siteId, dlr))
              : undefined,
          ].filter(Boolean) as SQL[];
          const data = await db
            .select({
              site: sites.name,
              kind: dailyReports.reportKind,
              date: dailyReports.reportDate,
              shift: dailyReports.shiftCode,
              title: dailyReports.title,
              status: dailyReports.status,
              revision: dailyReports.revisionNumber,
              weather: dailyReports.weatherCode,
              remarks: dailyReports.remarks,
              nextDay: dailyReports.nextDayPlan,
              by: users.name,
              submittedAt: dailyReports.submittedAt,
              reviewedAt: dailyReports.reviewedAt,
              returnReason: dailyReports.returnReason,
            })
            .from(dailyReports)
            .innerJoin(sites, eq(dailyReports.siteId, sites.id))
            .innerJoin(users, eq(dailyReports.createdBy, users.id))
            .where(
              and(
                or(...kinds),
                gte(dailyReports.reportDate, input.from),
                lte(dailyReports.reportDate, input.to),
              ),
            )
            .orderBy(asc(dailyReports.reportDate))
            .limit(MAX_ROWS + 1);
          header = [
            "Site",
            "Type",
            "Date",
            "Shift",
            "Title",
            "Status",
            "Revision",
            "Weather",
            "Remarks",
            "Next day plan",
            "Created by",
            "Submitted at",
            "Reviewed at",
            "Return reason",
          ];
          rows = data.map((r) => [
            r.site,
            r.kind,
            r.date,
            r.shift,
            r.title,
            r.status,
            r.revision,
            r.weather,
            r.remarks,
            r.nextDay,
            r.by,
            r.submittedAt,
            r.reviewedAt,
            r.returnReason,
          ]);
          break;
        }
        case "material_requests": {
          const data = await db
            .select({
              site: sites.name,
              requestedAt: materialRequests.createdAt,
              requiredBy: materialRequests.requiredBy,
              status: materialRequests.status,
              item: materialRequestItems.itemNameSnapshot,
              requested: materialRequestItems.requestedQuantity,
              approved: materialRequestItems.approvedQuantity,
              unit: materialRequestItems.unitCode,
              purpose: materialRequests.purpose,
              by: users.name,
              note: materialRequests.approvalNote,
            })
            .from(materialRequests)
            .innerJoin(sites, eq(materialRequests.siteId, sites.id))
            .innerJoin(users, eq(materialRequests.requestedBy, users.id))
            .innerJoin(
              materialRequestItems,
              eq(materialRequestItems.requestId, materialRequests.id),
            )
            .where(
              and(
                inArray(materialRequests.siteId, siteIds),
                gte(materialRequests.createdAt, fromDate),
                lte(materialRequests.createdAt, toDate),
              ),
            )
            .orderBy(asc(materialRequests.createdAt))
            .limit(MAX_ROWS + 1);
          header = [
            "Site",
            "Requested at",
            "Required by",
            "Status",
            "Item",
            "Requested qty",
            "Approved qty",
            "Unit",
            "Purpose",
            "Requested by",
            "Decision note",
          ];
          rows = data.map((r) => [
            r.site,
            r.requestedAt,
            r.requiredBy,
            r.status,
            r.item,
            r.requested,
            r.approved,
            r.unit,
            r.purpose,
            r.by,
            r.note,
          ]);
          break;
        }
        case "stock_movements": {
          const data = await db
            .select({
              site: sites.name,
              at: inventoryMovements.createdAt,
              itemCode: materialItems.itemCode,
              item: materialItems.name,
              type: inventoryMovements.movementType,
              direction: inventoryMovements.direction,
              quantity: inventoryMovements.quantity,
              unit: inventoryMovements.unitCode,
              status: inventoryMovements.status,
              reference: inventoryMovements.sourceReference,
              reason: inventoryMovements.reason,
              by: users.name,
              postedAt: inventoryMovements.postedAt,
            })
            .from(inventoryMovements)
            .innerJoin(sites, eq(inventoryMovements.siteId, sites.id))
            .innerJoin(materialItems, eq(inventoryMovements.materialItemId, materialItems.id))
            .innerJoin(users, eq(inventoryMovements.createdBy, users.id))
            .where(
              and(
                inArray(inventoryMovements.siteId, siteIds),
                gte(inventoryMovements.createdAt, fromDate),
                lte(inventoryMovements.createdAt, toDate),
              ),
            )
            .orderBy(asc(inventoryMovements.createdAt))
            .limit(MAX_ROWS + 1);
          header = [
            "Site",
            "Recorded at",
            "Item code",
            "Item",
            "Movement",
            "Direction",
            "Quantity",
            "Unit",
            "Status",
            "Reference",
            "Reason",
            "Recorded by",
            "Posted at",
          ];
          rows = data.map((r) => [
            r.site,
            r.at,
            r.itemCode,
            r.item,
            r.type,
            r.direction,
            r.quantity,
            r.unit,
            r.status,
            r.reference,
            r.reason,
            r.by,
            r.postedAt,
          ]);
          break;
        }
        case "tasks": {
          const data = await db
            .select({
              site: sites.name,
              code: workTasks.taskCode,
              title: workTasks.title,
              category: workTasks.workCategory,
              location: workTasks.locationLabel,
              start: workTasks.plannedStart,
              end: workTasks.plannedEnd,
              priority: workTasks.priority,
              status: workTasks.status,
              revision: workTasks.scheduleRevision,
              hold: workTasks.holdReason,
            })
            .from(workTasks)
            .innerJoin(sites, eq(workTasks.siteId, sites.id))
            .where(
              and(
                inArray(workTasks.siteId, siteIds),
                lte(workTasks.plannedStart, input.to),
                gte(workTasks.plannedEnd, input.from),
              ),
            )
            .orderBy(asc(workTasks.plannedStart))
            .limit(MAX_ROWS + 1);
          const today = new Date().toISOString().slice(0, 10);
          header = [
            "Site",
            "Task code",
            "Title",
            "Category",
            "Location",
            "Planned start",
            "Planned end",
            "Priority",
            "Status",
            "Schedule revision",
            "Delayed",
            "Hold reason",
          ];
          rows = data.map((r) => [
            r.site,
            r.code,
            r.title,
            r.category,
            r.location,
            r.start,
            r.end,
            r.priority,
            r.status,
            r.revision,
            r.end < today && !["Completed", "Cancelled"].includes(r.status) ? "Yes" : "No",
            r.hold,
          ]);
          break;
        }
        case "issues": {
          const data = await db
            .select({
              site: sites.name,
              code: siteIssues.issueCode,
              category: siteIssues.category,
              severity: siteIssues.severity,
              title: siteIssues.title,
              status: siteIssues.status,
              stopWork: siteIssues.stopWork,
              observedAt: siteIssues.observedAt,
              location: siteIssues.locationLabel,
              owner: siteIssues.ownerNameSnapshot,
              target: siteIssues.targetDate,
              corrective: siteIssues.correctiveAction,
              preventive: siteIssues.preventiveAction,
              resolvedAt: siteIssues.resolvedAt,
              closedAt: siteIssues.closedAt,
              reopened: siteIssues.reopenCount,
            })
            .from(siteIssues)
            .innerJoin(sites, eq(siteIssues.siteId, sites.id))
            .where(
              and(
                inArray(siteIssues.siteId, siteIds),
                gte(siteIssues.observedAt, fromDate),
                lte(siteIssues.observedAt, toDate),
              ),
            )
            .orderBy(asc(siteIssues.observedAt))
            .limit(MAX_ROWS + 1);
          header = [
            "Site",
            "Issue",
            "Type",
            "Severity",
            "Title",
            "Status",
            "Stop work",
            "Observed at",
            "Location",
            "Owner",
            "Target date",
            "Corrective action",
            "Preventive action",
            "Resolved at",
            "Closed at",
            "Times reopened",
          ];
          rows = data.map((r) => [
            r.site,
            r.code,
            r.category,
            r.severity,
            r.title,
            r.status,
            r.stopWork,
            r.observedAt,
            r.location,
            r.owner,
            r.target,
            r.corrective,
            r.preventive,
            r.resolvedAt,
            r.closedAt,
            r.reopened,
          ]);
          break;
        }
        case "supplier_invoices": {
          const data = await db
            .select({
              site: sites.name,
              vendor: vendors.legalName,
              number: supplierInvoices.invoiceNumber,
              date: supplierInvoices.invoiceDate,
              due: supplierInvoices.dueDate,
              subtotal: supplierInvoices.subtotalMinor,
              tax: supplierInvoices.taxMinor,
              charges: supplierInvoices.chargesMinor,
              total: supplierInvoices.totalMinor,
              status: supplierInvoices.status,
              purchaseRef: supplierInvoices.purchaseReference,
              receiptRef: supplierInvoices.receiptReference,
              reviewReason: supplierInvoices.reviewReason,
            })
            .from(supplierInvoices)
            .innerJoin(sites, eq(supplierInvoices.siteId, sites.id))
            .innerJoin(vendors, eq(supplierInvoices.vendorId, vendors.id))
            .where(
              and(
                inArray(supplierInvoices.siteId, siteIds),
                gte(supplierInvoices.invoiceDate, input.from),
                lte(supplierInvoices.invoiceDate, input.to),
              ),
            )
            .orderBy(asc(supplierInvoices.invoiceDate))
            .limit(MAX_ROWS + 1);
          header = [
            "Site",
            "Supplier",
            "Invoice no.",
            "Invoice date",
            "Due date",
            "Subtotal (INR)",
            "Tax (INR)",
            "Charges (INR)",
            "Total (INR)",
            "Status",
            "Purchase ref",
            "Receipt ref",
            "Review note",
          ];
          rows = data.map((r) => [
            r.site,
            r.vendor,
            r.number,
            r.date,
            r.due,
            paiseToDecimal(r.subtotal),
            paiseToDecimal(r.tax),
            paiseToDecimal(r.charges),
            paiseToDecimal(r.total),
            r.status,
            r.purchaseRef,
            r.receiptRef,
            r.reviewReason,
          ]);
          break;
        }
        case "supplier_payments": {
          const data = await db
            .select({
              site: sites.name,
              vendor: vendors.legalName,
              date: supplierPayments.paymentDate,
              amount: supplierPayments.amountMinor,
              mode: supplierPayments.paymentMode,
              beneficiary: supplierPayments.beneficiaryNameSnapshot,
              paidBy: supplierPayments.paidByName,
              source: supplierPayments.fundingSourceLabel,
              category: supplierPayments.category,
              purpose: supplierPayments.purpose,
              reference: supplierPayments.externalReference,
              status: supplierPayments.status,
              postedAt: supplierPayments.postedAt,
            })
            .from(supplierPayments)
            .innerJoin(sites, eq(supplierPayments.siteId, sites.id))
            .innerJoin(vendors, eq(supplierPayments.vendorId, vendors.id))
            .where(
              and(
                inArray(supplierPayments.siteId, siteIds),
                gte(supplierPayments.paymentDate, input.from),
                lte(supplierPayments.paymentDate, input.to),
              ),
            )
            .orderBy(asc(supplierPayments.paymentDate))
            .limit(MAX_ROWS + 1);
          header = [
            "Site",
            "Supplier",
            "Payment date",
            "Amount (INR)",
            "Mode",
            "Beneficiary",
            "Paid by",
            "Funding source",
            "Category",
            "Purpose",
            "External reference",
            "Status",
            "Posted at",
          ];
          rows = data.map((r) => [
            r.site,
            r.vendor,
            r.date,
            paiseToDecimal(r.amount),
            r.mode,
            r.beneficiary,
            r.paidBy,
            r.source,
            r.category,
            r.purpose,
            r.reference,
            r.status,
            r.postedAt,
          ]);
          break;
        }
        case "petty_cash": {
          const data = await db
            .select({
              site: sites.name,
              fund: pettyCashFunds.name,
              date: pettyCashMovements.movementDate,
              type: pettyCashMovements.movementType,
              amount: pettyCashMovements.amountMinor,
              mode: pettyCashMovements.paymentMode,
              payee: pettyCashMovements.payeeName,
              paidBy: pettyCashMovements.paidByName,
              category: pettyCashMovements.category,
              purpose: pettyCashMovements.purpose,
              task: pettyCashMovements.taskCodeSnapshot,
              receipt: pettyCashMovements.receiptReference,
              noReceipt: pettyCashMovements.receiptMissingReason,
              status: pettyCashMovements.status,
              postedAt: pettyCashMovements.postedAt,
            })
            .from(pettyCashMovements)
            .innerJoin(sites, eq(pettyCashMovements.siteId, sites.id))
            .innerJoin(pettyCashFunds, eq(pettyCashMovements.fundId, pettyCashFunds.id))
            .where(
              and(
                inArray(pettyCashMovements.siteId, siteIds),
                gte(pettyCashMovements.movementDate, input.from),
                lte(pettyCashMovements.movementDate, input.to),
              ),
            )
            .orderBy(asc(pettyCashMovements.movementDate))
            .limit(MAX_ROWS + 1);
          header = [
            "Site",
            "Fund",
            "Date",
            "Type",
            "Amount (INR)",
            "Mode",
            "Payee",
            "Paid by",
            "Category",
            "Purpose",
            "Task",
            "Receipt ref",
            "No-receipt reason",
            "Status",
            "Posted at",
          ];
          rows = data.map((r) => [
            r.site,
            r.fund,
            r.date,
            r.type,
            paiseToDecimal(r.amount),
            r.mode,
            r.payee,
            r.paidBy,
            r.category,
            r.purpose,
            r.task,
            r.receipt,
            r.noReceipt,
            r.status,
            r.postedAt,
          ]);
          break;
        }
        case "audit": {
          // Sensitive record types are only exported to people who can see those records.
          const gated: [string[], PermissionKey][] = [
            [["worker_engagement"], "compensation.view"],
            [["person"], "workforce.kyc.view"],
            [["supplier_invoice", "vendor"], "finance.invoice.view"],
            [["supplier_payment"], "finance.payment.view"],
            [["petty_cash_fund", "petty_cash_movement"], "finance.cash.view"],
          ];
          const gates = gated.map(([types, key]) => {
            const visible = allowed(key);
            const notType = and(...types.map((type) => ne(auditEvents.entityType, type)))!;
            return visible.length ? or(notType, inArray(auditEvents.siteId, visible))! : notType;
          });
          const data = await db
            .select({
              site: sites.name,
              at: auditEvents.occurredAt,
              actor: users.name,
              action: auditEvents.action,
              entity: auditEvents.entityType,
              reason: auditEvents.reason,
            })
            .from(auditEvents)
            .innerJoin(users, eq(auditEvents.actorUserId, users.id))
            .innerJoin(sites, eq(auditEvents.siteId, sites.id))
            .where(
              and(
                inArray(auditEvents.siteId, siteIds),
                gte(auditEvents.occurredAt, fromDate),
                lte(auditEvents.occurredAt, toDate),
                ...gates,
              ),
            )
            .orderBy(desc(auditEvents.occurredAt))
            .limit(MAX_ROWS + 1);
          header = ["Site", "When", "Who", "Action", "Record type", "Reason"];
          rows = data.map((r) => [r.site, r.at, r.actor, r.action, r.entity, r.reason]);
          break;
        }
      }

      const truncated = rows.length > MAX_ROWS;
      if (truncated) rows = rows.slice(0, MAX_ROWS);
      const generatedAt = new Date();
      const siteNames = accessible
        .filter((site) => siteIds.includes(site.id))
        .map((site) => site.name);
      const orgIds = [
        ...new Set(
          accessible.filter((site) => siteIds.includes(site.id)).map((site) => site.organizationId),
        ),
      ];
      const orgs = orgIds.length
        ? await db
            .select({ name: organizations.name })
            .from(organizations)
            .where(inArray(organizations.id, orgIds))
        : [];
      const csv = buildCsv(
        {
          Report: exportLabels[input.kind],
          Organisation: orgs.map((org) => org.name).join(", "),
          Sites: siteNames.join(", "),
          Period: `${input.from} to ${input.to}`,
          Generated: generatedAt.toISOString(),
          "Generated by": ctx.user.name ?? `User ${ctx.user.id}`,
          Rows: String(rows.length),
          Continuation: truncated
            ? `Limited to the first ${MAX_ROWS} rows. Export a shorter period to get the rest.`
            : "Complete for this period",
        },
        header,
        rows,
      );
      await db.insert(auditEvents).values({
        id: randomUUID(),
        organizationId: orgIds[0] ?? accessible[0].organizationId,
        siteId: input.siteId ?? null,
        actorUserId: ctx.user.id,
        action: "export.generated",
        entityType: "export",
        entityId: randomUUID(),
        afterSummary: JSON.stringify({
          kind: input.kind,
          from: input.from,
          to: input.to,
          rows: rows.length,
          truncated,
        }),
      });
      return {
        fileName: exportFileName(input.kind, generatedAt),
        csv,
        rowCount: rows.length,
        truncated,
        generatedAt: generatedAt.toISOString(),
      };
    }),
});
