import { randomUUID } from "node:crypto";
import { and, desc, eq, inArray } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import {
  auditEvents,
  inventoryMovements,
  materialItems,
  purchaseOrders,
  purchaseReturnLines,
  purchaseReturns,
  sites,
  vendors,
} from "../../drizzle/schema";
import {
  RETURN_SETTLEMENTS,
  canMoveReturn,
  lineAmountMinor,
  returnNumber,
  rupeesToPaise,
  type ReturnStatus,
} from "../../lib/jp/return-domain";
import { parseStockQuantity } from "../../lib/jp/inventory-domain";
import { protectedProcedure, router } from "../_core/trpc";
import { getDb } from "../db";
import { getSiteScope, selfApprovalAllowed } from "./access";

function requireDb(db: Awaited<ReturnType<typeof getDb>>) {
  if (!db)
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message: "The business data service is temporarily unavailable.",
    });
  return db;
}
const bad = (message: string): never => {
  throw new TRPCError({ code: "BAD_REQUEST", message });
};
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use a date like 2026-11-14.");
const mutationId = z.string().trim().min(16).max(64);

async function loadReturn(returnId: string) {
  const db = requireDb(await getDb());
  const [row] = await db
    .select()
    .from(purchaseReturns)
    .where(eq(purchaseReturns.id, returnId))
    .limit(1);
  if (!row) throw new TRPCError({ code: "NOT_FOUND", message: "Return not found." });
  return { db, row };
}

function move(from: string, to: ReturnStatus) {
  if (!canMoveReturn(from as ReturnStatus, to))
    bad(`A ${from.toLowerCase()} return cannot become ${to.toLowerCase()}.`);
}

/**
 * Returns to suppliers (damaged, wrong or extra goods) and how the supplier settled them:
 * refund, credit note or replacement. Make with purchase.create; a different person with
 * purchase.approve approves, which sends stock lines to the store as Return to Supplier
 * movements for the store to post; then the settlement is recorded.
 */
export const purchaseReturnsRouter = router({
  list: protectedProcedure
    .input(z.object({ siteId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const scope = await getSiteScope(ctx.user, input.siteId, "purchase.view");
      const db = requireDb(await getDb());
      return db
        .select({ ret: purchaseReturns, vendorName: vendors.legalName })
        .from(purchaseReturns)
        .innerJoin(vendors, eq(purchaseReturns.vendorId, vendors.id))
        .where(eq(purchaseReturns.siteId, scope.siteId))
        .orderBy(desc(purchaseReturns.createdAt))
        .limit(200)
        .then((rows) => rows.map(({ ret, vendorName }) => ({ ...ret, vendorName })));
    }),

  detail: protectedProcedure
    .input(z.object({ returnId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const { db, row } = await loadReturn(input.returnId);
      await getSiteScope(ctx.user, row.siteId, "purchase.view");
      const lines = await db
        .select()
        .from(purchaseReturnLines)
        .where(eq(purchaseReturnLines.returnId, row.id));
      return { ...row, lines };
    }),

  create: protectedProcedure
    .input(
      z.object({
        siteId: z.string().uuid(),
        vendorId: z.string().uuid(),
        purchaseOrderId: z.string().uuid().nullish(),
        returnDate: date,
        reason: z.string().trim().min(3).max(2000),
        lines: z
          .array(
            z.object({
              materialItemId: z.string().uuid().nullish(),
              description: z.string().trim().min(2).max(240),
              unitCode: z.string().trim().min(1).max(32),
              quantity: z.string().trim(),
              rateRupees: z.string().trim(),
            }),
          )
          .min(1)
          .max(50),
        clientMutationId: mutationId,
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const scope = await getSiteScope(ctx.user, input.siteId, "purchase.create");
      const db = requireDb(await getDb());
      const [prior] = await db
        .select({ id: purchaseReturns.id, returnNumber: purchaseReturns.returnNumber })
        .from(purchaseReturns)
        .where(
          and(
            eq(purchaseReturns.createdBy, ctx.user.id),
            eq(purchaseReturns.clientMutationId, input.clientMutationId),
          ),
        )
        .limit(1);
      if (prior) return { ...prior, replayed: true };
      const [vendor] = await db
        .select()
        .from(vendors)
        .where(eq(vendors.id, input.vendorId))
        .limit(1);
      if (vendor?.organizationId !== scope.organizationId)
        bad("Choose a supplier of this company.");
      if (input.purchaseOrderId) {
        const [po] = await db
          .select({ siteId: purchaseOrders.siteId, vendorId: purchaseOrders.vendorId })
          .from(purchaseOrders)
          .where(eq(purchaseOrders.id, input.purchaseOrderId))
          .limit(1);
        if (po?.siteId !== scope.siteId || po.vendorId !== input.vendorId)
          bad("The purchase order must be this site's, from this supplier.");
      }
      const itemIds = input.lines.flatMap((line) =>
        line.materialItemId ? [line.materialItemId] : [],
      );
      const items = itemIds.length
        ? await db.select().from(materialItems).where(inArray(materialItems.id, itemIds))
        : [];
      const lines = input.lines.map((line) => {
        try {
          parseStockQuantity(line.quantity);
        } catch {
          bad(`Check the quantity for ${line.description}.`);
        }
        const rateMinor = rupeesToPaise(line.rateRupees);
        if (rateMinor === null) bad(`Check the rate for ${line.description}.`);
        const item = line.materialItemId
          ? items.find((row) => row.id === line.materialItemId)
          : null;
        if (line.materialItemId && item?.organizationId !== scope.organizationId)
          bad("A store item is not from this company.");
        return {
          ...line,
          unitCode: item?.baseUnitCode ?? line.unitCode,
          rateMinor: rateMinor!,
          amountMinor: lineAmountMinor(line.quantity, rateMinor!),
        };
      });
      const totalMinor = lines.reduce((sum, line) => sum + line.amountMinor, 0n);
      const [site] = await db
        .select({ code: sites.siteCode })
        .from(sites)
        .where(eq(sites.id, scope.siteId))
        .limit(1);
      const id = randomUUID();
      let number = "";
      await db.transaction(async (tx) => {
        const existing = await tx
          .select({ id: purchaseReturns.id })
          .from(purchaseReturns)
          .where(eq(purchaseReturns.siteId, scope.siteId))
          .for("update");
        number = returnNumber(site?.code ?? "SITE", existing.length + 1);
        await tx.insert(purchaseReturns).values({
          id,
          organizationId: scope.organizationId,
          siteId: scope.siteId,
          vendorId: input.vendorId,
          purchaseOrderId: input.purchaseOrderId ?? null,
          returnNumber: number,
          returnDate: input.returnDate,
          reason: input.reason,
          totalMinor: totalMinor.toString(),
          createdBy: ctx.user.id,
          clientMutationId: input.clientMutationId,
        });
        await tx.insert(purchaseReturnLines).values(
          lines.map((line) => ({
            id: randomUUID(),
            returnId: id,
            materialItemId: line.materialItemId ?? null,
            description: line.description,
            unitCode: line.unitCode,
            quantity: line.quantity,
            rateMinor: line.rateMinor.toString(),
            amountMinor: line.amountMinor.toString(),
          })),
        );
        await tx.insert(auditEvents).values({
          id: randomUUID(),
          organizationId: scope.organizationId,
          siteId: scope.siteId,
          actorUserId: ctx.user.id,
          action: "purchase_return.created",
          entityType: "purchase_return",
          entityId: id,
          clientMutationId: input.clientMutationId,
          afterSummary: JSON.stringify({ returnNumber: number, totalMinor: totalMinor.toString() }),
          reason: input.reason,
        });
      });
      return { id, returnNumber: number, replayed: false };
    }),

  review: protectedProcedure
    .input(
      z.object({
        returnId: z.string().uuid(),
        decision: z.enum(["Approve", "Reject"]),
        reason: z.string().trim().max(1000).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const { db, row } = await loadReturn(input.returnId);
      const scope = await getSiteScope(ctx.user, row.siteId, "purchase.approve");
      if (row.createdBy === ctx.user.id && !(await selfApprovalAllowed(ctx.user, row.siteId)))
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "Another person must approve a return you made.",
        });
      const to: ReturnStatus = input.decision === "Approve" ? "Approved" : "Rejected";
      if (row.status === to) return { id: row.id, status: to };
      move(row.status, to);
      if (to === "Rejected" && !input.reason?.trim()) bad("Give a reason to reject.");
      const lines = await db
        .select()
        .from(purchaseReturnLines)
        .where(eq(purchaseReturnLines.returnId, row.id));
      await db.transaction(async (tx) => {
        await tx
          .update(purchaseReturns)
          .set({
            status: to,
            reviewedBy: ctx.user.id,
            reviewedAt: new Date(),
            reviewReason: input.reason ?? null,
          })
          .where(eq(purchaseReturns.id, row.id));
        // Stock lines leave the store through the normal review: the store posts them.
        if (to === "Approved")
          for (const line of lines) {
            if (!line.materialItemId) continue;
            const movementId = randomUUID();
            await tx.insert(inventoryMovements).values({
              id: movementId,
              organizationId: scope.organizationId,
              siteId: scope.siteId,
              materialItemId: line.materialItemId,
              movementType: "Return to Supplier",
              direction: "Outbound",
              quantity: line.quantity,
              unitCode: line.unitCode,
              sourceReference: row.returnNumber,
              reason: `Returned to supplier: ${row.reason}`.slice(0, 1000),
              status: "Submitted",
              createdBy: ctx.user.id,
              clientMutationId: `ret-${movementId}`.slice(0, 64),
            });
            await tx
              .update(purchaseReturnLines)
              .set({ movementId })
              .where(eq(purchaseReturnLines.id, line.id));
          }
        await tx.insert(auditEvents).values({
          id: randomUUID(),
          organizationId: row.organizationId,
          siteId: row.siteId,
          actorUserId: ctx.user.id,
          action: to === "Approved" ? "purchase_return.approved" : "purchase_return.rejected",
          entityType: "purchase_return",
          entityId: row.id,
          reason: input.reason ?? null,
        });
      });
      return { id: row.id, status: to };
    }),

  settle: protectedProcedure
    .input(
      z.object({
        returnId: z.string().uuid(),
        settlement: z.enum(RETURN_SETTLEMENTS),
        amountRupees: z.string().trim(),
        reference: z.string().trim().max(120).optional(),
        settledOn: date,
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const { db, row } = await loadReturn(input.returnId);
      await getSiteScope(ctx.user, row.siteId, "purchase.create");
      if (row.status === "Settled") return { id: row.id, status: "Settled" as const };
      move(row.status, "Settled");
      const amount = rupeesToPaise(input.amountRupees);
      if (amount === null) bad("Check the amount.");
      if (input.settlement !== "Replacement" && amount! <= 0n)
        bad("Enter the amount refunded or credited.");
      if (amount! > BigInt(row.totalMinor)) bad("The amount is more than the value returned.");
      await db.transaction(async (tx) => {
        await tx
          .update(purchaseReturns)
          .set({
            status: "Settled",
            settlement: input.settlement,
            settledMinor: amount!.toString(),
            settlementReference: input.reference ?? null,
            settledOn: input.settledOn,
            settledBy: ctx.user.id,
          })
          .where(eq(purchaseReturns.id, row.id));
        await tx.insert(auditEvents).values({
          id: randomUUID(),
          organizationId: row.organizationId,
          siteId: row.siteId,
          actorUserId: ctx.user.id,
          action: "purchase_return.settled",
          entityType: "purchase_return",
          entityId: row.id,
          afterSummary: JSON.stringify({
            settlement: input.settlement,
            amountMinor: amount!.toString(),
          }),
        });
      });
      return { id: row.id, status: "Settled" as const };
    }),

  cancel: protectedProcedure
    .input(z.object({ returnId: z.string().uuid(), reason: z.string().trim().min(3).max(500) }))
    .mutation(async ({ ctx, input }) => {
      const { db, row } = await loadReturn(input.returnId);
      await getSiteScope(ctx.user, row.siteId, "purchase.create");
      if (row.createdBy !== ctx.user.id)
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "Only the person who made it can cancel.",
        });
      if (row.status === "Cancelled") return { id: row.id };
      move(row.status, "Cancelled");
      await db.transaction(async (tx) => {
        await tx
          .update(purchaseReturns)
          .set({ status: "Cancelled" })
          .where(eq(purchaseReturns.id, row.id));
        await tx.insert(auditEvents).values({
          id: randomUUID(),
          organizationId: row.organizationId,
          siteId: row.siteId,
          actorUserId: ctx.user.id,
          action: "purchase_return.cancelled",
          entityType: "purchase_return",
          entityId: row.id,
          reason: input.reason,
        });
      });
      return { id: row.id };
    }),
});
