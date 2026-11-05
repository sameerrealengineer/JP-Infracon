import { and, asc, eq, inArray, isNull, lt, ne, notInArray, or } from "drizzle-orm";
import {
  dailyReports,
  inventoryMovements,
  materialItems,
  materialRequests,
  pettyCashFunds,
  pettyCashMovements,
  purchaseOrders,
  subcontractBills,
  workMeasurements,
  workOrders,
  siteIssues,
  sites,
  supplierInvoices,
  supplierPayments,
  vendors,
  workTasks,
} from "../../drizzle/schema";
import type { getDb } from "../db";
import { formatMinorAsRupees } from "../../lib/jp/finance-domain";
import { sortInbox, type InboxItem } from "../../lib/jp/site-admin-policy";

type Db = NonNullable<Awaited<ReturnType<typeof getDb>>>;
type Capability = { siteId: string } & Partial<Record<string, boolean | string>>;

const LIMIT = 25;

function sitesWith(capabilities: Capability[], key: string) {
  return capabilities
    .filter((capability) => capability[key] === true)
    .map((capability) => capability.siteId);
}
function iso(value: Date | string | null | undefined) {
  if (!value) return new Date(0).toISOString();
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

/**
 * Work waiting on the caller, derived live from persisted records in their authorised scope.
 * Nothing here is stored: opening an item always rechecks access on its own screen.
 */
export async function buildInbox(db: Db, userId: number, capabilities: Capability[]) {
  const items: InboxItem[] = [];
  const allSiteIds = capabilities.map((capability) => capability.siteId);
  if (!allSiteIds.length)
    return { items, unavailable: [] as string[], asOf: new Date().toISOString() };
  const today = new Date().toISOString().slice(0, 10);

  const unavailable: string[] = [];
  // Each section is independent: a table that is not migrated yet must not hide the others.
  const guard = async (name: string, run: () => Promise<void>) => {
    try {
      await run();
    } catch {
      unavailable.push(name);
    }
  };
  await guard("reports", async () => {
    const dprReview = sitesWith(capabilities, "dpr.review");
    const dlrReview = sitesWith(capabilities, "dlr.review");
    for (const [kind, siteIds] of [
      ["DPR", dprReview],
      ["DLR", dlrReview],
    ] as const) {
      if (!siteIds.length) continue;
      const rows = await db
        .select({
          id: dailyReports.id,
          title: dailyReports.title,
          reportDate: dailyReports.reportDate,
          siteId: dailyReports.siteId,
          siteName: sites.name,
          at: dailyReports.updatedAt,
        })
        .from(dailyReports)
        .innerJoin(sites, eq(dailyReports.siteId, sites.id))
        .where(
          and(
            eq(dailyReports.reportKind, kind),
            inArray(dailyReports.siteId, siteIds),
            inArray(dailyReports.status, ["Submitted", "Under Review"]),
            ne(dailyReports.createdBy, userId),
          ),
        )
        .orderBy(asc(dailyReports.updatedAt))
        .limit(LIMIT);
      for (const row of rows)
        items.push({
          id: `report-review-${row.id}`,
          kind: "report.review",
          title: `${kind} awaiting your review`,
          detail: `${row.title} · ${row.reportDate}`,
          siteId: row.siteId,
          siteName: row.siteName,
          occurredAt: iso(row.at),
          route: "/(tabs)/reports",
          severity: "normal",
        });
    }
  });
  await guard("returned", async () => {
    const reportSites = [
      ...new Set([...sitesWith(capabilities, "dpr.view"), ...sitesWith(capabilities, "dlr.view")]),
    ];
    if (!reportSites.length) return;
    const returned = await db
      .select({
        id: dailyReports.id,
        kind: dailyReports.reportKind,
        title: dailyReports.title,
        reason: dailyReports.returnReason,
        siteId: dailyReports.siteId,
        siteName: sites.name,
        at: dailyReports.updatedAt,
      })
      .from(dailyReports)
      .innerJoin(sites, eq(dailyReports.siteId, sites.id))
      .where(
        and(
          eq(dailyReports.createdBy, userId),
          eq(dailyReports.status, "Returned for Correction"),
          // Only sites where reports are visible, so a turned-off module stays out of the inbox.
          inArray(dailyReports.siteId, reportSites),
        ),
      )
      .limit(LIMIT);
    for (const row of returned)
      items.push({
        id: `report-returned-${row.id}`,
        kind: "report.returned",
        title: `${row.kind} returned for correction`,
        detail: row.reason ? `${row.title} · ${row.reason}` : row.title,
        siteId: row.siteId,
        siteName: row.siteName,
        occurredAt: iso(row.at),
        route: "/(tabs)/reports",
        severity: "high",
      });
  });
  await guard("purchase", async () => {
    const approveSites = sitesWith(capabilities, "purchase.approve");
    if (!approveSites.length) return;
    const rows = await db
      .select({
        id: purchaseOrders.id,
        poNumber: purchaseOrders.poNumber,
        total: purchaseOrders.totalMinor,
        vendorName: vendors.legalName,
        siteId: purchaseOrders.siteId,
        siteName: sites.name,
        at: purchaseOrders.updatedAt,
      })
      .from(purchaseOrders)
      .innerJoin(sites, eq(purchaseOrders.siteId, sites.id))
      .innerJoin(vendors, eq(purchaseOrders.vendorId, vendors.id))
      .where(
        and(
          inArray(purchaseOrders.siteId, approveSites),
          eq(purchaseOrders.status, "Submitted"),
          ne(purchaseOrders.createdBy, userId),
        ),
      )
      .orderBy(asc(purchaseOrders.updatedAt))
      .limit(LIMIT);
    for (const row of rows)
      items.push({
        id: `purchase-${row.id}`,
        kind: "purchase.review",
        title: "Purchase order awaiting approval",
        detail: `${row.poNumber} · ${row.vendorName} · ${formatMinorAsRupees(row.total)}`,
        siteId: row.siteId,
        siteName: row.siteName,
        occurredAt: iso(row.at),
        route: `/po?siteId=${row.siteId}&id=${row.id}`,
        severity: "normal",
      });
  });
  await guard("subcontract", async () => {
    const approveSites = sitesWith(capabilities, "subcontract.approve");
    if (!approveSites.length) return;
    const orders = await db
      .select({
        id: workOrders.id,
        woNumber: workOrders.woNumber,
        title: workOrders.title,
        value: workOrders.valueMinor,
        vendorName: vendors.legalName,
        siteId: workOrders.siteId,
        siteName: sites.name,
        at: workOrders.updatedAt,
      })
      .from(workOrders)
      .innerJoin(sites, eq(workOrders.siteId, sites.id))
      .innerJoin(vendors, eq(workOrders.vendorId, vendors.id))
      .where(
        and(
          inArray(workOrders.siteId, approveSites),
          eq(workOrders.status, "Submitted"),
          ne(workOrders.createdBy, userId),
        ),
      )
      .orderBy(asc(workOrders.updatedAt))
      .limit(LIMIT);
    for (const row of orders)
      items.push({
        id: `wo-${row.id}`,
        kind: "subcontract.review",
        title: "Work order awaiting approval",
        detail: `${row.woNumber} · ${row.vendorName} · ${formatMinorAsRupees(row.value)}`,
        siteId: row.siteId,
        siteName: row.siteName,
        occurredAt: iso(row.at),
        route: `/work-order?siteId=${row.siteId}&id=${row.id}`,
        severity: "normal",
      });
    const bills = await db
      .select({
        id: subcontractBills.id,
        billNumber: subcontractBills.billNumber,
        net: subcontractBills.netPayableMinor,
        workOrderId: subcontractBills.workOrderId,
        siteId: subcontractBills.siteId,
        siteName: sites.name,
        at: subcontractBills.updatedAt,
      })
      .from(subcontractBills)
      .innerJoin(sites, eq(subcontractBills.siteId, sites.id))
      .where(
        and(
          inArray(subcontractBills.siteId, approveSites),
          eq(subcontractBills.status, "Submitted"),
          ne(subcontractBills.createdBy, userId),
        ),
      )
      .orderBy(asc(subcontractBills.updatedAt))
      .limit(LIMIT);
    for (const row of bills)
      items.push({
        id: `sub-bill-${row.id}`,
        kind: "subcontract.review",
        title: "Subcontractor bill awaiting approval",
        detail: `${row.billNumber} · net ${formatMinorAsRupees(row.net)}`,
        siteId: row.siteId,
        siteName: row.siteName,
        occurredAt: iso(row.at),
        route: `/sub-bill?siteId=${row.siteId}&id=${row.id}`,
        severity: "normal",
      });
    const waiting = await db
      .select({
        workOrderId: workMeasurements.workOrderId,
        woNumber: workOrders.woNumber,
        siteId: workMeasurements.siteId,
        siteName: sites.name,
        at: workMeasurements.createdAt,
      })
      .from(workMeasurements)
      .innerJoin(workOrders, eq(workMeasurements.workOrderId, workOrders.id))
      .innerJoin(sites, eq(workMeasurements.siteId, sites.id))
      .where(
        and(
          inArray(workMeasurements.siteId, approveSites),
          eq(workMeasurements.status, "Recorded"),
          ne(workMeasurements.createdBy, userId),
        ),
      )
      .orderBy(asc(workMeasurements.createdAt))
      .limit(200);
    const perOrder = new Map<string, (typeof waiting)[number] & { count: number }>();
    for (const row of waiting) {
      const entry = perOrder.get(row.workOrderId);
      if (entry) entry.count += 1;
      else perOrder.set(row.workOrderId, { ...row, count: 1 });
    }
    for (const row of perOrder.values())
      items.push({
        id: `mb-${row.workOrderId}`,
        kind: "subcontract.check",
        title: "Measurements to check",
        detail: `${row.woNumber} · ${row.count} ${row.count === 1 ? "entry" : "entries"}`,
        siteId: row.siteId,
        siteName: row.siteName,
        occurredAt: iso(row.at),
        route: `/work-order?siteId=${row.siteId}&id=${row.workOrderId}`,
        severity: "normal",
      });
  });
  await guard("material", async () => {
    const materialReview = sitesWith(capabilities, "material.review");
    if (materialReview.length) {
      const rows = await db
        .select({
          id: materialRequests.id,
          purpose: materialRequests.purpose,
          requiredBy: materialRequests.requiredBy,
          siteId: materialRequests.siteId,
          siteName: sites.name,
          at: materialRequests.createdAt,
        })
        .from(materialRequests)
        .innerJoin(sites, eq(materialRequests.siteId, sites.id))
        .where(
          and(
            inArray(materialRequests.siteId, materialReview),
            eq(materialRequests.status, "Submitted"),
            ne(materialRequests.requestedBy, userId),
          ),
        )
        .orderBy(asc(materialRequests.createdAt))
        .limit(LIMIT);
      for (const row of rows)
        items.push({
          id: `material-${row.id}`,
          kind: "material.review",
          title: "Material request awaiting decision",
          detail:
            [row.purpose, row.requiredBy ? `needed by ${row.requiredBy}` : null]
              .filter(Boolean)
              .join(" · ") || "Open the request to review quantities",
          siteId: row.siteId,
          siteName: row.siteName,
          occurredAt: iso(row.at),
          route: "/(tabs)/requests",
          severity: row.requiredBy && row.requiredBy <= today ? "high" : "normal",
        });
    }
  });
  await guard("invoices", async () => {
    const invoiceReview = sitesWith(capabilities, "finance.invoice.review");
    if (invoiceReview.length) {
      const rows = await db
        .select({
          id: supplierInvoices.id,
          number: supplierInvoices.invoiceNumber,
          total: supplierInvoices.totalMinor,
          vendor: vendors.legalName,
          siteId: supplierInvoices.siteId,
          siteName: sites.name,
          at: supplierInvoices.submittedAt,
        })
        .from(supplierInvoices)
        .innerJoin(sites, eq(supplierInvoices.siteId, sites.id))
        .innerJoin(vendors, eq(supplierInvoices.vendorId, vendors.id))
        .where(
          and(
            inArray(supplierInvoices.siteId, invoiceReview),
            eq(supplierInvoices.status, "Submitted"),
            ne(supplierInvoices.submittedBy, userId),
          ),
        )
        .orderBy(asc(supplierInvoices.submittedAt))
        .limit(LIMIT);
      for (const row of rows)
        items.push({
          id: `invoice-${row.id}`,
          kind: "invoice.review",
          title: "Supplier invoice to review",
          detail: `${row.vendor} · ${row.number} · ${formatMinorAsRupees(row.total)}`,
          siteId: row.siteId,
          siteName: row.siteName,
          occurredAt: iso(row.at),
          route: "/finance",
          severity: "normal",
        });
    }
  });
  await guard("payments", async () => {
    for (const [status, key, kind, title] of [
      ["Submitted", "finance.payment.review", "payment.review", "Supplier payment to approve"],
      ["Approved", "finance.payment.post", "payment.post", "Approved payment ready to post"],
    ] as const) {
      const siteIds = sitesWith(capabilities, key);
      if (!siteIds.length) continue;
      const rows = await db
        .select({
          id: supplierPayments.id,
          amount: supplierPayments.amountMinor,
          beneficiary: supplierPayments.beneficiaryNameSnapshot,
          siteId: supplierPayments.siteId,
          siteName: sites.name,
          at: supplierPayments.updatedAt,
        })
        .from(supplierPayments)
        .innerJoin(sites, eq(supplierPayments.siteId, sites.id))
        .where(
          and(
            inArray(supplierPayments.siteId, siteIds),
            eq(supplierPayments.status, status),
            ne(supplierPayments.submittedBy, userId),
          ),
        )
        .orderBy(asc(supplierPayments.updatedAt))
        .limit(LIMIT);
      for (const row of rows)
        items.push({
          id: `${kind}-${row.id}`,
          kind,
          title,
          detail: `${row.beneficiary} · ${formatMinorAsRupees(row.amount)}`,
          siteId: row.siteId,
          siteName: row.siteName,
          occurredAt: iso(row.at),
          route: "/finance",
          severity: "normal",
        });
    }
  });
  await guard("inventory", async () => {
    const inventoryReview = sitesWith(capabilities, "inventory.review");
    if (inventoryReview.length) {
      const rows = await db
        .select({
          id: inventoryMovements.id,
          type: inventoryMovements.movementType,
          quantity: inventoryMovements.quantity,
          unit: inventoryMovements.unitCode,
          item: materialItems.name,
          siteId: inventoryMovements.siteId,
          siteName: sites.name,
          at: inventoryMovements.createdAt,
        })
        .from(inventoryMovements)
        .innerJoin(sites, eq(inventoryMovements.siteId, sites.id))
        .innerJoin(materialItems, eq(inventoryMovements.materialItemId, materialItems.id))
        .where(
          and(
            inArray(inventoryMovements.siteId, inventoryReview),
            eq(inventoryMovements.status, "Submitted"),
            ne(inventoryMovements.createdBy, userId),
          ),
        )
        .orderBy(asc(inventoryMovements.createdAt))
        .limit(LIMIT);
      for (const row of rows)
        items.push({
          id: `inventory-${row.id}`,
          kind: "inventory.review",
          title: `Stock ${row.type.toLowerCase()} to post`,
          detail: `${row.item} · ${row.quantity} ${row.unit}`,
          siteId: row.siteId,
          siteName: row.siteName,
          occurredAt: iso(row.at),
          route: "/inventory",
          severity: "normal",
        });
    }
  });
  await guard("cash", async () => {
    for (const [status, key, kind, title] of [
      ["Submitted", "finance.cash.movement.review", "cash.review", "Petty cash entry to review"],
      ["Approved", "finance.cash.movement.post", "cash.post", "Petty cash entry ready to post"],
    ] as const) {
      const siteIds = sitesWith(capabilities, key);
      if (!siteIds.length) continue;
      const rows = await db
        .select({
          id: pettyCashMovements.id,
          type: pettyCashMovements.movementType,
          amount: pettyCashMovements.amountMinor,
          payee: pettyCashMovements.payeeName,
          siteId: pettyCashMovements.siteId,
          siteName: sites.name,
          at: pettyCashMovements.updatedAt,
        })
        .from(pettyCashMovements)
        .innerJoin(sites, eq(pettyCashMovements.siteId, sites.id))
        .where(
          and(
            inArray(pettyCashMovements.siteId, siteIds),
            eq(pettyCashMovements.status, status),
            ne(pettyCashMovements.submittedBy, userId),
          ),
        )
        .orderBy(asc(pettyCashMovements.updatedAt))
        .limit(LIMIT);
      for (const row of rows)
        items.push({
          id: `${kind}-${row.id}`,
          kind,
          title,
          detail: `${row.type} · ${row.payee} · ${formatMinorAsRupees(row.amount)}`,
          siteId: row.siteId,
          siteName: row.siteName,
          occurredAt: iso(row.at),
          route: "/finance",
          severity: "normal",
        });
    }
  });
  await guard("custody", async () => {
    const cashViewSites = sitesWith(capabilities, "finance.cash.view");
    if (cashViewSites.length) {
      const funds = await db
        .select({
          id: pettyCashFunds.id,
          name: pettyCashFunds.name,
          limit: pettyCashFunds.authorizedLimitMinor,
          siteId: pettyCashFunds.siteId,
          siteName: sites.name,
          at: pettyCashFunds.createdAt,
        })
        .from(pettyCashFunds)
        .innerJoin(sites, eq(pettyCashFunds.siteId, sites.id))
        .where(
          and(
            eq(pettyCashFunds.custodianUserId, userId),
            eq(pettyCashFunds.status, "Pending Custodian"),
            inArray(pettyCashFunds.siteId, cashViewSites),
          ),
        )
        .limit(LIMIT);
      for (const row of funds)
        items.push({
          id: `fund-${row.id}`,
          kind: "cash.acknowledge",
          title: "Acknowledge petty cash custody",
          detail: `${row.name} · limit ${formatMinorAsRupees(row.limit)}`,
          siteId: row.siteId,
          siteName: row.siteName,
          occurredAt: iso(row.at),
          route: "/finance",
          severity: "high",
        });
    }
  });
  await guard("tasks", async () => {
    const taskSites = sitesWith(capabilities, "task.view");
    if (taskSites.length) {
      const rows = await db
        .select({
          id: workTasks.id,
          code: workTasks.taskCode,
          title: workTasks.title,
          plannedEnd: workTasks.plannedEnd,
          siteId: workTasks.siteId,
          siteName: sites.name,
        })
        .from(workTasks)
        .innerJoin(sites, eq(workTasks.siteId, sites.id))
        .where(
          and(
            inArray(workTasks.siteId, taskSites),
            lt(workTasks.plannedEnd, today),
            notInArray(workTasks.status, ["Completed", "Cancelled"]),
          ),
        )
        .orderBy(asc(workTasks.plannedEnd))
        .limit(LIMIT);
      for (const row of rows)
        items.push({
          id: `task-${row.id}`,
          kind: "task.overdue",
          title: "Task past its planned finish",
          detail: `${row.code} · ${row.title} · due ${row.plannedEnd}`,
          siteId: row.siteId,
          siteName: row.siteName,
          occurredAt: `${row.plannedEnd}T00:00:00.000Z`,
          route: "/schedule",
          severity: "high",
        });
    }
  });
  const issueSites = sitesWith(capabilities, "issue.view");
  await guard("issues", async () => {
    if (!issueSites.length) return;
    const rows = await db
      .select({
        id: siteIssues.id,
        code: siteIssues.issueCode,
        title: siteIssues.title,
        severity: siteIssues.severity,
        status: siteIssues.status,
        stopWork: siteIssues.stopWork,
        ownerUserId: siteIssues.ownerUserId,
        resolvedBy: siteIssues.resolvedBy,
        targetDate: siteIssues.targetDate,
        siteId: siteIssues.siteId,
        siteName: sites.name,
        at: siteIssues.observedAt,
      })
      .from(siteIssues)
      .innerJoin(sites, eq(siteIssues.siteId, sites.id))
      .where(
        and(
          inArray(siteIssues.siteId, issueSites),
          inArray(siteIssues.status, ["Open", "In Progress", "Resolved"]),
          or(
            inArray(siteIssues.severity, ["High", "Critical"]),
            eq(siteIssues.ownerUserId, userId),
            eq(siteIssues.status, "Resolved"),
            isNull(siteIssues.ownerUserId),
          ),
        ),
      )
      .orderBy(asc(siteIssues.observedAt))
      .limit(LIMIT * 2);
    const closeSites = new Set(sitesWith(capabilities, "issue.close"));
    const manageSites = new Set(sitesWith(capabilities, "issue.manage"));
    for (const row of rows) {
      const base = {
        siteId: row.siteId,
        siteName: row.siteName,
        occurredAt: iso(row.at),
        route: `/issue/${row.id}`,
      };
      if (row.status === "Resolved") {
        if (closeSites.has(row.siteId) && row.resolvedBy !== userId)
          items.push({
            ...base,
            id: `issue-verify-${row.id}`,
            kind: "issue.verify",
            title: "Resolved issue to verify and close",
            detail: `${row.code} · ${row.title}`,
            severity: "normal",
          });
        continue;
      }
      if (row.ownerUserId === userId)
        items.push({
          ...base,
          id: `issue-mine-${row.id}`,
          kind: "issue.assigned",
          title: "Issue assigned to you",
          detail: `${row.code} · ${row.title}${row.targetDate ? ` · target ${row.targetDate}` : ""}`,
          severity: row.targetDate && row.targetDate < today ? "high" : "normal",
        });
      else if (row.severity === "High" || row.severity === "Critical")
        items.push({
          ...base,
          id: `issue-critical-${row.id}`,
          kind: "issue.critical",
          title: `${row.severity} issue open${row.stopWork === "Yes" ? " · STOP WORK" : ""}`,
          detail: `${row.code} · ${row.title}${row.ownerUserId ? "" : " · no owner yet"}`,
          severity: "high",
        });
      else if (!row.ownerUserId && manageSites.has(row.siteId))
        items.push({
          ...base,
          id: `issue-unassigned-${row.id}`,
          kind: "issue.assigned",
          title: "Issue needs an owner",
          detail: `${row.code} · ${row.title}`,
          severity: "normal",
        });
    }
  });
  return { items: sortInbox(items), unavailable, asOf: new Date().toISOString() };
}
