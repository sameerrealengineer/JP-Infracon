import { randomUUID } from "node:crypto";
import { and, asc, count, desc, eq, gte, isNull, lte, ne, or, sql } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import {
  auditEvents,
  inventoryMovements,
  materialItems,
  permissionGrants,
  users,
} from "../../drizzle/schema";
import {
  canPostWithoutNegativeStock,
  directionForMovement,
  formatStockQuantity,
  isAtOrBelowReorderThreshold,
  normalizeStockQuantity,
  parseStockQuantity,
  type InventoryMovementType,
} from "../../lib/jp/inventory-domain";
import { getDb } from "../db";
import { protectedProcedure, router } from "../_core/trpc";
import { getSiteScope } from "./access";
import { resolveOrganizationPermission, type PermissionGrantForResolution } from "./policy";

const movementTypes = [
  "Receipt/Inward",
  "Issue/Consumption",
  "Return to Store",
  "Wastage",
  "Damage",
] as const;
const uuidSchema = z.string().uuid();
const mutationIdSchema = z.string().trim().min(16).max(64);
const quantitySchema = z
  .string()
  .trim()
  .regex(/^\d{1,11}(?:\.\d{1,3})?$/)
  .refine((value) => {
    try {
      parseStockQuantity(value);
      return true;
    } catch {
      return false;
    }
  }, "Quantity must be greater than zero and have at most three decimal places.");
const unitCodeSchema = z
  .string()
  .trim()
  .min(1)
  .max(32)
  .regex(/^[A-Za-z0-9][A-Za-z0-9/_-]*$/);
const reasonSchema = z.string().trim().min(3).max(1000);

function requireDb(db: Awaited<ReturnType<typeof getDb>>) {
  if (!db)
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message: "The business data service is temporarily unavailable.",
    });
  return db;
}

function safeRequestId(value: string | string[] | undefined) {
  return typeof value === "string" && value.length <= 100 ? value : undefined;
}

async function findMutationEvent(
  queryable: any,
  actorUserId: number,
  clientMutationId: string,
  lock = false,
) {
  const condition = and(
    eq(auditEvents.actorUserId, actorUserId),
    eq(auditEvents.clientMutationId, clientMutationId),
  );
  if (lock) {
    const [event] = await queryable
      .select()
      .from(auditEvents)
      .where(condition)
      .for("update")
      .limit(1);
    return event ?? null;
  }
  const [event] = await queryable.select().from(auditEvents).where(condition).limit(1);
  return event ?? null;
}

function verifyMutationEvent(
  event: typeof auditEvents.$inferSelect,
  expected: {
    action: string;
    entityType: string;
    entityId?: string;
    afterSummary: string;
    reason: string | null;
  },
) {
  if (
    event.action !== expected.action ||
    event.entityType !== expected.entityType ||
    (expected.entityId !== undefined && event.entityId !== expected.entityId) ||
    event.afterSummary !== expected.afterSummary ||
    event.reason !== expected.reason
  ) {
    throw new TRPCError({
      code: "CONFLICT",
      message: "This inventory retry key is already associated with a different action or payload.",
    });
  }
}

async function recordInventoryAudit(
  tx: any,
  input: {
    organizationId: string;
    siteId: string;
    actorUserId: number;
    action: string;
    entityType: string;
    entityId: string;
    clientMutationId: string;
    requestId?: string;
    beforeSummary?: string;
    afterSummary: string;
    reason?: string | null;
  },
) {
  await tx.insert(auditEvents).values({ id: randomUUID(), ...input });
}

async function postedBalance(
  queryable: any,
  organizationId: string,
  siteId: string,
  materialItemId: string,
) {
  const [result] = await queryable
    .select({
      balance: sql<string>`COALESCE(SUM(CASE WHEN ${inventoryMovements.direction} = 'Inbound' THEN ${inventoryMovements.quantity} ELSE -${inventoryMovements.quantity} END), 0)`,
    })
    .from(inventoryMovements)
    .where(
      and(
        eq(inventoryMovements.organizationId, organizationId),
        eq(inventoryMovements.siteId, siteId),
        eq(inventoryMovements.materialItemId, materialItemId),
        eq(inventoryMovements.status, "Posted"),
      ),
    );
  return formatStockQuantity(String(result?.balance ?? "0"));
}

function sameItemPayload(
  existing: typeof materialItems.$inferSelect,
  input: {
    organizationId: string;
    createdBy: number;
    itemCode: string;
    name: string;
    category: string | null;
    specification: string | null;
    baseUnitCode: string;
    reorderThreshold: string | null;
    clientMutationId: string;
  },
) {
  const existingThreshold =
    existing.reorderThreshold === null
      ? null
      : normalizeStockQuantity(String(existing.reorderThreshold), true);
  return (
    existing.organizationId === input.organizationId &&
    existing.createdBy === input.createdBy &&
    existing.itemCode === input.itemCode &&
    existing.name === input.name &&
    existing.category === input.category &&
    existing.specification === input.specification &&
    existing.baseUnitCode === input.baseUnitCode &&
    existingThreshold === input.reorderThreshold &&
    existing.clientMutationId === input.clientMutationId
  );
}

export const inventoryRouter = router({
  list: protectedProcedure
    .input(
      z.object({
        siteId: uuidSchema,
        catalogueOffset: z.number().int().min(0).max(1_000_000).default(0),
      }),
    )
    .query(async ({ ctx, input }) => {
      const scope = await getSiteScope(ctx.user, input.siteId, "inventory.view");
      const db = requireDb(await getDb());
      const [catalogue, catalogueCountRows] = await Promise.all([
        db
          .select()
          .from(materialItems)
          .where(eq(materialItems.organizationId, scope.organizationId))
          .orderBy(desc(materialItems.createdAt), asc(materialItems.name))
          .limit(100)
          .offset(input.catalogueOffset),
        db
          .select({ total: count() })
          .from(materialItems)
          .where(eq(materialItems.organizationId, scope.organizationId)),
      ]);
      const catalogueTotal = Number(catalogueCountRows[0]?.total ?? 0);
      const balanceRows = await db
        .select({
          materialItemId: inventoryMovements.materialItemId,
          balance: sql<string>`COALESCE(SUM(CASE WHEN ${inventoryMovements.direction} = 'Inbound' THEN ${inventoryMovements.quantity} ELSE -${inventoryMovements.quantity} END), 0)`,
        })
        .from(inventoryMovements)
        .where(
          and(
            eq(inventoryMovements.organizationId, scope.organizationId),
            eq(inventoryMovements.siteId, scope.siteId),
            eq(inventoryMovements.status, "Posted"),
          ),
        )
        .groupBy(inventoryMovements.materialItemId);
      const balanceByItem = new Map(
        balanceRows.map((row) => [
          row.materialItemId,
          formatStockQuantity(String(row.balance ?? "0")),
        ]),
      );
      const movementQuery = () =>
        db
          .select({
            id: inventoryMovements.id,
            materialItemId: inventoryMovements.materialItemId,
            itemName: materialItems.name,
            itemCode: materialItems.itemCode,
            movementType: inventoryMovements.movementType,
            direction: inventoryMovements.direction,
            quantity: inventoryMovements.quantity,
            unitCode: inventoryMovements.unitCode,
            sourceReference: inventoryMovements.sourceReference,
            reason: inventoryMovements.reason,
            status: inventoryMovements.status,
            creatorName: users.name,
            createdAt: inventoryMovements.createdAt,
            reviewedAt: inventoryMovements.reviewedAt,
            postedAt: inventoryMovements.postedAt,
            reviewNote: inventoryMovements.reviewNote,
          })
          .from(inventoryMovements)
          .innerJoin(materialItems, eq(inventoryMovements.materialItemId, materialItems.id))
          .innerJoin(users, eq(inventoryMovements.createdBy, users.id));
      const movementScope = () =>
        and(
          eq(inventoryMovements.organizationId, scope.organizationId),
          eq(inventoryMovements.siteId, scope.siteId),
        );
      const [pendingRows, recentHistoryRows, pendingCountRows] = await Promise.all([
        movementQuery()
          .where(and(movementScope(), eq(inventoryMovements.status, "Submitted")))
          .orderBy(asc(inventoryMovements.createdAt))
          .limit(200),
        movementQuery()
          .where(and(movementScope(), ne(inventoryMovements.status, "Submitted")))
          .orderBy(desc(inventoryMovements.createdAt))
          .limit(100),
        db
          .select({ total: count() })
          .from(inventoryMovements)
          .where(and(movementScope(), eq(inventoryMovements.status, "Submitted"))),
      ]);
      const movementRows = [...pendingRows, ...recentHistoryRows];
      const pendingReviewCount = Number(pendingCountRows[0]?.total ?? 0);

      return {
        site: { id: scope.siteId, name: scope.siteName, project: scope.projectName },
        catalogueTotal,
        catalogue: catalogue.map((item) => {
          const onHand = balanceByItem.get(item.id) ?? "0";
          return {
            id: item.id,
            itemCode: item.itemCode,
            name: item.name,
            category: item.category,
            specification: item.specification,
            baseUnitCode: item.baseUnitCode,
            reorderThreshold: item.reorderThreshold,
            status: item.status,
            onHand,
            atOrBelowReorder:
              item.status === "Active" &&
              isAtOrBelowReorderThreshold(onHand, item.reorderThreshold),
          };
        }),
        movements: movementRows,
        pendingReviewCount,
      };
    }),

  createItem: protectedProcedure
    .input(
      z.object({
        siteId: uuidSchema,
        itemCode: z
          .string()
          .trim()
          .min(2)
          .max(48)
          .regex(/^[A-Za-z0-9][A-Za-z0-9._-]*$/),
        name: z.string().trim().min(2).max(180),
        category: z.string().trim().max(80).optional(),
        specification: z.string().trim().max(180).optional(),
        baseUnitCode: unitCodeSchema,
        reorderThreshold: z
          .string()
          .trim()
          .regex(/^\d{1,11}(?:\.\d{1,3})?$/)
          .optional(),
        clientMutationId: mutationIdSchema,
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const scope = await getSiteScope(ctx.user, input.siteId, "inventory.catalog.manage");
      await getSiteScope(ctx.user, input.siteId, "inventory.view");
      const db = requireDb(await getDb());
      const authorityTime = new Date();
      const activeOrganizationGrants = await db
        .select()
        .from(permissionGrants)
        .where(
          and(
            eq(permissionGrants.organizationId, scope.organizationId),
            eq(permissionGrants.userId, ctx.user.id),
            eq(permissionGrants.permissionKey, "inventory.catalog.manage"),
            eq(permissionGrants.status, "Active"),
            lte(permissionGrants.effectiveFrom, authorityTime),
            or(
              isNull(permissionGrants.effectiveTo),
              gte(permissionGrants.effectiveTo, authorityTime),
            ),
          ),
        );
      if (
        !resolveOrganizationPermission({
          role: scope.businessRole,
          permissionKey: "inventory.catalog.manage",
          organizationId: scope.organizationId,
          grants: activeOrganizationGrants as PermissionGrantForResolution[],
          now: authorityTime,
        })
      ) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message:
            "The materials catalogue is organisation-wide and requires organisation-level catalogue authority.",
        });
      }
      const itemCode = input.itemCode.toUpperCase();
      const category = input.category || null;
      const specification = input.specification || null;
      const baseUnitCode = input.baseUnitCode.trim();
      const reorderThreshold =
        input.reorderThreshold === undefined
          ? null
          : normalizeStockQuantity(input.reorderThreshold, true);
      const payload = {
        itemCode,
        name: input.name,
        category,
        specification,
        baseUnitCode,
        reorderThreshold,
        status: "Active",
      };
      const afterSummary = JSON.stringify(payload);
      const expectedEvent = {
        action: "inventory.catalogue.created",
        entityType: "material_item",
        afterSummary,
        reason: null,
      };
      const replay = await findMutationEvent(db, ctx.user.id, input.clientMutationId);
      if (replay) {
        verifyMutationEvent(replay, expectedEvent);
        const [row] = await db
          .select()
          .from(materialItems)
          .where(eq(materialItems.id, replay.entityId))
          .limit(1);
        if (
          !row ||
          !sameItemPayload(row, {
            organizationId: scope.organizationId,
            createdBy: ctx.user.id,
            ...payload,
            clientMutationId: input.clientMutationId,
          })
        ) {
          throw new TRPCError({
            code: "CONFLICT",
            message:
              "The inventory item retry key no longer matches its original catalogue record.",
          });
        }
        return { id: row.id, status: row.status };
      }

      const itemId = randomUUID();
      try {
        await db.transaction(async (tx) => {
          const [prior] = await tx
            .select()
            .from(materialItems)
            .where(eq(materialItems.clientMutationId, input.clientMutationId))
            .limit(1);
          if (prior) {
            if (
              !sameItemPayload(prior, {
                organizationId: scope.organizationId,
                createdBy: ctx.user.id,
                ...payload,
                clientMutationId: input.clientMutationId,
              })
            ) {
              throw new TRPCError({
                code: "CONFLICT",
                message: "This item retry key belongs to a different catalogue record.",
              });
            }
            return;
          }
          const [codeConflict] = await tx
            .select({ id: materialItems.id })
            .from(materialItems)
            .where(
              and(
                eq(materialItems.organizationId, scope.organizationId),
                eq(materialItems.itemCode, itemCode),
              ),
            )
            .limit(1);
          if (codeConflict)
            throw new TRPCError({
              code: "CONFLICT",
              message: "That material code already exists in this organisation.",
            });
          await tx.insert(materialItems).values({
            id: itemId,
            organizationId: scope.organizationId,
            itemCode,
            name: input.name,
            category,
            specification,
            baseUnitCode,
            reorderThreshold,
            clientMutationId: input.clientMutationId,
            createdBy: ctx.user.id,
            status: "Active",
          });
          await recordInventoryAudit(tx, {
            organizationId: scope.organizationId,
            siteId: scope.siteId,
            actorUserId: ctx.user.id,
            action: "inventory.catalogue.created",
            entityType: "material_item",
            entityId: itemId,
            clientMutationId: input.clientMutationId,
            requestId: safeRequestId(ctx.req.headers["x-request-id"]),
            afterSummary,
          });
        });
      } catch (error) {
        if (error instanceof TRPCError) throw error;
        console.error("[JP] Material catalogue item could not be saved");
        throw new TRPCError({
          code: "CONFLICT",
          message:
            "The material code or retry key is already in use. Check the catalogue and retry.",
        });
      }
      const [created] = await db
        .select({ id: materialItems.id, status: materialItems.status })
        .from(materialItems)
        .where(eq(materialItems.clientMutationId, input.clientMutationId))
        .limit(1);
      if (!created)
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "The catalogue item could not be confirmed after saving.",
        });
      return created;
    }),

  submitMovement: protectedProcedure
    .input(
      z.object({
        siteId: uuidSchema,
        materialItemId: uuidSchema,
        movementType: z.enum(movementTypes),
        quantity: quantitySchema,
        sourceReference: z.string().trim().max(180).optional(),
        reason: reasonSchema,
        clientMutationId: mutationIdSchema,
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const scope = await getSiteScope(ctx.user, input.siteId, "inventory.transact");
      await getSiteScope(ctx.user, input.siteId, "inventory.view");
      const db = requireDb(await getDb());
      const [item] = await db
        .select()
        .from(materialItems)
        .where(
          and(
            eq(materialItems.id, input.materialItemId),
            eq(materialItems.organizationId, scope.organizationId),
            eq(materialItems.status, "Active"),
          ),
        )
        .limit(1);
      if (!item)
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "That active material item is not available in this organisation.",
        });

      const quantity = normalizeStockQuantity(input.quantity);
      const direction = directionForMovement(input.movementType as InventoryMovementType);
      const sourceReference = input.sourceReference || null;
      const afterSummary = JSON.stringify({
        siteId: scope.siteId,
        materialItemId: item.id,
        movementType: input.movementType,
        direction,
        quantity,
        unitCode: item.baseUnitCode,
        sourceReference,
        status: "Submitted",
      });
      const expectedEvent = {
        action: "inventory.movement.submitted",
        entityType: "inventory_movement",
        afterSummary,
        reason: input.reason,
      };
      const replay = await findMutationEvent(db, ctx.user.id, input.clientMutationId);
      if (replay) {
        verifyMutationEvent(replay, expectedEvent);
        const [row] = await db
          .select({ id: inventoryMovements.id, status: inventoryMovements.status })
          .from(inventoryMovements)
          .where(eq(inventoryMovements.id, replay.entityId))
          .limit(1);
        if (!row)
          throw new TRPCError({
            code: "CONFLICT",
            message: "The movement retry key no longer has a matching ledger record.",
          });
        return row;
      }

      const movementId = randomUUID();
      try {
        await db.transaction(async (tx) => {
          const prior = await findMutationEvent(tx, ctx.user.id, input.clientMutationId, true);
          if (prior) {
            verifyMutationEvent(prior, expectedEvent);
            return;
          }
          await tx.insert(inventoryMovements).values({
            id: movementId,
            organizationId: scope.organizationId,
            siteId: scope.siteId,
            materialItemId: item.id,
            movementType: input.movementType,
            direction,
            quantity,
            unitCode: item.baseUnitCode,
            sourceReference,
            reason: input.reason,
            status: "Submitted",
            createdBy: ctx.user.id,
            clientMutationId: input.clientMutationId,
          });
          await recordInventoryAudit(tx, {
            organizationId: scope.organizationId,
            siteId: scope.siteId,
            actorUserId: ctx.user.id,
            action: "inventory.movement.submitted",
            entityType: "inventory_movement",
            entityId: movementId,
            clientMutationId: input.clientMutationId,
            requestId: safeRequestId(ctx.req.headers["x-request-id"]),
            afterSummary,
            reason: input.reason,
          });
        });
      } catch (error) {
        if (error instanceof TRPCError) throw error;
        console.error("[JP] Inventory movement could not be submitted");
        const retryEvent = await findMutationEvent(db, ctx.user.id, input.clientMutationId);
        if (retryEvent) {
          verifyMutationEvent(retryEvent, expectedEvent);
          const [row] = await db
            .select({ id: inventoryMovements.id, status: inventoryMovements.status })
            .from(inventoryMovements)
            .where(eq(inventoryMovements.id, retryEvent.entityId))
            .limit(1);
          if (row) return row;
        }
        throw new TRPCError({
          code: "CONFLICT",
          message:
            "The movement could not be saved. Check the item and retry; the idempotency key prevents duplicate movements.",
        });
      }
      return { id: movementId, status: "Submitted" as const };
    }),

  reviewMovement: protectedProcedure
    .input(
      z
        .object({
          movementId: uuidSchema,
          decision: z.enum(["Post", "Reject"]),
          reason: z.string().trim().max(1000).optional(),
          clientMutationId: mutationIdSchema,
        })
        .refine((input) => input.decision === "Post" || Boolean(input.reason?.trim()), {
          message: "A reason is required when rejecting a movement.",
          path: ["reason"],
        }),
    )
    .mutation(async ({ ctx, input }) => {
      const db = requireDb(await getDb());
      const [initial] = await db
        .select()
        .from(inventoryMovements)
        .where(eq(inventoryMovements.id, input.movementId))
        .limit(1);
      if (!initial)
        throw new TRPCError({ code: "NOT_FOUND", message: "Inventory movement not found." });
      const scope = await getSiteScope(ctx.user, initial.siteId, "inventory.review");
      await getSiteScope(ctx.user, initial.siteId, "inventory.view");
      if (scope.organizationId !== initial.organizationId)
        throw new TRPCError({ code: "NOT_FOUND", message: "Inventory movement not found." });
      if (initial.createdBy === ctx.user.id)
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "The person who submitted this movement cannot review or post it.",
        });

      const targetStatus = input.decision === "Post" ? "Posted" : "Rejected";
      const action =
        input.decision === "Post" ? "inventory.movement.posted" : "inventory.movement.rejected";
      const reason = input.reason?.trim() || null;
      const afterSummary = JSON.stringify({ status: targetStatus });
      const expectedEvent = {
        action,
        entityType: "inventory_movement",
        entityId: input.movementId,
        afterSummary,
        reason,
      };
      const replay = await findMutationEvent(db, ctx.user.id, input.clientMutationId);
      if (replay) {
        verifyMutationEvent(replay, expectedEvent);
        return { id: input.movementId, status: targetStatus };
      }

      return db.transaction(async (tx) => {
        const [lockedItem] = await tx
          .select({ id: materialItems.id })
          .from(materialItems)
          .where(
            and(
              eq(materialItems.id, initial.materialItemId),
              eq(materialItems.organizationId, scope.organizationId),
            ),
          )
          .for("update")
          .limit(1);
        if (!lockedItem)
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "The material item for this movement no longer exists.",
          });

        const prior = await findMutationEvent(tx, ctx.user.id, input.clientMutationId, true);
        if (prior) {
          verifyMutationEvent(prior, expectedEvent);
          return { id: input.movementId, status: targetStatus };
        }
        const [lockedMovement] = await tx
          .select()
          .from(inventoryMovements)
          .where(
            and(
              eq(inventoryMovements.id, input.movementId),
              eq(inventoryMovements.organizationId, scope.organizationId),
            ),
          )
          .for("update")
          .limit(1);
        if (!lockedMovement)
          throw new TRPCError({ code: "NOT_FOUND", message: "Inventory movement not found." });
        if (lockedMovement.createdBy === ctx.user.id)
          throw new TRPCError({
            code: "FORBIDDEN",
            message: "The person who submitted this movement cannot review or post it.",
          });
        if (lockedMovement.status !== "Submitted")
          throw new TRPCError({
            code: "PRECONDITION_FAILED",
            message: "Only a submitted movement can be reviewed; this record has already changed.",
          });

        if (input.decision === "Post" && lockedMovement.direction === "Outbound") {
          const balance = await postedBalance(
            tx,
            scope.organizationId,
            scope.siteId,
            lockedMovement.materialItemId,
          );
          if (!canPostWithoutNegativeStock(balance, lockedMovement.quantity)) {
            throw new TRPCError({
              code: "PRECONDITION_FAILED",
              message: `This movement would make available stock negative. Current posted balance: ${balance} ${lockedMovement.unitCode}. No stock was changed.`,
            });
          }
        }

        const now = new Date();
        await tx
          .update(inventoryMovements)
          .set({
            status: targetStatus,
            reviewedBy: ctx.user.id,
            reviewedAt: now,
            reviewNote: reason,
            postedBy: input.decision === "Post" ? ctx.user.id : null,
            postedAt: input.decision === "Post" ? now : null,
            updatedAt: now,
          })
          .where(eq(inventoryMovements.id, lockedMovement.id));
        await recordInventoryAudit(tx, {
          organizationId: scope.organizationId,
          siteId: scope.siteId,
          actorUserId: ctx.user.id,
          action,
          entityType: "inventory_movement",
          entityId: lockedMovement.id,
          clientMutationId: input.clientMutationId,
          requestId: safeRequestId(ctx.req.headers["x-request-id"]),
          beforeSummary: JSON.stringify({ status: lockedMovement.status }),
          afterSummary,
          reason,
        });
        return { id: lockedMovement.id, status: targetStatus };
      });
    }),
});
