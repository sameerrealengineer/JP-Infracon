import { and, asc, eq, inArray, lt, ne, notInArray } from "drizzle-orm";
import {
  dailyReports,
  inventoryMovements,
  materialItems,
  materialRequests,
  pettyCashFunds,
  pettyCashMovements,
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
  if (!allSiteIds.length) return { items, asOf: new Date().toISOString() };
  const today = new Date().toISOString().slice(0, 10);

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
        inArray(dailyReports.siteId, allSiteIds),
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

  return { items: sortInbox(items), asOf: new Date().toISOString() };
}
