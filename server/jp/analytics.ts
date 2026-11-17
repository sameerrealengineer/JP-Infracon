import { and, desc, eq, gte, inArray, lte } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import {
  attendanceRecords,
  clientReceipts,
  dailyReportItems,
  dailyReports,
  inventoryMovements,
  materialItems,
  materialRequests,
  people,
  pettyCashFunds,
  pettyCashMovements,
  siteIssues,
  supplierInvoices,
  supplierPaymentAllocations,
  supplierPayments,
  vendors,
  workMeasurements,
  workOrderItems,
  workOrders,
  workTasks,
  workerAdvances,
  workerEngagements,
} from "../../drizzle/schema";
import {
  AGE_BUCKETS,
  addDays,
  ageBucket,
  bucketLabel,
  bucketOf,
  bucketStarts,
  rangeFor,
  seriesByBucket,
  sumMinor,
  topByAmount,
} from "../../lib/jp/analytics";
import { estimateEarning, parseHours } from "../../lib/jp/attendance-domain";
import type { AttendanceStatus, RateType } from "../../lib/jp/attendance-domain";
import { protectedProcedure, router } from "../_core/trpc";
import { getDb } from "../db";
import { getAccessibleSites, getSiteScope } from "./access";
import { siteCapabilities, type SiteCapability } from "./capabilities";
import { buildInbox } from "./inbox";
import { placeCards } from "./places";

function requireDb(db: Awaited<ReturnType<typeof getDb>>) {
  if (!db)
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message: "The business data service is temporarily unavailable.",
    });
  return db;
}

/** India date today. */
function todayIst() {
  return new Date(Date.now() + 330 * 60_000).toISOString().slice(0, 10);
}

const MONEY_SERIES = ["Suppliers", "Petty cash", "Worker advances"] as const;
const LEADERS = ["owner", "director", "admin"];

/**
 * Analytics for the dashboard: money, progress, labour and materials, for one site or all the
 * person's sites, over 7/30/90 days. Every section is computed only from sites where the person
 * holds the matching view permission (null otherwise), so nobody sees more than their screens.
 */
export const analyticsRouter = router({
  overview: protectedProcedure
    .input(
      z.object({
        siteId: z.string().uuid().nullish(),
        days: z.union([z.literal(7), z.literal(30), z.literal(90)]).default(30),
      }),
    )
    .query(async ({ ctx, input }) => {
      const db = requireDb(await getDb());
      const accessible = await getAccessibleSites(ctx.user);
      const chosen = input.siteId
        ? accessible.filter((site) => site.id === input.siteId)
        : accessible;
      if (input.siteId && !chosen.length)
        throw new TRPCError({ code: "FORBIDDEN", message: "This site is outside your access." });
      const caps = await siteCapabilities(ctx.user, chosen);
      const where = (key: keyof SiteCapability) =>
        caps.filter((row) => row[key] === true).map((row) => row.siteId);
      const any = (keys: (keyof SiteCapability)[]) => [
        ...new Set(keys.flatMap((key) => where(key))),
      ];
      const today = todayIst();
      const { from, to } = rangeFor(today, input.days);
      const buckets = bucketStarts(from, to);
      const siteName = new Map(chosen.map((site) => [site.id, site.name]));
      const none = ["-"];
      const ids = (list: string[]) => (list.length ? list : none);

      const paySites = where("finance.payment.view");
      const cashSites = where("finance.cash.view");
      const advanceSites = any(["payroll.view", "payroll.advance"]);
      const invoiceSites = where("finance.invoice.view");
      const attendanceSites = where("attendance.view");
      const wageSites = where("payroll.view");
      const stockSites = where("inventory.view");
      const requestSites = where("material.request.view");
      const taskSites = where("task.view");
      const subSites = where("subcontract.view");
      const dprSites = where("dpr.view");
      const issueSites = where("issue.view");

      const [
        payments,
        cash,
        advances,
        invoices,
        allocations,
        attendance,
        movements,
        items,
        requests,
        orders,
        woItems,
        measures,
        reports,
        issues,
        funds,
        fundMoves,
      ] = await Promise.all([
        db
          .select({
            siteId: supplierPayments.siteId,
            date: supplierPayments.paymentDate,
            amountMinor: supplierPayments.amountMinor,
            who: supplierPayments.beneficiaryNameSnapshot,
            category: supplierPayments.category,
          })
          .from(supplierPayments)
          .where(
            and(
              inArray(supplierPayments.siteId, ids(paySites)),
              gte(supplierPayments.paymentDate, from),
              lte(supplierPayments.paymentDate, to),
              eq(supplierPayments.direction, "Outflow"),
              inArray(supplierPayments.status, ["Approved", "Posted"]),
            ),
          ),
        db
          .select({
            siteId: pettyCashMovements.siteId,
            date: pettyCashMovements.movementDate,
            amountMinor: pettyCashMovements.amountMinor,
            who: pettyCashMovements.payeeName,
            category: pettyCashMovements.category,
          })
          .from(pettyCashMovements)
          .where(
            and(
              inArray(pettyCashMovements.siteId, ids(cashSites)),
              gte(pettyCashMovements.movementDate, from),
              lte(pettyCashMovements.movementDate, to),
              eq(pettyCashMovements.movementType, "Expense"),
              inArray(pettyCashMovements.status, ["Approved", "Posted"]),
            ),
          ),
        db
          .select({
            siteId: workerAdvances.siteId,
            date: workerAdvances.entryDate,
            amountMinor: workerAdvances.amountMinor,
            type: workerAdvances.entryType,
            status: workerAdvances.status,
            who: people.fullName,
          })
          .from(workerAdvances)
          .innerJoin(people, eq(workerAdvances.personId, people.id))
          .where(inArray(workerAdvances.siteId, ids(advanceSites)))
          .catch(() => []),
        db
          .select({
            id: supplierInvoices.id,
            siteId: supplierInvoices.siteId,
            vendor: vendors.legalName,
            invoiceDate: supplierInvoices.invoiceDate,
            dueDate: supplierInvoices.dueDate,
            totalMinor: supplierInvoices.totalMinor,
          })
          .from(supplierInvoices)
          .innerJoin(vendors, eq(supplierInvoices.vendorId, vendors.id))
          .where(
            and(
              inArray(supplierInvoices.siteId, ids(invoiceSites)),
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
          .where(inArray(supplierPaymentAllocations.siteId, ids(invoiceSites))),
        db
          .select({
            siteId: attendanceRecords.siteId,
            date: attendanceRecords.workDate,
            status: attendanceRecords.attendanceStatus,
            regularHours: attendanceRecords.regularHours,
            rateMinor: attendanceRecords.rateSnapshotMinor,
            rateType: workerEngagements.rateType,
            personId: workerEngagements.personId,
            name: people.fullName,
            trade: people.tradeType,
            skill: people.skillCategory,
          })
          .from(attendanceRecords)
          .innerJoin(
            workerEngagements,
            eq(attendanceRecords.workerEngagementId, workerEngagements.id),
          )
          .innerJoin(people, eq(workerEngagements.personId, people.id))
          .where(
            and(
              inArray(attendanceRecords.siteId, ids(attendanceSites)),
              gte(attendanceRecords.workDate, from),
              lte(attendanceRecords.workDate, to),
            ),
          ),
        db
          .select({
            siteId: inventoryMovements.siteId,
            itemId: inventoryMovements.materialItemId,
            direction: inventoryMovements.direction,
            quantity: inventoryMovements.quantity,
            unit: inventoryMovements.unitCode,
            date: inventoryMovements.createdAt,
          })
          .from(inventoryMovements)
          .where(
            and(
              inArray(inventoryMovements.siteId, ids(stockSites)),
              eq(inventoryMovements.status, "Posted"),
            ),
          ),
        stockSites.length
          ? db
              .select({
                id: materialItems.id,
                name: materialItems.name,
                unit: materialItems.baseUnitCode,
                reorder: materialItems.reorderThreshold,
              })
              .from(materialItems)
              .where(
                inArray(materialItems.organizationId, [
                  ...new Set(chosen.map((site) => site.organizationId)),
                ]),
              )
          : Promise.resolve([]),
        db
          .select({ status: materialRequests.status, siteId: materialRequests.siteId })
          .from(materialRequests)
          .where(inArray(materialRequests.siteId, ids(requestSites))),
        db
          .select({
            id: workOrders.id,
            siteId: workOrders.siteId,
            title: workOrders.title,
            status: workOrders.status,
            valueMinor: workOrders.valueMinor,
            vendor: vendors.legalName,
          })
          .from(workOrders)
          .innerJoin(vendors, eq(workOrders.vendorId, vendors.id))
          .where(
            and(
              inArray(workOrders.siteId, ids(subSites)),
              inArray(workOrders.status, ["Approved", "Closed"]),
            ),
          )
          .catch(() => []),
        db
          .select({
            id: workOrderItems.id,
            workOrderId: workOrderItems.workOrderId,
            rateMinor: workOrderItems.rateMinor,
          })
          .from(workOrderItems)
          .innerJoin(workOrders, eq(workOrderItems.workOrderId, workOrders.id))
          .where(inArray(workOrders.siteId, ids(subSites)))
          .catch(() => []),
        db
          .select({
            itemId: workMeasurements.itemId,
            qty: workMeasurements.quantityThousandths,
            deduction: workMeasurements.deduction,
            status: workMeasurements.status,
          })
          .from(workMeasurements)
          .where(inArray(workMeasurements.siteId, ids(subSites)))
          .catch(() => []),
        db
          .select({
            siteId: dailyReports.siteId,
            date: dailyReports.reportDate,
            kind: dailyReports.reportKind,
            status: dailyReports.status,
          })
          .from(dailyReports)
          .where(
            and(
              inArray(dailyReports.siteId, ids(dprSites)),
              gte(dailyReports.reportDate, from),
              lte(dailyReports.reportDate, to),
            ),
          ),
        db
          .select({
            severity: siteIssues.severity,
            status: siteIssues.status,
            siteId: siteIssues.siteId,
          })
          .from(siteIssues)
          .where(inArray(siteIssues.siteId, ids(issueSites)))
          .catch(() => []),
        db
          .select({
            id: pettyCashFunds.id,
            siteId: pettyCashFunds.siteId,
            name: pettyCashFunds.name,
            status: pettyCashFunds.status,
          })
          .from(pettyCashFunds)
          .where(inArray(pettyCashFunds.siteId, ids(cashSites))),
        db
          .select({
            fundId: pettyCashMovements.fundId,
            type: pettyCashMovements.movementType,
            amountMinor: pettyCashMovements.amountMinor,
            status: pettyCashMovements.status,
          })
          .from(pettyCashMovements)
          .where(
            and(
              inArray(pettyCashMovements.siteId, ids(cashSites)),
              eq(pettyCashMovements.status, "Posted"),
            ),
          ),
      ]);

      // ---- money out ----
      const advanceOut = advances.filter(
        (row) =>
          row.type === "Advance" &&
          ["Approved"].includes(row.status) &&
          row.date >= from &&
          row.date <= to,
      );
      const moneyRows = [
        ...payments.map((row) => ({ ...row, series: "Suppliers" })),
        ...cash.map((row) => ({ ...row, series: "Petty cash" })),
        ...advanceOut.map((row) => ({ ...row, category: "Advance", series: "Worker advances" })),
      ].map((row) => ({ ...row, amountMinor: String(row.amountMinor), who: row.who ?? "" }));
      const moneyVisible = paySites.length + cashSites.length + advanceSites.length > 0;
      const moneyOut = moneyVisible
        ? {
            totalMinor: sumMinor(moneyRows),
            series: seriesByBucket(moneyRows, buckets.starts, MONEY_SERIES),
            byCategory: topByAmount(
              moneyRows.map((row) => ({
                key: row.category || row.series,
                amountMinor: row.amountMinor,
              })),
              6,
            ),
            bySite: topByAmount(
              moneyRows.map((row) => ({
                key: siteName.get(row.siteId) ?? "",
                amountMinor: row.amountMinor,
              })),
              8,
            ),
            topPayees: topByAmount(
              moneyRows.map((row) => ({ key: row.who || "—", amountMinor: row.amountMinor })),
              8,
            ),
            seriesShown: MONEY_SERIES.filter(
              (name) =>
                (name === "Suppliers" && paySites.length) ||
                (name === "Petty cash" && cashSites.length) ||
                (name === "Worker advances" && advanceSites.length),
            ),
          }
        : null;

      // ---- money in (company level, leaders and billing.view) ----
      const companyOrgs = [
        ...new Set(
          chosen
            .filter(
              (site) =>
                LEADERS.includes(String(site.organizationRole)) ||
                caps.find((row) => row.siteId === site.id)?.["billing.view"],
            )
            .map((site) => site.organizationId),
        ),
      ];
      const receipts =
        companyOrgs.length && !input.siteId
          ? await db
              .select({ date: clientReceipts.receivedOn, amountMinor: clientReceipts.amountMinor })
              .from(clientReceipts)
              .where(
                and(
                  inArray(clientReceipts.organizationId, companyOrgs),
                  eq(clientReceipts.status, "Recorded"),
                  gte(clientReceipts.receivedOn, from),
                  lte(clientReceipts.receivedOn, to),
                ),
              )
              .catch(() => [])
          : null;
      const moneyIn = receipts
        ? {
            totalMinor: sumMinor(receipts.map((row) => ({ amountMinor: String(row.amountMinor) }))),
            series: seriesByBucket(
              receipts.map((row) => ({
                date: row.date,
                series: "Received",
                amountMinor: String(row.amountMinor),
              })),
              buckets.starts,
              ["Received"],
            ).Received!,
          }
        : null;

      // ---- payables ----
      const paidByInvoice = new Map<string, bigint>();
      for (const row of allocations)
        if (["Approved", "Posted"].includes(row.status))
          paidByInvoice.set(
            row.invoiceId,
            (paidByInvoice.get(row.invoiceId) ?? 0n) + BigInt(row.amountMinor),
          );
      const open = invoices
        .map((row) => ({
          ...row,
          dueMinor: BigInt(row.totalMinor) - (paidByInvoice.get(row.id) ?? 0n),
        }))
        .filter((row) => row.dueMinor > 0n);
      const payables = invoiceSites.length
        ? {
            totalMinor: open.reduce((sum, row) => sum + row.dueMinor, 0n).toString(),
            ageing: AGE_BUCKETS.map((bucket) => ({
              bucket,
              amountMinor: open
                .filter((row) => ageBucket(row.dueDate, row.invoiceDate, today) === bucket)
                .reduce((sum, row) => sum + row.dueMinor, 0n)
                .toString(),
            })),
            topVendors: topByAmount(
              open.map((row) => ({ key: row.vendor, amountMinor: row.dueMinor.toString() })),
              6,
            ),
          }
        : null;

      // ---- petty cash balances ----
      const pettyCash = cashSites.length
        ? funds
            .filter((fund) => fund.status !== "Closed")
            .map((fund) => {
              let balance = 0n;
              for (const move of fundMoves.filter((row) => row.fundId === fund.id))
                balance += (move.type === "Expense" ? -1n : 1n) * BigInt(move.amountMinor);
              return {
                fund: fund.name,
                site: siteName.get(fund.siteId) ?? "",
                balanceMinor: balance.toString(),
              };
            })
        : null;

      // ---- labour ----
      const dayStarts = bucketStarts(from, to);
      const labour = attendanceSites.length
        ? (() => {
            const present = dayStarts.starts.map(() => 0);
            const absent = dayStarts.starts.map(() => 0);
            const cost = dayStarts.starts.map(() => 0n);
            const trades = new Map<string, Set<string>>();
            const absentByPerson = new Map<string, { name: string; count: number }>();
            let missingRate = 0;
            for (const row of attendance) {
              const i = bucketOf(row.date, dayStarts.starts);
              if (i < 0) continue;
              const working = row.status !== "Absent" && row.status !== "Leave";
              if (working) present[i]! += row.status === "Half Day" ? 0.5 : 1;
              else if (row.status === "Absent") {
                absent[i]! += 1;
                const entry = absentByPerson.get(row.personId) ?? { name: row.name, count: 0 };
                entry.count += 1;
                absentByPerson.set(row.personId, entry);
              }
              if (working) {
                const trade = row.trade?.trim() || row.skill || "Not specified";
                trades.set(trade, (trades.get(trade) ?? new Set()).add(row.personId));
                if (wageSites.includes(row.siteId)) {
                  const earning = estimateEarning({
                    status: row.status as AttendanceStatus,
                    rateType: (row.rateType as RateType) ?? null,
                    rateMinor: row.rateMinor,
                    regularHundredths: parseHours(String(row.regularHours)) ?? 0n,
                    overtimeHundredths: 0n,
                    overtimeApproved: false,
                  });
                  if (earning.kind === "amount") cost[i]! += earning.minor;
                  else if (earning.kind === "missing_rate") missingRate += 1;
                }
              }
            }
            const todayIndex = bucketOf(today, dayStarts.starts);
            return {
              bucket: dayStarts.size,
              present,
              absent,
              costMinor: wageSites.length ? cost.map(String) : null,
              costTotalMinor: wageSites.length ? cost.reduce((a, b) => a + b, 0n).toString() : null,
              missingRate,
              headcountToday:
                todayIndex >= 0 && dayStarts.starts[todayIndex] === today
                  ? present[todayIndex]!
                  : 0,
              tradeMix: [...trades.entries()]
                .map(([trade, set]) => ({ trade, people: set.size }))
                .sort((a, b) => b.people - a.people)
                .slice(0, 8),
              topAbsent: [...absentByPerson.values()].sort((a, b) => b.count - a.count).slice(0, 5),
            };
          })()
        : null;

      // ---- advances outstanding (cash given minus cash repaid) ----
      const advancesOutstanding = advanceSites.length
        ? (() => {
            const byPerson = new Map<string, bigint>();
            for (const row of advances)
              if (row.status === "Approved")
                byPerson.set(
                  row.who,
                  (byPerson.get(row.who) ?? 0n) +
                    (row.type === "Advance" ? 1n : -1n) * BigInt(row.amountMinor),
                );
            const list = [...byPerson.entries()]
              .filter(([, amount]) => amount > 0n)
              .sort((a, b) => (b[1] > a[1] ? 1 : -1));
            return {
              totalMinor: list.reduce((sum, [, amount]) => sum + amount, 0n).toString(),
              top: list
                .slice(0, 6)
                .map(([who, amount]) => ({ key: who, amountMinor: amount.toString() })),
            };
          })()
        : null;

      // ---- materials ----
      const itemById = new Map(items.map((item) => [item.id, item]));
      const materials = stockSites.length
        ? (() => {
            const balance = new Map<string, number>();
            const used = new Map<string, number>();
            const usedSeries = dayStarts.starts.map(() => 0);
            for (const move of movements) {
              const qty = Number(move.quantity);
              balance.set(
                move.itemId,
                (balance.get(move.itemId) ?? 0) + (move.direction === "Inbound" ? qty : -qty),
              );
              const date = new Date(move.date).toISOString().slice(0, 10);
              if (move.direction === "Outbound" && date >= from && date <= to) {
                used.set(move.itemId, (used.get(move.itemId) ?? 0) + qty);
                const i = bucketOf(date, dayStarts.starts);
                if (i >= 0) usedSeries[i]! += 1;
              }
            }
            const low = [...balance.entries()]
              .map(([id, qty]) => ({ item: itemById.get(id), qty }))
              .filter(
                (row) =>
                  row.item?.reorder !== null &&
                  row.item?.reorder !== undefined &&
                  row.qty <= Number(row.item.reorder),
              )
              .map((row) => ({
                name: row.item!.name,
                unit: row.item!.unit,
                onHand: row.qty,
                reorder: Number(row.item!.reorder),
              }))
              .slice(0, 8);
            return {
              lowStock: low,
              issuesPerBucket: usedSeries,
              topUsed: [...used.entries()]
                .sort((a, b) => b[1] - a[1])
                .slice(0, 6)
                .map(([id, qty]) => ({
                  name: itemById.get(id)?.name ?? "Item",
                  unit: itemById.get(id)?.unit ?? "",
                  qty,
                })),
              itemsInStock: [...balance.values()].filter((qty) => qty > 0).length,
            };
          })()
        : null;

      const materialRequestStatus = requestSites.length
        ? ["Submitted", "Approved", "Partially Approved", "Returned", "Rejected"].map((status) => ({
            status,
            count: requests.filter((row) => row.status === status).length,
          }))
        : null;

      // ---- subcontract: done vs balance ----
      const rateByItem = new Map(
        woItems.map((row) => [row.id, { wo: row.workOrderId, rate: BigInt(row.rateMinor) }]),
      );
      const measuredByWo = new Map<string, bigint>();
      for (const m of measures) {
        if (m.status === "Rejected") continue;
        const item = rateByItem.get(m.itemId);
        if (!item) continue;
        const value = (BigInt(m.qty) * item.rate + 500n) / 1000n;
        measuredByWo.set(
          item.wo,
          (measuredByWo.get(item.wo) ?? 0n) + (m.deduction === "Yes" ? -value : value),
        );
      }
      const subcontract = subSites.length
        ? orders.map((order) => {
            const value = BigInt(order.valueMinor);
            const done = measuredByWo.get(order.id) ?? 0n;
            return {
              title: order.title,
              vendor: order.vendor,
              site: siteName.get(order.siteId) ?? "",
              valueMinor: value.toString(),
              doneMinor: (done > value ? value : done < 0n ? 0n : done).toString(),
              percent: value > 0n ? Number((done * 1000n) / value) / 10 : 0,
            };
          })
        : null;

      // ---- reports compliance ----
      const elapsed = Math.min(input.days, dayStarts.starts.length);
      const reportsCompliance = dprSites.length
        ? dprSites.map((siteId) => {
            const days = new Set(
              reports
                .filter(
                  (row) => row.siteId === siteId && row.kind === "DPR" && row.status !== "Draft",
                )
                .map((row) => row.date),
            );
            return { site: siteName.get(siteId) ?? "", sent: days.size, days: elapsed };
          })
        : null;

      const issuesBySeverity = issueSites.length
        ? ["Critical", "High", "Medium", "Low"].map((severity) => ({
            severity,
            open: issues.filter(
              (row) =>
                row.severity === severity &&
                (row.status === "Open" || row.status === "In Progress"),
            ).length,
          }))
        : null;

      // ---- progress ----
      const cards = taskSites.length ? await placeCards(ctx.user) : null;
      const progress = cards
        ? cards.sites
            .filter(
              (card) => taskSites.includes(card.siteId) && card.progress.actualTenths !== null,
            )
            .map((card) => ({
              siteId: card.siteId,
              site: siteName.get(card.siteId) ?? "",
              actual: card.progress.actualTenths === null ? null : card.progress.actualTenths / 10,
              planned:
                card.progress.expectedTenths === null ? null : card.progress.expectedTenths / 10,
              overdue: card.progress.overdue,
              blocked: card.progress.blocked,
              health: card.progress.health,
            }))
        : null;
      const delayed = taskSites.length
        ? await db
            .select({
              code: workTasks.taskCode,
              title: workTasks.title,
              siteId: workTasks.siteId,
              plannedEnd: workTasks.plannedEnd,
              status: workTasks.status,
            })
            .from(workTasks)
            .where(
              and(
                inArray(workTasks.siteId, taskSites),
                lte(workTasks.plannedEnd, addDays(today, -1)),
                inArray(workTasks.status, [
                  "Planned",
                  "Ready",
                  "In Progress",
                  "On Hold",
                  "Blocked",
                  "Awaiting Inspection",
                ]),
              ),
            )
            .orderBy(workTasks.plannedEnd)
            .limit(8)
            .then((rows) => rows.map((row) => ({ ...row, site: siteName.get(row.siteId) ?? "" })))
            .catch(() => [])
        : null;

      const inbox = await buildInbox(db, ctx.user.id, caps, { inboxVersion: 3 }).catch(() => null);
      const approvals = inbox
        ? topByAmount(
            inbox.items.map((item) => ({ key: item.kind, amountMinor: "1" })),
            8,
          ).map((row) => ({ kind: row.key, count: Number(row.amountMinor) }))
        : [];

      return {
        from,
        to,
        today,
        bucket: buckets.size,
        labels: buckets.starts.map(bucketLabel),
        sites: chosen.map((site) => ({ id: site.id, name: site.name })),
        moneyOut,
        moneyIn,
        payables,
        pettyCash,
        labour,
        advancesOutstanding,
        materials,
        materialRequestStatus,
        subcontract,
        reportsCompliance,
        issuesBySeverity,
        progress,
        delayed,
        approvals,
      };
    }),

  /** Gantt and S-curve source for one site: tasks and the DPR progress history. */
  schedule: protectedProcedure
    .input(z.object({ siteId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      await getSiteScope(ctx.user, input.siteId, "task.view");
      const db = requireDb(await getDb());
      const tasks = await db
        .select({
          id: workTasks.id,
          code: workTasks.taskCode,
          title: workTasks.title,
          status: workTasks.status,
          plannedStart: workTasks.plannedStart,
          plannedEnd: workTasks.plannedEnd,
        })
        .from(workTasks)
        .where(eq(workTasks.siteId, input.siteId))
        .limit(2000);
      const reports = tasks.length
        ? await db
            .select({
              taskId: dailyReportItems.taskId,
              date: dailyReports.reportDate,
              percent: dailyReportItems.estimatedPercent,
            })
            .from(dailyReportItems)
            .innerJoin(dailyReports, eq(dailyReportItems.dailyReportId, dailyReports.id))
            .where(
              and(
                eq(dailyReports.siteId, input.siteId),
                inArray(dailyReports.status, ["Submitted", "Under Review", "Approved"]),
              ),
            )
            .orderBy(desc(dailyReports.reportDate))
            .limit(20_000)
        : [];
      return {
        today: todayIst(),
        tasks,
        reports: reports
          .filter((row) => row.taskId && row.percent !== null)
          .map((row) => ({ taskId: row.taskId!, date: row.date, percent: Number(row.percent) })),
      };
    }),
});
