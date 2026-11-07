import { randomUUID } from "node:crypto";
import { and, asc, desc, eq, inArray, like } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import {
  auditEvents,
  goodsReceiptLines,
  goodsReceipts,
  inventoryMovements,
  materialItems,
  materialRequestItems,
  materialRequests,
  purchaseInvoiceLinks,
  purchaseOrderLines,
  purchaseOrderQuotes,
  purchaseOrders,
  supplierInvoices,
  users,
  vendors,
} from "../../drizzle/schema";
import { protectedProcedure, router } from "../_core/trpc";
import { getDb } from "../db";
import { getSiteScope, selfApprovalAllowed, type SiteScope } from "./access";
import { disabledModulesFor } from "./module-settings";
import {
  lineAmountMinor,
  nextNumber,
  parsePercentBps,
  parseQuantity,
} from "../../lib/jp/billing-domain";
import { parseRupeesToMinor } from "../../lib/jp/finance-domain";
import {
  PO_TRANSITIONS,
  checkDelivery,
  lowestQuote,
  matchBills,
  poTotals,
  receiptState,
  toLedgerQuantity,
} from "../../lib/jp/purchase-domain";

/**
 * Purchase: orders to suppliers (with competing quotes), maker-checker approval, goods
 * receipts (GRN) that send accepted material to the inventory ledger for review, and supplier
 * bills matched against what was received. Every step is site scoped and audited; the server
 * sets every total and status.
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
function rupees(value: string, label: string) {
  try {
    return BigInt(parseRupeesToMinor(value));
  } catch {
    bad(`${label}: enter an amount in rupees, like 410 or 62000.50.`);
  }
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

async function loadOrder(db: Db, siteId: string, poId: string) {
  const [order] = await db
    .select()
    .from(purchaseOrders)
    .where(eq(purchaseOrders.id, poId))
    .limit(1);
  if (!order || order.siteId !== siteId)
    throw new TRPCError({ code: "NOT_FOUND", message: "Purchase order not found on this site." });
  return order;
}

/** Accepted quantity per PO line across all goods receipts. */
async function receivedByLine(db: Db, poId: string) {
  const rows = await db
    .select({
      lineId: goodsReceiptLines.purchaseOrderLineId,
      accepted: goodsReceiptLines.acceptedThousandths,
    })
    .from(goodsReceiptLines)
    .innerJoin(goodsReceipts, eq(goodsReceiptLines.goodsReceiptId, goodsReceipts.id))
    .where(eq(goodsReceipts.purchaseOrderId, poId));
  const map = new Map<string, bigint>();
  for (const row of rows) map.set(row.lineId, (map.get(row.lineId) ?? 0n) + BigInt(row.accepted));
  return map;
}

async function billedFor(db: Db, poIds: string[]) {
  if (!poIds.length) return new Map<string, { billed: bigint; count: number }>();
  const rows = await db
    .select({
      poId: purchaseInvoiceLinks.purchaseOrderId,
      total: supplierInvoices.totalMinor,
      status: supplierInvoices.status,
    })
    .from(purchaseInvoiceLinks)
    .innerJoin(supplierInvoices, eq(purchaseInvoiceLinks.invoiceId, supplierInvoices.id))
    .where(inArray(purchaseInvoiceLinks.purchaseOrderId, poIds));
  const map = new Map<string, { billed: bigint; count: number }>();
  for (const row of rows) {
    if (row.status === "Rejected" || row.status === "Draft") continue;
    const entry = map.get(row.poId) ?? { billed: 0n, count: 0 };
    entry.billed += BigInt(row.total);
    entry.count += 1;
    map.set(row.poId, entry);
  }
  return map;
}

const lineInput = z.object({
  materialItemId: uuid.nullish(),
  description: z.string().trim().min(2).max(300),
  unitCode: z.string().trim().min(1).max(32),
  quantity: z.string().trim().max(20),
  rateRupees: z.string().trim().max(20),
  gstPercent: z.string().trim().max(6).default("18"),
});

const quoteInput = z.object({
  vendorId: uuid.nullish(),
  vendorName: z.string().trim().min(2).max(180),
  totalRupees: z.string().trim().max(20),
  deliveryDays: z.number().int().min(0).max(365).nullish(),
  note: z.string().trim().max(300).nullish(),
});

export const purchaseRouter = router({
  /** What the order form needs: suppliers, catalogue items and approved material requests. */
  options: protectedProcedure.input(z.object({ siteId: uuid })).query(async ({ ctx, input }) => {
    const scope = await getSiteScope(ctx.user, input.siteId, "purchase.view");
    const db = requireDb(await getDb());
    const [vendorRows, items, requests] = await Promise.all([
      db
        .select({ id: vendors.id, name: vendors.legalName, vendorType: vendors.vendorType })
        .from(vendors)
        .where(and(eq(vendors.organizationId, scope.organizationId), eq(vendors.status, "Active")))
        .orderBy(asc(vendors.legalName)),
      db
        .select({
          id: materialItems.id,
          name: materialItems.name,
          unitCode: materialItems.baseUnitCode,
          itemCode: materialItems.itemCode,
        })
        .from(materialItems)
        .where(
          and(
            eq(materialItems.organizationId, scope.organizationId),
            eq(materialItems.status, "Active"),
          ),
        )
        .orderBy(asc(materialItems.name)),
      db
        .select({
          id: materialRequests.id,
          purpose: materialRequests.purpose,
          at: materialRequests.createdAt,
        })
        .from(materialRequests)
        .where(
          and(
            eq(materialRequests.siteId, scope.siteId),
            inArray(materialRequests.status, ["Approved", "Partially Approved"]),
          ),
        )
        .orderBy(desc(materialRequests.createdAt))
        .limit(30),
    ]);
    const requestItems = requests.length
      ? await db
          .select()
          .from(materialRequestItems)
          .where(
            inArray(
              materialRequestItems.requestId,
              requests.map((row) => row.id),
            ),
          )
      : [];
    return {
      vendors: vendorRows,
      items,
      requests: requests.map((request) => ({
        ...request,
        items: requestItems
          .filter((item) => item.requestId === request.id)
          .map((item) => ({
            materialItemId: item.materialItemId,
            name: item.itemNameSnapshot,
            quantity: String(item.approvedQuantity ?? item.requestedQuantity),
            unitCode: item.unitCode,
          })),
      })),
    };
  }),

  list: protectedProcedure.input(z.object({ siteId: uuid })).query(async ({ ctx, input }) => {
    const scope = await getSiteScope(ctx.user, input.siteId, "purchase.view");
    const db = requireDb(await getDb());
    const orders = await db
      .select({ order: purchaseOrders, vendorName: vendors.legalName })
      .from(purchaseOrders)
      .innerJoin(vendors, eq(purchaseOrders.vendorId, vendors.id))
      .where(eq(purchaseOrders.siteId, scope.siteId))
      .orderBy(desc(purchaseOrders.orderDate), desc(purchaseOrders.createdAt))
      .limit(200);
    const ids = orders.map((row) => row.order.id);
    const [lines, receipts, billed] = await Promise.all([
      ids.length
        ? db
            .select()
            .from(purchaseOrderLines)
            .where(inArray(purchaseOrderLines.purchaseOrderId, ids))
        : [],
      ids.length
        ? db
            .select({
              poId: goodsReceipts.purchaseOrderId,
              lineId: goodsReceiptLines.purchaseOrderLineId,
              accepted: goodsReceiptLines.acceptedThousandths,
            })
            .from(goodsReceiptLines)
            .innerJoin(goodsReceipts, eq(goodsReceiptLines.goodsReceiptId, goodsReceipts.id))
            .where(inArray(goodsReceipts.purchaseOrderId, ids))
        : [],
      billedFor(db, ids),
    ]);
    return orders.map(({ order, vendorName }) => {
      const mine = lines.filter((line) => line.purchaseOrderId === order.id);
      const received = (lineId: string) =>
        receipts
          .filter((row) => row.lineId === lineId)
          .reduce((sum, row) => sum + BigInt(row.accepted), 0n);
      return {
        ...order,
        vendorName,
        receipt: receiptState(
          mine.map((line) => ({
            orderedThousandths: BigInt(line.quantityThousandths),
            receivedThousandths: received(line.id),
          })),
        ),
        billedMinor: (billed.get(order.id)?.billed ?? 0n).toString(),
      };
    });
  }),

  detail: protectedProcedure
    .input(z.object({ siteId: uuid, poId: uuid }))
    .query(async ({ ctx, input }) => {
      const scope = await getSiteScope(ctx.user, input.siteId, "purchase.view");
      const db = requireDb(await getDb());
      const order = await loadOrder(db, scope.siteId, input.poId);
      const [vendorRow, lines, quotes, grns, received, links, creator] = await Promise.all([
        db.select().from(vendors).where(eq(vendors.id, order.vendorId)),
        db
          .select()
          .from(purchaseOrderLines)
          .where(eq(purchaseOrderLines.purchaseOrderId, order.id))
          .orderBy(asc(purchaseOrderLines.lineNumber)),
        db
          .select()
          .from(purchaseOrderQuotes)
          .where(eq(purchaseOrderQuotes.purchaseOrderId, order.id)),
        db
          .select({ grn: goodsReceipts, byName: users.name })
          .from(goodsReceipts)
          .leftJoin(users, eq(goodsReceipts.createdBy, users.id))
          .where(eq(goodsReceipts.purchaseOrderId, order.id))
          .orderBy(desc(goodsReceipts.receivedOn)),
        receivedByLine(db, order.id),
        db
          .select({
            invoiceId: supplierInvoices.id,
            invoiceNumber: supplierInvoices.invoiceNumber,
            invoiceDate: supplierInvoices.invoiceDate,
            totalMinor: supplierInvoices.totalMinor,
            status: supplierInvoices.status,
          })
          .from(purchaseInvoiceLinks)
          .innerJoin(supplierInvoices, eq(purchaseInvoiceLinks.invoiceId, supplierInvoices.id))
          .where(eq(purchaseInvoiceLinks.purchaseOrderId, order.id)),
        db.select({ name: users.name }).from(users).where(eq(users.id, order.createdBy)),
      ]);
      const grnLines = grns.length
        ? await db
            .select()
            .from(goodsReceiptLines)
            .where(
              inArray(
                goodsReceiptLines.goodsReceiptId,
                grns.map((row) => row.grn.id),
              ),
            )
        : [];
      const counted = links.filter((row) => !["Rejected", "Draft"].includes(row.status));
      const match = matchBills({
        lines: lines.map((line) => ({
          quantityThousandths: BigInt(line.quantityThousandths),
          rateMinor: BigInt(line.rateMinor),
          gstBps: line.gstBps,
          receivedThousandths: received.get(line.id) ?? 0n,
        })),
        billedMinor: counted.reduce((sum, row) => sum + BigInt(row.totalMinor), 0n),
        hasBills: counted.length > 0,
      });
      const low = lowestQuote(
        quotes.map((quote) => ({ ...quote, totalMinor: BigInt(quote.totalMinor) })),
      );
      const [canApprove, canReceive, canCreate] = await Promise.all(
        ["purchase.approve", "purchase.receive", "purchase.create"].map((key) =>
          getSiteScope(ctx.user, input.siteId, key)
            .then(() => true)
            .catch(() => false),
        ),
      );
      const selfOk =
        order.createdBy === ctx.user.id && (await selfApprovalAllowed(ctx.user, scope.siteId));
      return {
        order,
        vendor: vendorRow[0] ?? null,
        createdByName: creator[0]?.name ?? null,
        lines: lines.map((line) => ({
          ...line,
          receivedThousandths: (received.get(line.id) ?? 0n).toString(),
        })),
        quotes: quotes.map((quote) => ({ ...quote, lowest: low?.id === quote.id })),
        receipts: grns.map(({ grn, byName }) => ({
          ...grn,
          byName,
          lines: grnLines.filter((line) => line.goodsReceiptId === grn.id),
        })),
        receipt: receiptState(
          lines.map((line) => ({
            orderedThousandths: BigInt(line.quantityThousandths),
            receivedThousandths: received.get(line.id) ?? 0n,
          })),
        ),
        bills: links,
        match: {
          receivedValueMinor: match.receivedValueMinor.toString(),
          billedMinor: match.billedMinor.toString(),
          differenceMinor: match.differenceMinor.toString(),
          state: match.state,
        },
        can: {
          submit:
            canCreate &&
            ["Draft", "Rejected"].includes(order.status) &&
            order.createdBy === ctx.user.id,
          review:
            canApprove &&
            order.status === "Submitted" &&
            (order.createdBy !== ctx.user.id || selfOk),
          cancel:
            canCreate &&
            ["Draft", "Rejected", "Submitted"].includes(order.status) &&
            order.createdBy === ctx.user.id,
          receive: canReceive && order.status === "Approved",
          close: canApprove && order.status === "Approved",
          linkBill: canCreate && ["Approved", "Closed"].includes(order.status),
        },
      };
    }),

  /** A new purchase order (Draft); the server numbers it and computes every amount. */
  create: protectedProcedure
    .input(
      z.object({
        siteId: uuid,
        vendorId: uuid,
        materialRequestId: uuid.nullish(),
        orderDate: dateText,
        expectedDate: dateText.nullish(),
        deliveryAddress: z.string().trim().max(600).nullish(),
        terms: z.string().trim().max(2000).nullish(),
        lines: z.array(lineInput).min(1).max(100),
        quotes: z.array(quoteInput).max(6).default([]),
        clientMutationId: mutationId,
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const scope = await getSiteScope(ctx.user, input.siteId, "purchase.create");
      const db = requireDb(await getDb());
      const [existing] = await db
        .select({ id: purchaseOrders.id, poNumber: purchaseOrders.poNumber })
        .from(purchaseOrders)
        .where(eq(purchaseOrders.clientMutationId, input.clientMutationId))
        .limit(1);
      if (existing) return { id: existing.id, poNumber: existing.poNumber };
      const [vendor] = await db.select().from(vendors).where(eq(vendors.id, input.vendorId));
      if (!vendor || vendor.organizationId !== scope.organizationId || vendor.status !== "Active")
        bad("Choose an active supplier.");
      if (input.expectedDate && input.expectedDate < input.orderDate)
        bad("The expected delivery date is before the order date.");
      if (input.materialRequestId) {
        const [request] = await db
          .select({ siteId: materialRequests.siteId })
          .from(materialRequests)
          .where(eq(materialRequests.id, input.materialRequestId));
        if (request?.siteId !== scope.siteId) bad("That material request is not from this site.");
      }
      const itemIds = input.lines.map((line) => line.materialItemId).filter(Boolean) as string[];
      const items = itemIds.length
        ? await db.select().from(materialItems).where(inArray(materialItems.id, itemIds))
        : [];
      const lines = input.lines.map((line, index) => {
        if (line.materialItemId) {
          const item = items.find((row) => row.id === line.materialItemId);
          if (!item || item.organizationId !== scope.organizationId)
            bad(`Line ${index + 1}: catalogue item not found.`);
        }
        const quantity = parseQuantity(line.quantity);
        if (quantity === null) bad(`Line ${index + 1}: quantity must be more than 0.`);
        const gstBps = parsePercentBps(line.gstPercent);
        if (gstBps === null) bad(`Line ${index + 1}: GST must be a percentage like 18.`);
        return {
          ...line,
          quantity,
          rate: rupees(line.rateRupees, `Line ${index + 1} rate`),
          gstBps,
        };
      });
      const totals = poTotals(
        lines.map((line) => ({
          quantityThousandths: line.quantity,
          rateMinor: line.rate,
          gstBps: line.gstBps,
        })),
      );
      const quotes = input.quotes.map((quote, index) => ({
        ...quote,
        total: rupees(quote.totalRupees, `Quote ${index + 1} total`),
      }));
      const id = randomUUID();
      let poNumber = "";
      await db.transaction(async (tx) => {
        const prefix = `PO-${scope.siteCode}-`;
        const numbers = await tx
          .select({ number: purchaseOrders.poNumber })
          .from(purchaseOrders)
          .where(
            and(
              eq(purchaseOrders.organizationId, scope.organizationId),
              like(purchaseOrders.poNumber, `${prefix}%`),
            ),
          );
        poNumber = nextNumber(
          prefix,
          numbers.map((row) => row.number),
          3,
        );
        await tx.insert(purchaseOrders).values({
          id,
          organizationId: scope.organizationId,
          siteId: scope.siteId,
          vendorId: input.vendorId,
          materialRequestId: input.materialRequestId ?? null,
          poNumber,
          orderDate: input.orderDate,
          expectedDate: input.expectedDate ?? null,
          deliveryAddress: input.deliveryAddress || null,
          terms: input.terms || null,
          subtotalMinor: totals.subtotalMinor.toString(),
          gstMinor: totals.gstMinor.toString(),
          totalMinor: totals.totalMinor.toString(),
          clientMutationId: input.clientMutationId,
          createdBy: ctx.user.id,
        });
        await tx.insert(purchaseOrderLines).values(
          lines.map((line, index) => ({
            id: randomUUID(),
            purchaseOrderId: id,
            lineNumber: index + 1,
            materialItemId: line.materialItemId ?? null,
            description: line.description,
            unitCode: line.unitCode,
            quantityThousandths: line.quantity.toString(),
            rateMinor: line.rate.toString(),
            gstBps: line.gstBps,
            amountMinor: lineAmountMinor(line.quantity, line.rate).toString(),
          })),
        );
        if (quotes.length)
          await tx.insert(purchaseOrderQuotes).values(
            quotes.map((quote) => ({
              id: randomUUID(),
              purchaseOrderId: id,
              vendorId: quote.vendorId ?? null,
              vendorName: quote.vendorName,
              totalMinor: quote.total.toString(),
              deliveryDays: quote.deliveryDays ?? null,
              note: quote.note || null,
              chosen: quote.vendorId === input.vendorId ? ("Yes" as const) : ("No" as const),
            })),
          );
        await audit(tx as unknown as Db, scope, ctx.user.id, {
          action: "purchase.order_created",
          entityType: "purchase_order",
          entityId: id,
          clientMutationId: input.clientMutationId,
          after: { poNumber, totalMinor: totals.totalMinor.toString(), vendor: vendor.legalName },
        });
      });
      return { id, poNumber };
    }),

  /** submit / approve / reject / cancel / close, with maker-checker on approval. */
  transition: protectedProcedure
    .input(
      z.object({
        siteId: uuid,
        poId: uuid,
        action: z.enum(["submit", "approve", "reject", "cancel", "close"]),
        reason: z.string().trim().max(1000).nullish(),
        clientMutationId: mutationId,
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const step = PO_TRANSITIONS[input.action];
      const scope = await getSiteScope(
        ctx.user,
        input.siteId,
        step.maker ? "purchase.create" : "purchase.approve",
      );
      const db = requireDb(await getDb());
      if (await replayed(db, ctx.user.id, input.clientMutationId)) return { ok: true };
      if (["reject", "cancel", "close"].includes(input.action) && !input.reason?.trim())
        bad("Give a reason.");
      const selfOk = await selfApprovalAllowed(ctx.user, scope.siteId);
      await db.transaction(async (tx) => {
        const [order] = await tx
          .select()
          .from(purchaseOrders)
          .where(eq(purchaseOrders.id, input.poId))
          .for("update");
        if (!order || order.siteId !== scope.siteId)
          throw new TRPCError({ code: "NOT_FOUND", message: "Purchase order not found." });
        if (!(step.from as readonly string[]).includes(order.status))
          bad(
            `A ${order.status} order cannot be ${input.action === "submit" ? "submitted" : `${input.action}d`}.`,
          );
        if (step.maker && order.createdBy !== ctx.user.id)
          throw new TRPCError({
            code: "FORBIDDEN",
            message: "Only the person who made the order can do this.",
          });
        if (
          (input.action === "approve" || input.action === "reject") &&
          order.createdBy === ctx.user.id &&
          !selfOk
        )
          throw new TRPCError({
            code: "FORBIDDEN",
            message: "A different person must approve or reject this order.",
          });
        await tx
          .update(purchaseOrders)
          .set({
            status: step.to,
            ...(step.maker
              ? {}
              : {
                  reviewedBy: ctx.user.id,
                  reviewedAt: new Date(),
                  reviewReason: input.reason ?? null,
                }),
          })
          .where(eq(purchaseOrders.id, order.id));
        await audit(tx as unknown as Db, scope, ctx.user.id, {
          action: `purchase.order_${input.action}`,
          entityType: "purchase_order",
          entityId: order.id,
          clientMutationId: input.clientMutationId,
          before: { status: order.status },
          after: { status: step.to },
          reason: input.reason ?? null,
        });
      });
      return { ok: true };
    }),

  /**
   * Goods receipt (GRN): what arrived, what was rejected and why. Accepted catalogue material
   * goes to the inventory ledger as a Receipt/Inward for review (when Inventory is on).
   */
  receive: protectedProcedure
    .input(
      z.object({
        siteId: uuid,
        poId: uuid,
        receivedOn: dateText,
        challanNumber: z.string().trim().max(80).nullish(),
        vehicleNumber: z.string().trim().max(40).nullish(),
        note: z.string().trim().max(1000).nullish(),
        lines: z
          .array(
            z.object({
              poLineId: uuid,
              accepted: z.string().trim().max(20).default("0"),
              rejected: z.string().trim().max(20).default("0"),
              rejectReason: z.string().trim().max(300).nullish(),
            }),
          )
          .min(1)
          .max(100),
        clientMutationId: mutationId,
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const scope = await getSiteScope(ctx.user, input.siteId, "purchase.receive");
      const db = requireDb(await getDb());
      const [existing] = await db
        .select({ id: goodsReceipts.id, grnNumber: goodsReceipts.grnNumber })
        .from(goodsReceipts)
        .where(eq(goodsReceipts.clientMutationId, input.clientMutationId))
        .limit(1);
      if (existing) return { id: existing.id, grnNumber: existing.grnNumber, stockEntries: 0 };
      if (input.receivedOn > today()) bad("The received date cannot be in the future.");
      const qty = (value: string, label: string) => {
        if (!value || value === "0") return 0n;
        const parsed = parseQuantity(value);
        if (parsed === null) bad(`${label}: enter a quantity, up to 3 decimals.`);
        return parsed;
      };
      const inventoryOn = !(await disabledModulesFor(scope.organizationId)).includes("inventory");
      const id = randomUUID();
      let grnNumber = "";
      let stockEntries = 0;
      await db.transaction(async (tx) => {
        const [order] = await tx
          .select()
          .from(purchaseOrders)
          .where(eq(purchaseOrders.id, input.poId))
          .for("update");
        if (!order || order.siteId !== scope.siteId)
          throw new TRPCError({ code: "NOT_FOUND", message: "Purchase order not found." });
        if (order.status !== "Approved")
          bad("Goods can be received only against an approved order.");
        const lines = await tx
          .select()
          .from(purchaseOrderLines)
          .where(eq(purchaseOrderLines.purchaseOrderId, order.id));
        const received = await receivedByLine(tx as unknown as Db, order.id);
        const seen = new Set<string>();
        const entries = input.lines
          .map((entry) => {
            const line = lines.find((row) => row.id === entry.poLineId);
            if (!line) bad("A line does not belong to this order.");
            if (seen.has(line.id)) bad(`${line.description} appears twice.`);
            seen.add(line.id);
            const accepted = qty(entry.accepted, line.description);
            const rejected = qty(entry.rejected, line.description);
            return { line, accepted, rejected, rejectReason: entry.rejectReason ?? null };
          })
          .filter((entry) => entry.accepted > 0n || entry.rejected > 0n);
        if (!entries.length) bad("Enter the quantity that arrived for at least one item.");
        for (const entry of entries) {
          const problem = checkDelivery({
            description: entry.line.description,
            orderedThousandths: BigInt(entry.line.quantityThousandths),
            alreadyReceivedThousandths: received.get(entry.line.id) ?? 0n,
            acceptedThousandths: entry.accepted,
            rejectedThousandths: entry.rejected,
            rejectReason: entry.rejectReason,
          });
          if (problem) bad(problem.message);
        }
        const prefix = `GRN-${scope.siteCode}-`;
        const numbers = await tx
          .select({ number: goodsReceipts.grnNumber })
          .from(goodsReceipts)
          .where(
            and(
              eq(goodsReceipts.organizationId, scope.organizationId),
              like(goodsReceipts.grnNumber, `${prefix}%`),
            ),
          );
        grnNumber = nextNumber(
          prefix,
          numbers.map((row) => row.number),
          3,
        );
        await tx.insert(goodsReceipts).values({
          id,
          organizationId: scope.organizationId,
          siteId: scope.siteId,
          purchaseOrderId: order.id,
          grnNumber,
          receivedOn: input.receivedOn,
          challanNumber: input.challanNumber || null,
          vehicleNumber: input.vehicleNumber || null,
          note: input.note || null,
          clientMutationId: input.clientMutationId,
          createdBy: ctx.user.id,
        });
        for (const entry of entries) {
          let movementId: string | null = null;
          if (inventoryOn && entry.line.materialItemId && entry.accepted > 0n) {
            movementId = randomUUID();
            stockEntries += 1;
            await tx.insert(inventoryMovements).values({
              id: movementId,
              organizationId: scope.organizationId,
              siteId: scope.siteId,
              materialItemId: entry.line.materialItemId,
              movementType: "Receipt/Inward",
              direction: "Inbound",
              quantity: toLedgerQuantity(entry.accepted),
              unitCode: entry.line.unitCode,
              sourceReference: `${grnNumber} / ${order.poNumber}`,
              reason: `Received against ${order.poNumber}${input.challanNumber ? `, challan ${input.challanNumber}` : ""}`,
              status: "Submitted",
              createdBy: ctx.user.id,
              clientMutationId: randomUUID(),
            });
          }
          await tx.insert(goodsReceiptLines).values({
            id: randomUUID(),
            goodsReceiptId: id,
            purchaseOrderLineId: entry.line.id,
            acceptedThousandths: entry.accepted.toString(),
            rejectedThousandths: entry.rejected.toString(),
            rejectReason: entry.rejectReason,
            inventoryMovementId: movementId,
          });
        }
        await audit(tx as unknown as Db, scope, ctx.user.id, {
          action: "purchase.goods_received",
          entityType: "purchase_order",
          entityId: order.id,
          clientMutationId: input.clientMutationId,
          after: { grnNumber, lines: entries.length, stockEntries },
        });
      });
      return { id, grnNumber, stockEntries };
    }),

  /** Supplier bills on this site from the order's supplier that are not linked yet. */
  linkableBills: protectedProcedure
    .input(z.object({ siteId: uuid, poId: uuid }))
    .query(async ({ ctx, input }) => {
      const scope = await getSiteScope(ctx.user, input.siteId, "purchase.view");
      const db = requireDb(await getDb());
      const order = await loadOrder(db, scope.siteId, input.poId);
      const bills = await db
        .select({
          id: supplierInvoices.id,
          invoiceNumber: supplierInvoices.invoiceNumber,
          invoiceDate: supplierInvoices.invoiceDate,
          totalMinor: supplierInvoices.totalMinor,
          status: supplierInvoices.status,
          linked: purchaseInvoiceLinks.purchaseOrderId,
        })
        .from(supplierInvoices)
        .leftJoin(purchaseInvoiceLinks, eq(purchaseInvoiceLinks.invoiceId, supplierInvoices.id))
        .where(
          and(
            eq(supplierInvoices.siteId, scope.siteId),
            eq(supplierInvoices.vendorId, order.vendorId),
          ),
        )
        .orderBy(desc(supplierInvoices.invoiceDate));
      return bills.filter((bill) => !bill.linked && bill.status !== "Rejected");
    }),

  /** Links a supplier bill to the order; the match (received vs billed) updates at once. */
  linkBill: protectedProcedure
    .input(z.object({ siteId: uuid, poId: uuid, invoiceId: uuid }))
    .mutation(async ({ ctx, input }) => {
      const scope = await getSiteScope(ctx.user, input.siteId, "purchase.create");
      const db = requireDb(await getDb());
      const order = await loadOrder(db, scope.siteId, input.poId);
      if (!["Approved", "Closed"].includes(order.status))
        bad("Bills can be matched only to an approved order.");
      const [invoice] = await db
        .select()
        .from(supplierInvoices)
        .where(eq(supplierInvoices.id, input.invoiceId));
      if (!invoice || invoice.siteId !== scope.siteId || invoice.vendorId !== order.vendorId)
        bad("That bill is not from this order's supplier on this site.");
      const [already] = await db
        .select()
        .from(purchaseInvoiceLinks)
        .where(eq(purchaseInvoiceLinks.invoiceId, invoice.id));
      if (already) {
        if (already.purchaseOrderId === order.id) return { ok: true };
        bad("That bill is already matched to another order.");
      }
      await db.transaction(async (tx) => {
        await tx.insert(purchaseInvoiceLinks).values({
          invoiceId: invoice.id,
          purchaseOrderId: order.id,
          linkedBy: ctx.user.id,
        });
        await audit(tx as unknown as Db, scope, ctx.user.id, {
          action: "purchase.bill_matched",
          entityType: "purchase_order",
          entityId: order.id,
          after: { invoiceNumber: invoice.invoiceNumber },
        });
      });
      return { ok: true };
    }),
});
