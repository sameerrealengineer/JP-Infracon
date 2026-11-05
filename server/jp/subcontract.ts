import { randomUUID } from "node:crypto";
import { and, asc, desc, eq, inArray, isNull, like, lte, ne } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import {
  auditEvents,
  subcontractBillLines,
  subcontractBills,
  supplierInvoiceLines,
  supplierInvoices,
  users,
  vendors,
  workMeasurements,
  workOrderItems,
  workOrders,
} from "../../drizzle/schema";
import { protectedProcedure, router } from "../_core/trpc";
import { getDb } from "../db";
import { getSiteScope, selfApprovalAllowed, type SiteScope } from "./access";
import {
  lineAmountMinor,
  nextNumber,
  parsePercentBps,
  parseQuantity,
} from "../../lib/jp/billing-domain";
import { parseRupeesToMinor } from "../../lib/jp/finance-domain";
import { toLedgerQuantity } from "../../lib/jp/purchase-domain";
import {
  SUB_BILL_TRANSITIONS,
  WO_TRANSITIONS,
  advanceRecovery,
  billLinesFrom,
  checkMeasurement,
  measuredQuantity,
  subBillTotals,
  workOrderPosition,
} from "../../lib/jp/subcontract-domain";

/**
 * Subcontract: work orders to subcontractors with their own BOQ, a measurement book that site
 * staff record and a different person checks, and RA bills built only from checked, unbilled
 * measurements. Approving a bill (or a work order with an advance, or a retention release)
 * creates an Approved supplier invoice, so accounts pays it through supplier payments.
 * Everything is site scoped and audited; the server sets every amount and status.
 */

const uuid = z.string().uuid();
const mutationId = z.string().trim().min(16).max(64);
const dateText = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use a date like 2026-11-04.");
const today = () => new Date().toISOString().slice(0, 10);

function requireDb(db: Awaited<ReturnType<typeof getDb>>) {
  if (!db)
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message: "The business data service is temporarily unavailable.",
    });
  return db;
}
type Db = ReturnType<typeof requireDb>;

function bad(message: string): never {
  throw new TRPCError({ code: "BAD_REQUEST", message });
}
function forbidden(message: string): never {
  throw new TRPCError({ code: "FORBIDDEN", message });
}
function rupees(value: string | null | undefined, label: string) {
  if (!value?.trim()) return 0n;
  try {
    return BigInt(parseRupeesToMinor(value));
  } catch {
    bad(`${label}: enter an amount in rupees, like 650 or 25000.50.`);
  }
}
function percent(value: string | null | undefined, label: string) {
  if (!value?.trim() || value.trim() === "0") return 0;
  const bps = parsePercentBps(value);
  if (bps === null) bad(`${label}: enter a percentage like 5 or 2.5.`);
  return bps;
}

async function audit(
  db: Db,
  scope: SiteScope,
  userId: number,
  args: {
    action: string;
    entityType: string;
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
    entityType: args.entityType,
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

async function can(user: Parameters<typeof getSiteScope>[0], siteId: string, key: string) {
  return getSiteScope(user, siteId, key)
    .then(() => true)
    .catch(() => false);
}

async function loadOrder(db: Db, siteId: string, woId: string) {
  const [order] = await db.select().from(workOrders).where(eq(workOrders.id, woId)).limit(1);
  if (!order || order.siteId !== siteId)
    throw new TRPCError({ code: "NOT_FOUND", message: "Work order not found on this site." });
  return order;
}

/** Measured quantity per item, counting every entry that is not rejected. */
async function measuredByItem(db: Db, woId: string) {
  const rows = await db
    .select({
      itemId: workMeasurements.itemId,
      quantity: workMeasurements.quantityThousandths,
      status: workMeasurements.status,
    })
    .from(workMeasurements)
    .where(and(eq(workMeasurements.workOrderId, woId), ne(workMeasurements.status, "Rejected")));
  const all = new Map<string, bigint>();
  const checked = new Map<string, bigint>();
  for (const row of rows) {
    all.set(row.itemId, (all.get(row.itemId) ?? 0n) + BigInt(row.quantity));
    if (row.status === "Checked")
      checked.set(row.itemId, (checked.get(row.itemId) ?? 0n) + BigInt(row.quantity));
  }
  return { all, checked };
}

/**
 * Writes an Approved supplier invoice for a subcontract amount, so it appears in payables
 * and can be paid through supplier payments. Deductions go in as negative charges, so the
 * invoice total is exactly what is payable.
 */
async function postPayable(
  tx: Db,
  scope: SiteScope,
  args: {
    vendorId: string;
    invoiceNumber: string;
    invoiceDate: string;
    reference: string;
    lines: {
      description: string;
      quantityThousandths: bigint;
      unit: string;
      amountMinor: bigint;
    }[];
    gstMinor: bigint;
    deductionsMinor: bigint;
    makerId: number;
    approverId: number;
  },
) {
  const subtotal = args.lines.reduce((sum, line) => sum + line.amountMinor, 0n);
  const total = subtotal + args.gstMinor - args.deductionsMinor;
  if (total <= 0n) bad("The amount payable must be more than 0.");
  const id = randomUUID();
  const now = new Date();
  await tx.insert(supplierInvoices).values({
    id,
    organizationId: scope.organizationId,
    siteId: scope.siteId,
    vendorId: args.vendorId,
    invoiceNumber: args.invoiceNumber,
    invoiceNumberKey: args.invoiceNumber.toUpperCase(),
    invoiceDate: args.invoiceDate,
    dueDate: null,
    currency: "INR",
    subtotalMinor: subtotal.toString(),
    taxMinor: args.gstMinor.toString(),
    chargesMinor: (-args.deductionsMinor).toString(),
    totalMinor: total.toString(),
    purchaseReference: args.reference,
    receiptReference: null,
    status: "Approved",
    createdBy: args.makerId,
    submittedBy: args.makerId,
    submittedAt: now,
    reviewedBy: args.approverId,
    reviewedAt: now,
    reviewReason: "Approved in Subcontractors",
    clientMutationId: randomUUID(),
  });
  await tx.insert(supplierInvoiceLines).values(
    args.lines.map((line) => ({
      id: randomUUID(),
      invoiceId: id,
      description: line.description.slice(0, 240),
      quantity: toLedgerQuantity(line.quantityThousandths < 0n ? 0n : line.quantityThousandths),
      unitCode: line.unit.slice(0, 32),
      lineTotalMinor: line.amountMinor.toString(),
    })),
  );
  await audit(tx, scope, args.approverId, {
    action: "supplier_invoice.create",
    entityType: "supplier_invoice",
    entityId: id,
    after: {
      invoiceNumber: args.invoiceNumber,
      totalMinor: total.toString(),
      from: args.reference,
    },
  });
  return { id, totalMinor: total };
}

const itemInput = z.object({
  itemCode: z.string().trim().max(40).nullish(),
  description: z.string().trim().min(2).max(500),
  unit: z.string().trim().min(1).max(20),
  quantity: z.string().trim().max(20),
  rateRupees: z.string().trim().max(20),
});

export const subcontractRouter = router({
  /** Subcontractor firms for the work-order form. */
  options: protectedProcedure.input(z.object({ siteId: uuid })).query(async ({ ctx, input }) => {
    const scope = await getSiteScope(ctx.user, input.siteId, "subcontract.view");
    const db = requireDb(await getDb());
    return db
      .select({ id: vendors.id, name: vendors.legalName, contactName: vendors.contactName })
      .from(vendors)
      .where(
        and(
          eq(vendors.organizationId, scope.organizationId),
          eq(vendors.status, "Active"),
          eq(vendors.vendorType, "Subcontractor"),
        ),
      )
      .orderBy(asc(vendors.legalName));
  }),

  list: protectedProcedure.input(z.object({ siteId: uuid })).query(async ({ ctx, input }) => {
    const scope = await getSiteScope(ctx.user, input.siteId, "subcontract.view");
    const db = requireDb(await getDb());
    const orders = await db
      .select({ order: workOrders, vendorName: vendors.legalName })
      .from(workOrders)
      .innerJoin(vendors, eq(workOrders.vendorId, vendors.id))
      .where(eq(workOrders.siteId, scope.siteId))
      .orderBy(desc(workOrders.startDate), desc(workOrders.createdAt))
      .limit(200);
    const ids = orders.map((row) => row.order.id);
    const [items, measured, bills] = await Promise.all([
      ids.length
        ? db.select().from(workOrderItems).where(inArray(workOrderItems.workOrderId, ids))
        : [],
      ids.length
        ? db
            .select({
              woId: workMeasurements.workOrderId,
              itemId: workMeasurements.itemId,
              quantity: workMeasurements.quantityThousandths,
              status: workMeasurements.status,
            })
            .from(workMeasurements)
            .where(inArray(workMeasurements.workOrderId, ids))
        : [],
      ids.length
        ? db
            .select()
            .from(subcontractBills)
            .where(
              and(
                inArray(subcontractBills.workOrderId, ids),
                eq(subcontractBills.status, "Approved"),
              ),
            )
        : [],
    ]);
    return orders.map(({ order, vendorName }) => {
      const position = workOrderPosition({
        items: items
          .filter((item) => item.workOrderId === order.id)
          .map((item) => ({
            quantityThousandths: BigInt(item.quantityThousandths),
            rateMinor: BigInt(item.rateMinor),
            measuredThousandths: measured
              .filter((m) => m.itemId === item.id && m.status !== "Rejected")
              .reduce((sum, m) => sum + BigInt(m.quantity), 0n),
          })),
        approvedBills: bills
          .filter((bill) => bill.workOrderId === order.id)
          .map((bill) => ({
            workValueMinor: BigInt(bill.workValueMinor),
            retentionMinor: BigInt(bill.retentionMinor),
            netPayableMinor: BigInt(bill.netPayableMinor),
          })),
        retentionReleasedMinor: BigInt(order.retentionReleasedMinor),
      });
      return {
        ...order,
        vendorName,
        progressBps: position.progressBps,
        billedValueMinor: position.billedValueMinor.toString(),
        toCheck: measured.filter((m) => m.woId === order.id && m.status === "Recorded").length,
      };
    });
  }),

  detail: protectedProcedure
    .input(z.object({ siteId: uuid, woId: uuid }))
    .query(async ({ ctx, input }) => {
      const scope = await getSiteScope(ctx.user, input.siteId, "subcontract.view");
      const db = requireDb(await getDb());
      const order = await loadOrder(db, scope.siteId, input.woId);
      const [vendorRow, items, measurements, bills, creator, measured] = await Promise.all([
        db.select().from(vendors).where(eq(vendors.id, order.vendorId)),
        db
          .select()
          .from(workOrderItems)
          .where(eq(workOrderItems.workOrderId, order.id))
          .orderBy(asc(workOrderItems.lineNumber)),
        db
          .select({ m: workMeasurements, byName: users.name })
          .from(workMeasurements)
          .leftJoin(users, eq(workMeasurements.createdBy, users.id))
          .where(eq(workMeasurements.workOrderId, order.id))
          .orderBy(desc(workMeasurements.measuredOn), desc(workMeasurements.createdAt))
          .limit(300),
        db
          .select()
          .from(subcontractBills)
          .where(eq(subcontractBills.workOrderId, order.id))
          .orderBy(desc(subcontractBills.billDate), desc(subcontractBills.createdAt)),
        db.select({ name: users.name }).from(users).where(eq(users.id, order.createdBy)),
        measuredByItem(db, order.id),
      ]);
      const approved = bills.filter((bill) => bill.status === "Approved");
      const position = workOrderPosition({
        items: items.map((item) => ({
          quantityThousandths: BigInt(item.quantityThousandths),
          rateMinor: BigInt(item.rateMinor),
          measuredThousandths: measured.all.get(item.id) ?? 0n,
        })),
        approvedBills: approved.map((bill) => ({
          workValueMinor: BigInt(bill.workValueMinor),
          retentionMinor: BigInt(bill.retentionMinor),
          netPayableMinor: BigInt(bill.netPayableMinor),
        })),
        retentionReleasedMinor: BigInt(order.retentionReleasedMinor),
      });
      const recovered = bills
        .filter((bill) => !["Rejected", "Cancelled"].includes(bill.status))
        .reduce((sum, bill) => sum + BigInt(bill.advanceRecoveryMinor), 0n);
      const unbilledChecked = measurements.filter(
        ({ m }) => m.status === "Checked" && !m.billId,
      ).length;
      const [canCreate, canMeasure, canApprove, selfOk] = await Promise.all([
        can(ctx.user, input.siteId, "subcontract.create"),
        can(ctx.user, input.siteId, "subcontract.measure"),
        can(ctx.user, input.siteId, "subcontract.approve"),
        selfApprovalAllowed(ctx.user, scope.siteId),
      ]);
      const mine = order.createdBy === ctx.user.id;
      return {
        order,
        vendor: vendorRow[0] ?? null,
        createdByName: creator[0]?.name ?? null,
        items: items.map((item) => ({
          ...item,
          measuredThousandths: (measured.all.get(item.id) ?? 0n).toString(),
          checkedThousandths: (measured.checked.get(item.id) ?? 0n).toString(),
        })),
        measurements: measurements.map(({ m, byName }) => ({
          ...m,
          byName,
          canCheck:
            canApprove && m.status === "Recorded" && (m.createdBy !== ctx.user.id || selfOk),
        })),
        bills,
        position: {
          valueMinor: position.valueMinor.toString(),
          measuredValueMinor: position.measuredValueMinor.toString(),
          billedValueMinor: position.billedValueMinor.toString(),
          netPayableMinor: position.netPayableMinor.toString(),
          retentionHeldMinor: position.retentionHeldMinor.toString(),
          advanceOutstandingMinor: (BigInt(order.advanceMinor) - recovered).toString(),
          progressBps: position.progressBps,
          unbilledChecked,
        },
        can: {
          submit: canCreate && mine && ["Draft", "Rejected"].includes(order.status),
          review: canApprove && order.status === "Submitted" && (!mine || selfOk),
          cancel: canCreate && mine && ["Draft", "Rejected", "Submitted"].includes(order.status),
          close: canApprove && order.status === "Approved",
          measure: canMeasure && order.status === "Approved",
          bill: canCreate && order.status === "Approved" && unbilledChecked > 0,
          releaseRetention:
            canApprove && order.status === "Closed" && position.retentionHeldMinor > 0n,
        },
      };
    }),

  /** A new work order (Draft); the server numbers it and values every item. */
  create: protectedProcedure
    .input(
      z.object({
        siteId: uuid,
        vendorId: uuid,
        title: z.string().trim().min(3).max(200),
        scope: z.string().trim().max(4000).nullish(),
        startDate: dateText,
        endDate: dateText.nullish(),
        gstPercent: z.string().trim().max(6).default("18"),
        retentionPercent: z.string().trim().max(6).default("5"),
        tdsPercent: z.string().trim().max(6).default("1"),
        advanceRupees: z.string().trim().max(20).nullish(),
        advanceRecoveryPercent: z.string().trim().max(6).nullish(),
        items: z.array(itemInput).min(1).max(100),
        clientMutationId: mutationId,
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const scope = await getSiteScope(ctx.user, input.siteId, "subcontract.create");
      const db = requireDb(await getDb());
      const [existing] = await db
        .select({ id: workOrders.id, woNumber: workOrders.woNumber })
        .from(workOrders)
        .where(eq(workOrders.clientMutationId, input.clientMutationId))
        .limit(1);
      if (existing) return existing;
      const [vendor] = await db.select().from(vendors).where(eq(vendors.id, input.vendorId));
      if (
        !vendor ||
        vendor.organizationId !== scope.organizationId ||
        vendor.status !== "Active" ||
        vendor.vendorType !== "Subcontractor"
      )
        bad("Choose an active subcontractor (a supplier of type Subcontractor).");
      if (input.endDate && input.endDate < input.startDate)
        bad("The end date is before the start date.");
      const gstBps = percent(input.gstPercent, "GST");
      const retentionBps = percent(input.retentionPercent, "Retention");
      const tdsBps = percent(input.tdsPercent, "TDS");
      if (retentionBps > 2000) bad("Retention above 20% is not allowed.");
      if (tdsBps > 1000) bad("TDS above 10% is not allowed.");
      const advance = rupees(input.advanceRupees, "Advance");
      const recoveryBps = percent(input.advanceRecoveryPercent, "Advance recovery");
      if (advance > 0n && recoveryBps === 0)
        bad("Give the share of each bill that recovers the advance, like 20.");
      const codes = new Set<string>();
      const items = input.items.map((item, index) => {
        const code = item.itemCode?.trim() || String(index + 1);
        if (codes.has(code.toUpperCase())) bad(`Item code ${code} is used twice.`);
        codes.add(code.toUpperCase());
        const quantity = parseQuantity(item.quantity);
        if (quantity === null) bad(`Item ${index + 1}: quantity must be more than 0.`);
        const rate = rupees(item.rateRupees, `Item ${index + 1} rate`);
        if (rate <= 0n) bad(`Item ${index + 1}: enter the rate.`);
        return { ...item, code, quantity, rate, amount: lineAmountMinor(quantity, rate) };
      });
      const value = items.reduce((sum, item) => sum + item.amount, 0n);
      if (advance > value) bad("The advance is more than the work-order value.");
      const id = randomUUID();
      let woNumber = "";
      await db.transaction(async (tx) => {
        const prefix = `WO-${scope.siteCode}-`;
        const numbers = await tx
          .select({ number: workOrders.woNumber })
          .from(workOrders)
          .where(
            and(
              eq(workOrders.organizationId, scope.organizationId),
              like(workOrders.woNumber, `${prefix}%`),
            ),
          );
        woNumber = nextNumber(
          prefix,
          numbers.map((row) => row.number),
          3,
        );
        await tx.insert(workOrders).values({
          id,
          organizationId: scope.organizationId,
          siteId: scope.siteId,
          vendorId: vendor.id,
          woNumber,
          title: input.title,
          scope: input.scope || null,
          startDate: input.startDate,
          endDate: input.endDate ?? null,
          gstBps,
          retentionBps,
          tdsBps,
          valueMinor: value.toString(),
          advanceMinor: advance.toString(),
          advanceRecoveryBps: recoveryBps,
          retentionReleasedMinor: "0",
          clientMutationId: input.clientMutationId,
          createdBy: ctx.user.id,
        });
        await tx.insert(workOrderItems).values(
          items.map((item, index) => ({
            id: randomUUID(),
            workOrderId: id,
            lineNumber: index + 1,
            itemCode: item.code,
            description: item.description,
            unit: item.unit,
            quantityThousandths: item.quantity.toString(),
            rateMinor: item.rate.toString(),
            amountMinor: item.amount.toString(),
          })),
        );
        await audit(tx as unknown as Db, scope, ctx.user.id, {
          action: "subcontract.work_order_created",
          entityType: "work_order",
          entityId: id,
          clientMutationId: input.clientMutationId,
          after: { woNumber, valueMinor: value.toString(), subcontractor: vendor.legalName },
        });
      });
      return { id, woNumber };
    }),

  /**
   * submit / approve / reject / cancel / close. Approving a work order with an advance posts
   * the advance as an Approved payable, recovered later from the RA bills.
   */
  transition: protectedProcedure
    .input(
      z.object({
        siteId: uuid,
        woId: uuid,
        action: z.enum(["submit", "approve", "reject", "cancel", "close"]),
        reason: z.string().trim().max(1000).nullish(),
        clientMutationId: mutationId,
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const step = WO_TRANSITIONS[input.action];
      const scope = await getSiteScope(
        ctx.user,
        input.siteId,
        step.maker ? "subcontract.create" : "subcontract.approve",
      );
      const db = requireDb(await getDb());
      if (await replayed(db, ctx.user.id, input.clientMutationId)) return { ok: true };
      if (["reject", "cancel", "close"].includes(input.action) && !input.reason?.trim())
        bad("Give a reason.");
      const selfOk = await selfApprovalAllowed(ctx.user, scope.siteId);
      await db.transaction(async (tx) => {
        const [order] = await tx
          .select()
          .from(workOrders)
          .where(eq(workOrders.id, input.woId))
          .for("update");
        if (!order || order.siteId !== scope.siteId)
          throw new TRPCError({ code: "NOT_FOUND", message: "Work order not found." });
        if (!(step.from as readonly string[]).includes(order.status))
          bad(
            `A ${order.status} work order cannot be ${input.action === "submit" ? "submitted" : `${input.action}d`}.`,
          );
        if (step.maker && order.createdBy !== ctx.user.id)
          forbidden("Only the person who made the work order can do this.");
        if (
          (input.action === "approve" || input.action === "reject") &&
          order.createdBy === ctx.user.id &&
          !selfOk
        )
          forbidden("A different person must approve or reject this work order.");
        if (input.action === "close") {
          const open = await tx
            .select({ id: subcontractBills.id })
            .from(subcontractBills)
            .where(
              and(
                eq(subcontractBills.workOrderId, order.id),
                inArray(subcontractBills.status, ["Draft", "Submitted", "Rejected"]),
              ),
            )
            .limit(1);
          if (open.length) bad("Finish or cancel the bills still open before closing.");
        }
        let advanceInvoiceId: string | null = order.advanceInvoiceId;
        if (input.action === "approve" && BigInt(order.advanceMinor) > 0n && !advanceInvoiceId) {
          const posted = await postPayable(tx as unknown as Db, scope, {
            vendorId: order.vendorId,
            invoiceNumber: `${order.woNumber}/ADV`,
            invoiceDate: today(),
            reference: order.woNumber,
            lines: [
              {
                description: `Mobilisation advance, ${order.title}`,
                quantityThousandths: 1000n,
                unit: "lot",
                amountMinor: BigInt(order.advanceMinor),
              },
            ],
            gstMinor: 0n,
            deductionsMinor: 0n,
            makerId: order.createdBy,
            approverId: ctx.user.id,
          });
          advanceInvoiceId = posted.id;
        }
        await tx
          .update(workOrders)
          .set({
            status: step.to,
            advanceInvoiceId,
            ...(step.maker
              ? {}
              : {
                  reviewedBy: ctx.user.id,
                  reviewedAt: new Date(),
                  reviewReason: input.reason ?? null,
                }),
          })
          .where(eq(workOrders.id, order.id));
        await audit(tx as unknown as Db, scope, ctx.user.id, {
          action: `subcontract.work_order_${input.action}`,
          entityType: "work_order",
          entityId: order.id,
          clientMutationId: input.clientMutationId,
          before: { status: order.status },
          after: { status: step.to, advanceInvoiceId },
          reason: input.reason ?? null,
        });
      });
      return { ok: true };
    }),

  /** A measurement book entry (nos × L × B × D). Deductions (openings) take away. */
  measure: protectedProcedure
    .input(
      z.object({
        siteId: uuid,
        woId: uuid,
        itemId: uuid,
        measuredOn: dateText,
        location: z.string().trim().min(2).max(200),
        nos: z.string().trim().max(20).nullish(),
        length: z.string().trim().max(20).nullish(),
        breadth: z.string().trim().max(20).nullish(),
        depth: z.string().trim().max(20).nullish(),
        deduction: z.boolean().default(false),
        clientMutationId: mutationId,
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const scope = await getSiteScope(ctx.user, input.siteId, "subcontract.measure");
      const db = requireDb(await getDb());
      const [existing] = await db
        .select({ id: workMeasurements.id, quantity: workMeasurements.quantityThousandths })
        .from(workMeasurements)
        .where(eq(workMeasurements.clientMutationId, input.clientMutationId))
        .limit(1);
      if (existing) return { id: existing.id, quantityThousandths: existing.quantity };
      if (input.measuredOn > today()) bad("The measurement date cannot be in the future.");
      const size = measuredQuantity(input);
      if (typeof size === "string") bad(size);
      const quantity = input.deduction ? -size : size;
      const id = randomUUID();
      await db.transaction(async (tx) => {
        const [order] = await tx
          .select()
          .from(workOrders)
          .where(eq(workOrders.id, input.woId))
          .for("update");
        if (!order || order.siteId !== scope.siteId)
          throw new TRPCError({ code: "NOT_FOUND", message: "Work order not found." });
        if (order.status !== "Approved") bad("Measure only against an approved work order.");
        if (input.measuredOn < order.startDate)
          bad("The measurement date is before the work order started.");
        const [item] = await tx
          .select()
          .from(workOrderItems)
          .where(eq(workOrderItems.id, input.itemId));
        if (!item || item.workOrderId !== order.id) bad("That item is not on this work order.");
        const measured = await measuredByItem(tx as unknown as Db, order.id);
        const problem = checkMeasurement({
          description: item.description,
          orderedThousandths: BigInt(item.quantityThousandths),
          measuredSoFarThousandths: measured.all.get(item.id) ?? 0n,
          quantityThousandths: quantity,
        });
        if (problem) bad(problem.message);
        await tx.insert(workMeasurements).values({
          id,
          organizationId: scope.organizationId,
          siteId: scope.siteId,
          workOrderId: order.id,
          itemId: item.id,
          measuredOn: input.measuredOn,
          location: input.location,
          nos: input.nos || null,
          length: input.length || null,
          breadth: input.breadth || null,
          depth: input.depth || null,
          deduction: input.deduction ? "Yes" : "No",
          quantityThousandths: quantity.toString(),
          clientMutationId: input.clientMutationId,
          createdBy: ctx.user.id,
        });
        await audit(tx as unknown as Db, scope, ctx.user.id, {
          action: "subcontract.measurement_recorded",
          entityType: "work_order",
          entityId: order.id,
          clientMutationId: input.clientMutationId,
          after: { item: item.itemCode, location: input.location, quantity: quantity.toString() },
        });
      });
      return { id, quantityThousandths: quantity.toString() };
    }),

  /** A different person checks (or rejects, with a reason) what was measured. */
  checkMeasurement: protectedProcedure
    .input(
      z.object({
        siteId: uuid,
        measurementIds: z.array(uuid).min(1).max(100),
        action: z.enum(["check", "reject"]),
        reason: z.string().trim().max(500).nullish(),
        clientMutationId: mutationId,
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const scope = await getSiteScope(ctx.user, input.siteId, "subcontract.approve");
      const db = requireDb(await getDb());
      if (await replayed(db, ctx.user.id, input.clientMutationId)) return { ok: true };
      if (input.action === "reject" && !input.reason?.trim())
        bad("Say why the measurement is rejected.");
      const selfOk = await selfApprovalAllowed(ctx.user, scope.siteId);
      await db.transaction(async (tx) => {
        const rows = await tx
          .select()
          .from(workMeasurements)
          .where(inArray(workMeasurements.id, input.measurementIds))
          .for("update");
        if (rows.length !== input.measurementIds.length)
          throw new TRPCError({ code: "NOT_FOUND", message: "A measurement was not found." });
        for (const row of rows) {
          if (row.siteId !== scope.siteId) bad("A measurement is not from this site.");
          if (row.status !== "Recorded") bad("A measurement was already checked or rejected.");
          if (row.createdBy === ctx.user.id && !selfOk)
            forbidden("A different person must check measurements you recorded.");
        }
        await tx
          .update(workMeasurements)
          .set({
            status: input.action === "check" ? "Checked" : "Rejected",
            checkedBy: ctx.user.id,
            checkedAt: new Date(),
            rejectReason: input.action === "reject" ? (input.reason ?? null) : null,
          })
          .where(inArray(workMeasurements.id, input.measurementIds));
        await audit(tx as unknown as Db, scope, ctx.user.id, {
          action: `subcontract.measurement_${input.action === "check" ? "checked" : "rejected"}`,
          entityType: "work_order",
          entityId: rows[0].workOrderId,
          clientMutationId: input.clientMutationId,
          after: { count: rows.length },
          reason: input.reason ?? null,
        });
      });
      return { ok: true };
    }),

  /** Preview of the next RA bill: checked, unbilled measurements up to the date, with amounts. */
  billPreview: protectedProcedure
    .input(
      z.object({
        siteId: uuid,
        woId: uuid,
        periodTo: dateText,
        otherDeductionRupees: z.string().trim().max(20).nullish(),
      }),
    )
    .query(async ({ ctx, input }) => {
      const scope = await getSiteScope(ctx.user, input.siteId, "subcontract.view");
      const db = requireDb(await getDb());
      const order = await loadOrder(db, scope.siteId, input.woId);
      const draft = await draftBill(db, order, input.periodTo, input.otherDeductionRupees);
      return {
        lines: draft.lines.map((line) => ({
          ...line,
          quantityThousandths: line.quantityThousandths.toString(),
          rateMinor: line.rateMinor.toString(),
          amountMinor: line.amountMinor.toString(),
        })),
        measurementCount: draft.measurementIds.length,
        totals: Object.fromEntries(
          Object.entries(draft.totals).map(([key, value]) => [key, value.toString()]),
        ) as Record<keyof typeof draft.totals, string>,
      };
    }),

  /** Makes the RA bill from checked, unbilled measurements; Draft or straight to Submitted. */
  createBill: protectedProcedure
    .input(
      z.object({
        siteId: uuid,
        woId: uuid,
        billDate: dateText,
        periodTo: dateText,
        otherDeductionRupees: z.string().trim().max(20).nullish(),
        otherDeductionNote: z.string().trim().max(300).nullish(),
        submit: z.boolean().default(true),
        clientMutationId: mutationId,
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const scope = await getSiteScope(ctx.user, input.siteId, "subcontract.create");
      const db = requireDb(await getDb());
      const [existing] = await db
        .select({ id: subcontractBills.id, billNumber: subcontractBills.billNumber })
        .from(subcontractBills)
        .where(eq(subcontractBills.clientMutationId, input.clientMutationId))
        .limit(1);
      if (existing) return existing;
      if (input.periodTo > input.billDate) bad("The bill date is before the end of its period.");
      if (input.billDate > today()) bad("The bill date cannot be in the future.");
      const id = randomUUID();
      let billNumber = "";
      await db.transaction(async (tx) => {
        const [order] = await tx
          .select()
          .from(workOrders)
          .where(eq(workOrders.id, input.woId))
          .for("update");
        if (!order || order.siteId !== scope.siteId)
          throw new TRPCError({ code: "NOT_FOUND", message: "Work order not found." });
        if (order.status !== "Approved") bad("Bills are made only on an approved work order.");
        const draft = await draftBill(
          tx as unknown as Db,
          order,
          input.periodTo,
          input.otherDeductionRupees,
        );
        if (!draft.lines.length)
          bad("There are no checked measurements up to that date that are not billed yet.");
        if (draft.totals.otherDeductionMinor > 0n && !input.otherDeductionNote?.trim())
          bad("Say what the other deduction is for.");
        if (draft.totals.netPayableMinor <= 0n)
          bad("The deductions are more than the bill. Check the other deduction.");
        const prefix = `${order.woNumber}/RA-`;
        const numbers = await tx
          .select({ number: subcontractBills.billNumber })
          .from(subcontractBills)
          .where(eq(subcontractBills.workOrderId, order.id));
        billNumber = nextNumber(
          prefix,
          numbers.map((row) => row.number),
          2,
        );
        const t = draft.totals;
        await tx.insert(subcontractBills).values({
          id,
          organizationId: scope.organizationId,
          siteId: scope.siteId,
          workOrderId: order.id,
          billNumber,
          billDate: input.billDate,
          periodTo: input.periodTo,
          status: input.submit ? "Submitted" : "Draft",
          workValueMinor: t.workValueMinor.toString(),
          gstMinor: t.gstMinor.toString(),
          retentionMinor: t.retentionMinor.toString(),
          tdsMinor: t.tdsMinor.toString(),
          advanceRecoveryMinor: t.advanceRecoveryMinor.toString(),
          otherDeductionMinor: t.otherDeductionMinor.toString(),
          otherDeductionNote: input.otherDeductionNote || null,
          netPayableMinor: t.netPayableMinor.toString(),
          clientMutationId: input.clientMutationId,
          createdBy: ctx.user.id,
        });
        await tx.insert(subcontractBillLines).values(
          draft.lines.map((line) => ({
            id: randomUUID(),
            billId: id,
            itemId: line.itemId,
            quantityThousandths: line.quantityThousandths.toString(),
            rateMinor: line.rateMinor.toString(),
            amountMinor: line.amountMinor.toString(),
          })),
        );
        await tx
          .update(workMeasurements)
          .set({ billId: id })
          .where(inArray(workMeasurements.id, draft.measurementIds));
        await audit(tx as unknown as Db, scope, ctx.user.id, {
          action: "subcontract.bill_created",
          entityType: "subcontract_bill",
          entityId: id,
          clientMutationId: input.clientMutationId,
          after: {
            billNumber,
            workValueMinor: t.workValueMinor.toString(),
            netPayableMinor: t.netPayableMinor.toString(),
            measurements: draft.measurementIds.length,
          },
        });
      });
      return { id, billNumber };
    }),

  billDetail: protectedProcedure
    .input(z.object({ siteId: uuid, billId: uuid }))
    .query(async ({ ctx, input }) => {
      const scope = await getSiteScope(ctx.user, input.siteId, "subcontract.view");
      const db = requireDb(await getDb());
      const [bill] = await db
        .select()
        .from(subcontractBills)
        .where(eq(subcontractBills.id, input.billId));
      if (!bill || bill.siteId !== scope.siteId)
        throw new TRPCError({ code: "NOT_FOUND", message: "Bill not found on this site." });
      const order = await loadOrder(db, scope.siteId, bill.workOrderId);
      const [vendorRow, lines, measurements, creator, invoice] = await Promise.all([
        db.select({ name: vendors.legalName }).from(vendors).where(eq(vendors.id, order.vendorId)),
        db
          .select({ line: subcontractBillLines, item: workOrderItems })
          .from(subcontractBillLines)
          .innerJoin(workOrderItems, eq(subcontractBillLines.itemId, workOrderItems.id))
          .where(eq(subcontractBillLines.billId, bill.id))
          .orderBy(asc(workOrderItems.lineNumber)),
        db
          .select()
          .from(workMeasurements)
          .where(eq(workMeasurements.billId, bill.id))
          .orderBy(asc(workMeasurements.measuredOn)),
        db.select({ name: users.name }).from(users).where(eq(users.id, bill.createdBy)),
        bill.invoiceId
          ? db
              .select({
                id: supplierInvoices.id,
                invoiceNumber: supplierInvoices.invoiceNumber,
                status: supplierInvoices.status,
              })
              .from(supplierInvoices)
              .where(eq(supplierInvoices.id, bill.invoiceId))
          : [],
      ]);
      const [canCreate, canApprove, selfOk] = await Promise.all([
        can(ctx.user, input.siteId, "subcontract.create"),
        can(ctx.user, input.siteId, "subcontract.approve"),
        selfApprovalAllowed(ctx.user, scope.siteId),
      ]);
      const mine = bill.createdBy === ctx.user.id;
      return {
        bill,
        order: {
          id: order.id,
          woNumber: order.woNumber,
          title: order.title,
          gstBps: order.gstBps,
          retentionBps: order.retentionBps,
          tdsBps: order.tdsBps,
        },
        vendorName: vendorRow[0]?.name ?? null,
        createdByName: creator[0]?.name ?? null,
        lines: lines.map(({ line, item }) => ({
          ...line,
          itemCode: item.itemCode,
          description: item.description,
          unit: item.unit,
        })),
        measurements,
        invoice: invoice[0] ?? null,
        can: {
          submit: canCreate && mine && ["Draft", "Rejected"].includes(bill.status),
          review: canApprove && bill.status === "Submitted" && (!mine || selfOk),
          cancel: canCreate && mine && ["Draft", "Rejected", "Submitted"].includes(bill.status),
        },
      };
    }),

  /** submit / approve / reject / cancel an RA bill. Approval posts the payable. */
  billTransition: protectedProcedure
    .input(
      z.object({
        siteId: uuid,
        billId: uuid,
        action: z.enum(["submit", "approve", "reject", "cancel"]),
        reason: z.string().trim().max(1000).nullish(),
        clientMutationId: mutationId,
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const step = SUB_BILL_TRANSITIONS[input.action];
      const scope = await getSiteScope(
        ctx.user,
        input.siteId,
        step.maker ? "subcontract.create" : "subcontract.approve",
      );
      const db = requireDb(await getDb());
      if (await replayed(db, ctx.user.id, input.clientMutationId)) return { ok: true };
      if (["reject", "cancel"].includes(input.action) && !input.reason?.trim())
        bad("Give a reason.");
      const selfOk = await selfApprovalAllowed(ctx.user, scope.siteId);
      await db.transaction(async (tx) => {
        const [bill] = await tx
          .select()
          .from(subcontractBills)
          .where(eq(subcontractBills.id, input.billId))
          .for("update");
        if (!bill || bill.siteId !== scope.siteId)
          throw new TRPCError({ code: "NOT_FOUND", message: "Bill not found." });
        if (!(step.from as readonly string[]).includes(bill.status))
          bad(
            `A ${bill.status} bill cannot be ${input.action === "submit" ? "submitted" : `${input.action}d`}.`,
          );
        if (step.maker && bill.createdBy !== ctx.user.id)
          forbidden("Only the person who made the bill can do this.");
        if (
          (input.action === "approve" || input.action === "reject") &&
          bill.createdBy === ctx.user.id &&
          !selfOk
        )
          forbidden("A different person must approve or reject this bill.");
        let invoiceId = bill.invoiceId;
        if (input.action === "approve") {
          const [order] = await tx
            .select()
            .from(workOrders)
            .where(eq(workOrders.id, bill.workOrderId))
            .for("update");
          if (order?.status !== "Approved")
            bad("The work order is no longer approved, so this bill cannot be approved.");
          const lines = await tx
            .select({ line: subcontractBillLines, item: workOrderItems })
            .from(subcontractBillLines)
            .innerJoin(workOrderItems, eq(subcontractBillLines.itemId, workOrderItems.id))
            .where(eq(subcontractBillLines.billId, bill.id));
          const posted = await postPayable(tx as unknown as Db, scope, {
            vendorId: order.vendorId,
            invoiceNumber: bill.billNumber,
            invoiceDate: bill.billDate,
            reference: order.woNumber,
            lines: lines.map(({ line, item }) => ({
              description: `${item.itemCode} ${item.description}`,
              quantityThousandths: BigInt(line.quantityThousandths),
              unit: item.unit,
              amountMinor: BigInt(line.amountMinor),
            })),
            gstMinor: BigInt(bill.gstMinor),
            deductionsMinor:
              BigInt(bill.retentionMinor) +
              BigInt(bill.tdsMinor) +
              BigInt(bill.advanceRecoveryMinor) +
              BigInt(bill.otherDeductionMinor),
            makerId: bill.createdBy,
            approverId: ctx.user.id,
          });
          invoiceId = posted.id;
        }
        if (input.action === "cancel")
          await tx
            .update(workMeasurements)
            .set({ billId: null })
            .where(eq(workMeasurements.billId, bill.id));
        await tx
          .update(subcontractBills)
          .set({
            status: step.to,
            invoiceId,
            ...(step.maker
              ? {}
              : {
                  reviewedBy: ctx.user.id,
                  reviewedAt: new Date(),
                  reviewReason: input.reason ?? null,
                }),
          })
          .where(eq(subcontractBills.id, bill.id));
        await audit(tx as unknown as Db, scope, ctx.user.id, {
          action: `subcontract.bill_${input.action}`,
          entityType: "subcontract_bill",
          entityId: bill.id,
          clientMutationId: input.clientMutationId,
          before: { status: bill.status },
          after: { status: step.to, invoiceId },
          reason: input.reason ?? null,
        });
      });
      return { ok: true };
    }),

  /** After the work order is closed, the retention held is released as a payable. */
  releaseRetention: protectedProcedure
    .input(
      z.object({
        siteId: uuid,
        woId: uuid,
        reason: z.string().trim().min(3).max(1000),
        clientMutationId: mutationId,
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const scope = await getSiteScope(ctx.user, input.siteId, "subcontract.approve");
      const db = requireDb(await getDb());
      if (await replayed(db, ctx.user.id, input.clientMutationId)) return { ok: true };
      let amount = 0n;
      await db.transaction(async (tx) => {
        const [order] = await tx
          .select()
          .from(workOrders)
          .where(eq(workOrders.id, input.woId))
          .for("update");
        if (!order || order.siteId !== scope.siteId)
          throw new TRPCError({ code: "NOT_FOUND", message: "Work order not found." });
        if (order.status !== "Closed")
          bad("Retention is released only after the work order is closed.");
        const approved = await tx
          .select({ retention: subcontractBills.retentionMinor })
          .from(subcontractBills)
          .where(
            and(
              eq(subcontractBills.workOrderId, order.id),
              eq(subcontractBills.status, "Approved"),
            ),
          );
        const held =
          approved.reduce((sum, row) => sum + BigInt(row.retention), 0n) -
          BigInt(order.retentionReleasedMinor);
        if (held <= 0n) bad("No retention is held on this work order.");
        amount = held;
        const posted = await postPayable(tx as unknown as Db, scope, {
          vendorId: order.vendorId,
          invoiceNumber: `${order.woNumber}/RET`,
          invoiceDate: today(),
          reference: order.woNumber,
          lines: [
            {
              description: `Retention release, ${order.title}`,
              quantityThousandths: 1000n,
              unit: "lot",
              amountMinor: held,
            },
          ],
          gstMinor: 0n,
          deductionsMinor: 0n,
          makerId: ctx.user.id,
          approverId: ctx.user.id,
        });
        await tx
          .update(workOrders)
          .set({
            retentionReleasedMinor: (BigInt(order.retentionReleasedMinor) + held).toString(),
            retentionInvoiceId: posted.id,
          })
          .where(eq(workOrders.id, order.id));
        await audit(tx as unknown as Db, scope, ctx.user.id, {
          action: "subcontract.retention_released",
          entityType: "work_order",
          entityId: order.id,
          clientMutationId: input.clientMutationId,
          after: { amountMinor: held.toString(), invoiceId: posted.id },
          reason: input.reason,
        });
      });
      return { ok: true, amountMinor: amount.toString() };
    }),
});

/** The next RA bill for a work order: checked, unbilled measurements up to the date. */
async function draftBill(
  db: Db,
  order: typeof workOrders.$inferSelect,
  periodTo: string,
  otherDeductionRupees: string | null | undefined,
) {
  const [items, measurements, previous] = await Promise.all([
    db.select().from(workOrderItems).where(eq(workOrderItems.workOrderId, order.id)),
    db
      .select({
        id: workMeasurements.id,
        itemId: workMeasurements.itemId,
        quantity: workMeasurements.quantityThousandths,
      })
      .from(workMeasurements)
      .where(
        and(
          eq(workMeasurements.workOrderId, order.id),
          eq(workMeasurements.status, "Checked"),
          isNull(workMeasurements.billId),
          lte(workMeasurements.measuredOn, periodTo),
        ),
      ),
    db
      .select({ recovery: subcontractBills.advanceRecoveryMinor })
      .from(subcontractBills)
      .where(
        and(
          eq(subcontractBills.workOrderId, order.id),
          inArray(subcontractBills.status, ["Draft", "Submitted", "Approved"]),
        ),
      ),
  ]);
  const lines = billLinesFrom(
    items.map((item) => ({ id: item.id, rateMinor: BigInt(item.rateMinor) })),
    measurements.map((m) => ({ itemId: m.itemId, quantityThousandths: BigInt(m.quantity) })),
  ).map((line) => {
    const item = items.find((row) => row.id === line.itemId)!;
    return { ...line, itemCode: item.itemCode, description: item.description, unit: item.unit };
  });
  const workValue = lines.reduce((sum, line) => sum + line.amountMinor, 0n);
  const recovery = advanceRecovery({
    advanceMinor: BigInt(order.advanceMinor),
    recoveredSoFarMinor: previous.reduce((sum, row) => sum + BigInt(row.recovery), 0n),
    workValueMinor: workValue,
    recoveryBps: order.advanceRecoveryBps,
  });
  const totals = subBillTotals({
    workValueMinor: workValue,
    gstBps: order.gstBps,
    retentionBps: order.retentionBps,
    tdsBps: order.tdsBps,
    advanceRecoveryMinor: recovery,
    otherDeductionMinor: rupees(otherDeductionRupees, "Other deduction"),
  });
  return { lines, totals, measurementIds: measurements.map((m) => m.id) };
}
