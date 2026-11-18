import { randomUUID } from "node:crypto";
import { and, asc, desc, eq, inArray } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import {
  auditEvents,
  clientBillLines,
  clientBills,
  contractItems,
  deptMeasurements,
  projects,
} from "../../drizzle/schema";
import { mbAbstract, netByItem } from "../../lib/jp/dept-mb";
import { measuredQuantity } from "../../lib/jp/subcontract-domain";
import { protectedProcedure, router } from "../_core/trpc";
import { commercialAccess, requireProject, type Db } from "./commercial-access";

const mutationIdSchema = z.string().trim().min(16).max(64);
const dateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const dim = z.string().trim().max(20).optional();

function todayIst() {
  return new Date(Date.now() + 330 * 60_000).toISOString().slice(0, 10);
}

/** Billed quantity per contract item on the project (draft, submitted and approved bills). */
async function billedByItem(db: Db, projectId: string) {
  const rows = await db
    .select({
      itemId: clientBillLines.contractItemId,
      quantity: clientBillLines.quantityThousandths,
    })
    .from(clientBillLines)
    .innerJoin(clientBills, eq(clientBillLines.billId, clientBills.id))
    .where(
      and(
        eq(clientBills.projectId, projectId),
        inArray(clientBills.status, ["Draft", "Submitted", "Approved"]),
      ),
    );
  const map = new Map<string, bigint>();
  for (const row of rows)
    if (row.itemId) map.set(row.itemId, (map.get(row.itemId) ?? 0n) + BigInt(row.quantity));
  return map;
}

/**
 * Signed MB quantity per item, or null when the project does not keep its department MB in the
 * app (then billing works as before). Used by client billing to refuse unsigned quantities.
 */
export async function signedMbLimits(
  db: Db,
  projectId: string,
): Promise<Map<string, bigint> | null> {
  const rows = await db
    .select({
      contractItemId: deptMeasurements.contractItemId,
      quantityThousandths: deptMeasurements.quantityThousandths,
      deduction: deptMeasurements.deduction,
      status: deptMeasurements.status,
    })
    .from(deptMeasurements)
    .where(eq(deptMeasurements.projectId, projectId))
    .catch(() => []);
  if (!rows.length) return null;
  return netByItem(
    rows.map((row) => ({ ...row, quantityThousandths: String(row.quantityThousandths) })),
    ["Signed"],
  );
}

/**
 * Department measurement book per project: record measurements against the contract BOQ,
 * record the department engineer's signature (or a rejection), see the abstract per item.
 * Company level via client billing permissions.
 */
export const deptMbRouter = router({
  list: protectedProcedure
    .input(z.object({ projectId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const access = await commercialAccess(ctx.user, "billing.view");
      requireProject(access, input.projectId);
      const db = access.db;
      const [items, entries, billed, [project]] = await Promise.all([
        db
          .select()
          .from(contractItems)
          .where(
            and(eq(contractItems.projectId, input.projectId), eq(contractItems.status, "Active")),
          )
          .orderBy(asc(contractItems.itemCode)),
        db
          .select()
          .from(deptMeasurements)
          .where(eq(deptMeasurements.projectId, input.projectId))
          .orderBy(desc(deptMeasurements.measuredOn), desc(deptMeasurements.createdAt))
          .catch(() => []),
        billedByItem(db, input.projectId),
        db
          .select({ name: projects.name })
          .from(projects)
          .where(eq(projects.id, input.projectId))
          .limit(1),
      ]);
      const abstract = mbAbstract(
        items.map((item) => ({
          id: item.id,
          contractQuantityThousandths: String(item.contractQuantityThousandths),
        })),
        entries.map((row) => ({ ...row, quantityThousandths: String(row.quantityThousandths) })),
        billed,
      );
      return {
        projectName: project?.name ?? "",
        canRecord: access.can("billing.create"),
        items: items.map((item) => ({
          id: item.id,
          code: item.itemCode,
          description: item.description,
          unit: item.unit,
          ...abstract.find((row) => row.itemId === item.id)!,
        })),
        entries: entries.map((row) => ({
          ...row,
          quantityThousandths: String(row.quantityThousandths),
          itemCode: items.find((item) => item.id === row.contractItemId)?.itemCode ?? "",
          unit: items.find((item) => item.id === row.contractItemId)?.unit ?? "",
        })),
      };
    }),

  record: protectedProcedure
    .input(
      z.object({
        projectId: z.string().uuid(),
        contractItemId: z.string().uuid(),
        measuredOn: dateSchema,
        location: z.string().trim().min(2).max(200),
        nos: dim,
        length: dim,
        breadth: dim,
        depth: dim,
        deduction: z.boolean().default(false),
        clientMutationId: mutationIdSchema,
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const access = await commercialAccess(ctx.user, "billing.create");
      requireProject(access, input.projectId);
      if (input.measuredOn > todayIst())
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "The measurement date cannot be in the future.",
        });
      const [item] = await access.db
        .select()
        .from(contractItems)
        .where(
          and(
            eq(contractItems.id, input.contractItemId),
            eq(contractItems.projectId, input.projectId),
            eq(contractItems.status, "Active"),
          ),
        )
        .limit(1);
      if (!item)
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Contract item not found on this project.",
        });
      const qty = measuredQuantity({
        nos: input.nos ?? null,
        length: input.length ?? null,
        breadth: input.breadth ?? null,
        depth: input.depth ?? null,
      });
      if (typeof qty === "string") throw new TRPCError({ code: "BAD_REQUEST", message: qty });
      const [prior] = await access.db
        .select({ id: deptMeasurements.id })
        .from(deptMeasurements)
        .where(eq(deptMeasurements.clientMutationId, input.clientMutationId))
        .limit(1);
      if (prior) return prior;
      const id = randomUUID();
      await access.db.transaction(async (tx) => {
        await tx.insert(deptMeasurements).values({
          id,
          organizationId: access.organizationId,
          projectId: input.projectId,
          contractItemId: item.id,
          measuredOn: input.measuredOn,
          location: input.location,
          nos: input.nos || null,
          length: input.length || null,
          breadth: input.breadth || null,
          depth: input.depth || null,
          deduction: input.deduction ? "Yes" : "No",
          quantityThousandths: qty.toString(),
          clientMutationId: input.clientMutationId,
          createdBy: ctx.user.id,
        });
        await tx.insert(auditEvents).values({
          id: randomUUID(),
          organizationId: access.organizationId,
          actorUserId: ctx.user.id,
          action: "billing.mb_recorded",
          entityType: "dept_measurement",
          entityId: id,
          afterSummary: JSON.stringify({
            item: item.itemCode,
            quantityThousandths: qty.toString(),
            deduction: input.deduction,
          }),
        });
      });
      return { id };
    }),

  /** Records the department engineer's signature on the MB (name, designation, date, book/page). */
  sign: protectedProcedure
    .input(
      z.object({
        ids: z.array(z.string().uuid()).min(1).max(200),
        signedByName: z.string().trim().min(2).max(180),
        signedByDesignation: z.string().trim().min(2).max(120),
        signedOn: dateSchema,
        mbReference: z.string().trim().min(1).max(80),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const access = await commercialAccess(ctx.user, "billing.create");
      if (input.signedOn > todayIst())
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "The signing date cannot be in the future.",
        });
      await access.db.transaction(async (tx) => {
        const rows = await tx
          .select()
          .from(deptMeasurements)
          .where(
            and(
              inArray(deptMeasurements.id, input.ids),
              eq(deptMeasurements.organizationId, access.organizationId),
            ),
          )
          .for("update");
        if (rows.length !== input.ids.length)
          throw new TRPCError({ code: "NOT_FOUND", message: "Some measurements were not found." });
        for (const row of rows) {
          requireProject(access, row.projectId);
          if (row.status !== "Recorded")
            throw new TRPCError({
              code: "CONFLICT",
              message: "Only recorded measurements can be signed.",
            });
          if (input.signedOn < row.measuredOn)
            throw new TRPCError({
              code: "BAD_REQUEST",
              message: "It cannot be signed before it was measured.",
            });
        }
        await tx
          .update(deptMeasurements)
          .set({
            status: "Signed",
            signedByName: input.signedByName,
            signedByDesignation: input.signedByDesignation,
            signedOn: input.signedOn,
            mbReference: input.mbReference,
            signedRecordedBy: ctx.user.id,
          })
          .where(inArray(deptMeasurements.id, input.ids));
        await tx.insert(auditEvents).values({
          id: randomUUID(),
          organizationId: access.organizationId,
          actorUserId: ctx.user.id,
          action: "billing.mb_signed",
          entityType: "dept_measurement",
          entityId: input.ids[0]!,
          afterSummary: JSON.stringify({
            count: input.ids.length,
            by: input.signedByName,
            mb: input.mbReference,
            on: input.signedOn,
          }),
        });
      });
      return { ok: true as const, signed: input.ids.length };
    }),

  reject: protectedProcedure
    .input(z.object({ id: z.string().uuid(), reason: z.string().trim().min(3).max(500) }))
    .mutation(async ({ ctx, input }) => {
      const access = await commercialAccess(ctx.user, "billing.create");
      const [row] = await access.db
        .select()
        .from(deptMeasurements)
        .where(
          and(
            eq(deptMeasurements.id, input.id),
            eq(deptMeasurements.organizationId, access.organizationId),
          ),
        )
        .limit(1);
      if (!row) throw new TRPCError({ code: "NOT_FOUND", message: "Measurement not found." });
      requireProject(access, row.projectId);
      if (row.status !== "Recorded")
        throw new TRPCError({
          code: "CONFLICT",
          message: "Only a recorded measurement can be rejected.",
        });
      await access.db
        .update(deptMeasurements)
        .set({ status: "Rejected", rejectReason: input.reason })
        .where(eq(deptMeasurements.id, row.id));
      await access.db.insert(auditEvents).values({
        id: randomUUID(),
        organizationId: access.organizationId,
        actorUserId: ctx.user.id,
        action: "billing.mb_rejected",
        entityType: "dept_measurement",
        entityId: row.id,
        reason: input.reason,
      });
      return { ok: true as const };
    }),
});
