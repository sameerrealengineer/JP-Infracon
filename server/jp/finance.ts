import { createHash, randomUUID } from "node:crypto";
import { and, asc, count, desc, eq, gte, isNull, lte, or } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import {
  auditEvents,
  permissionGrants,
  supplierInvoiceLines,
  supplierInvoices,
  vendors,
} from "../../drizzle/schema";
import {
  calculateInvoiceTotals,
  parsePositiveQuantity,
  parseRupeesToMinor,
} from "../../lib/jp/finance-domain";
import { getDb } from "../db";
import { protectedProcedure, router } from "../_core/trpc";
import { getSiteScope } from "./access";
import { resolveOrganizationPermission, type PermissionGrantForResolution } from "./policy";
import { supplierPaymentRouter } from "./supplier-payments";
import { pettyCashRouter } from "./petty-cash";

const uuidSchema = z.string().uuid();
const mutationIdSchema = z.string().trim().min(16).max(64);
const dateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine((value) => {
    const parsed = new Date(`${value}T00:00:00.000Z`);
    return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
  }, "Enter a valid calendar date.");
const rupeesSchema = z
  .string()
  .trim()
  .regex(/^\d{1,16}(?:\.\d{1,2})?$/)
  .refine((value) => {
    try {
      parseRupeesToMinor(value, true);
      return true;
    } catch {
      return false;
    }
  }, "Enter a rupee amount with at most two decimal places.");
const positiveRupeesSchema = rupeesSchema.refine((value) => {
  try {
    parseRupeesToMinor(value);
    return true;
  } catch {
    return false;
  }
}, "Enter a positive rupee amount.");
const quantitySchema = z
  .string()
  .trim()
  .regex(/^\d{1,11}(?:\.\d{1,3})?$/)
  .refine((value) => {
    try {
      parsePositiveQuantity(value);
      return true;
    } catch {
      return false;
    }
  }, "Enter a positive quantity with up to three decimal places.");
const mutationPageSchema = z.object({
  offset: z.number().int().min(0).max(1_000_000).default(0),
  limit: z.number().int().min(1).max(100).default(50),
});
const unitCodeSchema = z
  .string()
  .trim()
  .min(1)
  .max(32)
  .regex(/^[A-Za-z0-9][A-Za-z0-9/_-]*$/);
const invoiceStatusSchema = z.enum(["Draft", "Submitted", "Approved", "Rejected", "Disputed"]);
const vendorTypeSchema = z.enum([
  "Material Supplier",
  "Transporter",
  "Subcontractor",
  "Service Provider",
  "Other",
]);

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

function payloadHash(value: unknown) {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function conflict(message: string): never {
  throw new TRPCError({ code: "CONFLICT", message });
}

async function requireOrganizationMasterPermission(
  user: Parameters<typeof getSiteScope>[0],
  siteId: string,
  permissionKey: "vendor.view" | "vendor.create",
) {
  const scope = await getSiteScope(user, siteId, permissionKey);
  const db = requireDb(await getDb());
  const now = new Date();
  const grants = await db
    .select()
    .from(permissionGrants)
    .where(
      and(
        eq(permissionGrants.organizationId, scope.organizationId),
        eq(permissionGrants.userId, user.id),
        eq(permissionGrants.status, "Active"),
        lte(permissionGrants.effectiveFrom, now),
        or(isNull(permissionGrants.effectiveTo), gte(permissionGrants.effectiveTo, now)),
      ),
    );
  const allowed = resolveOrganizationPermission({
    role: scope.businessRole,
    permissionKey,
    organizationId: scope.organizationId,
    grants: grants as PermissionGrantForResolution[],
    now,
  });
  if (!allowed)
    throw new TRPCError({
      code: "FORBIDDEN",
      message: `This organisation does not grant ${permissionKey} for supplier records.`,
    });
  return { scope, db };
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
    conflict("This retry key is already associated with a different finance action or payload.");
  }
}

async function writeAudit(
  tx: any,
  input: {
    organizationId: string;
    siteId?: string | null;
    actorUserId: number;
    action: string;
    entityType: string;
    entityId: string;
    clientMutationId: string;
    requestId?: string;
    beforeSummary?: string | null;
    afterSummary: string;
    reason?: string | null;
  },
) {
  await tx.insert(auditEvents).values({ id: randomUUID(), ...input });
}

function canonicalVendorPayload(input: {
  vendorType: z.infer<typeof vendorTypeSchema>;
  legalName: string;
  tradeName?: string;
  contactName?: string;
  phone?: string;
  email?: string;
  address?: string;
  paymentTermsDays?: number;
}) {
  return {
    vendorType: input.vendorType,
    legalName: input.legalName.trim(),
    tradeName: input.tradeName?.trim() || null,
    contactName: input.contactName?.trim() || null,
    phone: input.phone?.trim() || null,
    email: input.email?.trim().toLowerCase() || null,
    address: input.address?.trim() || null,
    paymentTermsDays: input.paymentTermsDays ?? null,
  };
}

async function recoverVendorReplay(
  db: any,
  actorUserId: number,
  clientMutationId: string,
  expectedHash: string,
) {
  const [existing] = await db
    .select()
    .from(vendors)
    .where(eq(vendors.clientMutationId, clientMutationId))
    .limit(1);
  if (!existing) return null;
  if (existing.createdBy !== actorUserId)
    conflict("This supplier retry key belongs to another record.");
  const event = await findMutationEvent(db, actorUserId, clientMutationId);
  const summary = JSON.stringify({ status: "Active", payloadHash: expectedHash });
  if (!event)
    conflict(
      "The supplier retry could not be verified safely. Contact an administrator before retrying.",
    );
  verifyMutationEvent(event, {
    action: "vendor.create",
    entityType: "vendor",
    entityId: existing.id,
    afterSummary: summary,
    reason: null,
  });
  return existing;
}

export const financeRouter = router({
  pettyCash: pettyCashRouter,
  listVendors: protectedProcedure
    .input(z.object({ siteId: uuidSchema, ...mutationPageSchema.shape }))
    .query(async ({ ctx, input }) => {
      const { scope, db } = await requireOrganizationMasterPermission(
        ctx.user,
        input.siteId,
        "vendor.view",
      );
      const predicate = and(
        eq(vendors.organizationId, scope.organizationId),
        eq(vendors.status, "Active"),
      );
      const [{ total = 0 } = {}] = await db
        .select({ total: count() })
        .from(vendors)
        .where(predicate);
      const rows = await db
        .select({
          id: vendors.id,
          vendorType: vendors.vendorType,
          legalName: vendors.legalName,
          tradeName: vendors.tradeName,
          contactName: vendors.contactName,
          phone: vendors.phone,
          email: vendors.email,
          address: vendors.address,
          paymentTermsDays: vendors.paymentTermsDays,
          status: vendors.status,
          createdAt: vendors.createdAt,
        })
        .from(vendors)
        .where(predicate)
        .orderBy(asc(vendors.legalName))
        .limit(input.limit)
        .offset(input.offset);
      return { rows, total, limit: input.limit, offset: input.offset };
    }),

  createVendor: protectedProcedure
    .input(
      z.object({
        siteId: uuidSchema,
        vendorType: vendorTypeSchema,
        legalName: z.string().trim().min(2).max(180),
        tradeName: z.string().trim().max(180).optional(),
        contactName: z.string().trim().max(120).optional(),
        phone: z.string().trim().max(40).optional(),
        email: z.string().trim().email().max(254).optional(),
        address: z.string().trim().max(4000).optional(),
        paymentTermsDays: z.number().int().min(0).max(3650).optional(),
        clientMutationId: mutationIdSchema,
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const { scope, db } = await requireOrganizationMasterPermission(
        ctx.user,
        input.siteId,
        "vendor.create",
      );
      const payload = canonicalVendorPayload(input);
      const hash = payloadHash(payload);
      const replay = await recoverVendorReplay(db, ctx.user.id, input.clientMutationId, hash);
      if (replay) return { id: replay.id, status: replay.status, replayed: true };
      const id = randomUUID();
      const summary = JSON.stringify({ status: "Active", payloadHash: hash });
      try {
        await db.transaction(async (tx: any) => {
          await tx.insert(vendors).values({
            id,
            organizationId: scope.organizationId,
            ...payload,
            status: "Active",
            clientMutationId: input.clientMutationId,
            createdBy: ctx.user.id,
          });
          await writeAudit(tx, {
            organizationId: scope.organizationId,
            siteId: scope.siteId,
            actorUserId: ctx.user.id,
            action: "vendor.create",
            entityType: "vendor",
            entityId: id,
            clientMutationId: input.clientMutationId,
            requestId: safeRequestId(ctx.req.headers["x-request-id"]),
            afterSummary: summary,
            reason: null,
          });
        });
        return { id, status: "Active" as const, replayed: false };
      } catch {
        const raced = await recoverVendorReplay(db, ctx.user.id, input.clientMutationId, hash);
        if (raced) return { id: raced.id, status: raced.status, replayed: true };
        conflict(
          "Supplier could not be saved safely. Check the form and retry; the mutation key prevents a duplicate.",
        );
      }
    }),

  listInvoices: protectedProcedure
    .input(
      z.object({
        siteId: uuidSchema,
        ...mutationPageSchema.shape,
        status: invoiceStatusSchema.optional(),
      }),
    )
    .query(async ({ ctx, input }) => {
      const scope = await getSiteScope(ctx.user, input.siteId, "finance.invoice.view");
      const db = requireDb(await getDb());
      const predicates = [
        eq(supplierInvoices.organizationId, scope.organizationId),
        eq(supplierInvoices.siteId, scope.siteId),
      ];
      if (input.status) predicates.push(eq(supplierInvoices.status, input.status));
      const where = and(...predicates);
      const [{ total = 0 } = {}] = await db
        .select({ total: count() })
        .from(supplierInvoices)
        .where(where);
      const rows = await db
        .select({
          id: supplierInvoices.id,
          vendorId: supplierInvoices.vendorId,
          vendorName: vendors.legalName,
          vendorType: vendors.vendorType,
          invoiceNumber: supplierInvoices.invoiceNumber,
          invoiceDate: supplierInvoices.invoiceDate,
          dueDate: supplierInvoices.dueDate,
          currency: supplierInvoices.currency,
          subtotalMinor: supplierInvoices.subtotalMinor,
          taxMinor: supplierInvoices.taxMinor,
          chargesMinor: supplierInvoices.chargesMinor,
          totalMinor: supplierInvoices.totalMinor,
          purchaseReference: supplierInvoices.purchaseReference,
          receiptReference: supplierInvoices.receiptReference,
          status: supplierInvoices.status,
          createdBy: supplierInvoices.createdBy,
          submittedBy: supplierInvoices.submittedBy,
          submittedAt: supplierInvoices.submittedAt,
          reviewedBy: supplierInvoices.reviewedBy,
          reviewedAt: supplierInvoices.reviewedAt,
          reviewReason: supplierInvoices.reviewReason,
          createdAt: supplierInvoices.createdAt,
          updatedAt: supplierInvoices.updatedAt,
        })
        .from(supplierInvoices)
        .innerJoin(
          vendors,
          and(
            eq(supplierInvoices.organizationId, vendors.organizationId),
            eq(supplierInvoices.vendorId, vendors.id),
          ),
        )
        .where(where)
        .orderBy(desc(supplierInvoices.updatedAt))
        .limit(input.limit)
        .offset(input.offset);
      return { rows, total, limit: input.limit, offset: input.offset };
    }),

  invoiceDetail: protectedProcedure
    .input(z.object({ siteId: uuidSchema, invoiceId: uuidSchema }))
    .query(async ({ ctx, input }) => {
      const scope = await getSiteScope(ctx.user, input.siteId, "finance.invoice.view");
      const db = requireDb(await getDb());
      const [invoice] = await db
        .select({
          id: supplierInvoices.id,
          vendorId: supplierInvoices.vendorId,
          vendorName: vendors.legalName,
          vendorType: vendors.vendorType,
          invoiceNumber: supplierInvoices.invoiceNumber,
          invoiceDate: supplierInvoices.invoiceDate,
          dueDate: supplierInvoices.dueDate,
          currency: supplierInvoices.currency,
          subtotalMinor: supplierInvoices.subtotalMinor,
          taxMinor: supplierInvoices.taxMinor,
          chargesMinor: supplierInvoices.chargesMinor,
          totalMinor: supplierInvoices.totalMinor,
          purchaseReference: supplierInvoices.purchaseReference,
          receiptReference: supplierInvoices.receiptReference,
          status: supplierInvoices.status,
          createdBy: supplierInvoices.createdBy,
          submittedBy: supplierInvoices.submittedBy,
          submittedAt: supplierInvoices.submittedAt,
          reviewedBy: supplierInvoices.reviewedBy,
          reviewedAt: supplierInvoices.reviewedAt,
          reviewReason: supplierInvoices.reviewReason,
          createdAt: supplierInvoices.createdAt,
          updatedAt: supplierInvoices.updatedAt,
        })
        .from(supplierInvoices)
        .innerJoin(
          vendors,
          and(
            eq(supplierInvoices.organizationId, vendors.organizationId),
            eq(supplierInvoices.vendorId, vendors.id),
          ),
        )
        .where(
          and(
            eq(supplierInvoices.organizationId, scope.organizationId),
            eq(supplierInvoices.siteId, scope.siteId),
            eq(supplierInvoices.id, input.invoiceId),
          ),
        )
        .limit(1);
      if (!invoice)
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Supplier invoice not found for this assigned site.",
        });
      const lines = await db
        .select({
          id: supplierInvoiceLines.id,
          description: supplierInvoiceLines.description,
          quantity: supplierInvoiceLines.quantity,
          unitCode: supplierInvoiceLines.unitCode,
          lineTotalMinor: supplierInvoiceLines.lineTotalMinor,
        })
        .from(supplierInvoiceLines)
        .where(eq(supplierInvoiceLines.invoiceId, invoice.id))
        .orderBy(asc(supplierInvoiceLines.createdAt));
      return { invoice, lines };
    }),

  createInvoice: protectedProcedure
    .input(
      z
        .object({
          siteId: uuidSchema,
          vendorId: uuidSchema,
          invoiceNumber: z
            .string()
            .trim()
            .min(1)
            .max(80)
            .regex(/^[A-Za-z0-9][A-Za-z0-9./_-]*$/),
          invoiceDate: dateSchema,
          dueDate: dateSchema.optional(),
          taxRupees: rupeesSchema,
          chargesRupees: rupeesSchema,
          purchaseReference: z.string().trim().max(120).optional(),
          receiptReference: z.string().trim().max(120).optional(),
          items: z
            .array(
              z.object({
                description: z.string().trim().min(1).max(240),
                quantity: quantitySchema,
                unitCode: unitCodeSchema,
                lineTotalRupees: positiveRupeesSchema,
              }),
            )
            .min(1)
            .max(50),
          action: z.enum(["Draft", "Submitted"]).default("Draft"),
          clientMutationId: mutationIdSchema,
        })
        .refine((input) => !input.dueDate || input.dueDate >= input.invoiceDate, {
          path: ["dueDate"],
          message: "Due date cannot be earlier than invoice date.",
        }),
    )
    .mutation(async ({ ctx, input }) => {
      const scope = await getSiteScope(ctx.user, input.siteId, "finance.invoice.create");
      if (input.action === "Submitted")
        await getSiteScope(ctx.user, input.siteId, "finance.invoice.submit");
      const db = requireDb(await getDb());
      const [vendor] = await db
        .select({ id: vendors.id })
        .from(vendors)
        .where(
          and(
            eq(vendors.id, input.vendorId),
            eq(vendors.organizationId, scope.organizationId),
            eq(vendors.status, "Active"),
          ),
        )
        .limit(1);
      if (!vendor)
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Choose an active supplier in this organisation.",
        });

      const lines = input.items.map((item) => ({
        description: item.description.trim(),
        quantity: parsePositiveQuantity(item.quantity),
        unitCode: item.unitCode.trim(),
        lineTotalMinor: parseRupeesToMinor(item.lineTotalRupees),
      }));
      const taxMinor = parseRupeesToMinor(input.taxRupees, true);
      const chargesMinor = parseRupeesToMinor(input.chargesRupees, true);
      const totals = calculateInvoiceTotals(lines, taxMinor, chargesMinor);
      const invoiceNumber = input.invoiceNumber.trim();
      const invoiceNumberKey = invoiceNumber.toUpperCase();
      const payload = {
        siteId: scope.siteId,
        organizationId: scope.organizationId,
        vendorId: input.vendorId,
        invoiceNumber,
        invoiceNumberKey,
        invoiceDate: input.invoiceDate,
        dueDate: input.dueDate ?? null,
        purchaseReference: input.purchaseReference?.trim() || null,
        receiptReference: input.receiptReference?.trim() || null,
        lines,
        action: input.action,
        ...totals,
      };
      const hash = payloadHash(payload);
      const expectedSummary = JSON.stringify({
        status: input.action,
        payloadHash: hash,
        totalMinor: totals.totalMinor,
      });
      const replay = await db
        .select()
        .from(supplierInvoices)
        .where(eq(supplierInvoices.clientMutationId, input.clientMutationId))
        .limit(1);
      if (replay[0]) {
        if (replay[0].createdBy !== ctx.user.id)
          conflict("This invoice retry key belongs to another record.");
        const event = await findMutationEvent(db, ctx.user.id, input.clientMutationId);
        if (!event)
          conflict(
            "The invoice retry could not be verified safely. Contact an administrator before retrying.",
          );
        verifyMutationEvent(event, {
          action: "supplier_invoice.create",
          entityType: "supplier_invoice",
          entityId: replay[0].id,
          afterSummary: expectedSummary,
          reason: null,
        });
        return {
          id: replay[0].id,
          status: replay[0].status,
          totalMinor: replay[0].totalMinor,
          replayed: true,
        };
      }

      const id = randomUUID();
      const timestamp = new Date();
      try {
        await db.transaction(async (tx: any) => {
          const [currentVendor] = await tx
            .select({ id: vendors.id })
            .from(vendors)
            .where(
              and(
                eq(vendors.id, input.vendorId),
                eq(vendors.organizationId, scope.organizationId),
                eq(vendors.status, "Active"),
              ),
            )
            .for("update")
            .limit(1);
          if (!currentVendor)
            throw new TRPCError({
              code: "CONFLICT",
              message: "The selected supplier is no longer active. Refresh and try again.",
            });
          await tx.insert(supplierInvoices).values({
            id,
            organizationId: scope.organizationId,
            siteId: scope.siteId,
            vendorId: input.vendorId,
            invoiceNumber,
            invoiceNumberKey,
            invoiceDate: input.invoiceDate,
            dueDate: input.dueDate ?? null,
            currency: "INR",
            subtotalMinor: totals.subtotalMinor,
            taxMinor: totals.taxMinor,
            chargesMinor: totals.chargesMinor,
            totalMinor: totals.totalMinor,
            purchaseReference: payload.purchaseReference,
            receiptReference: payload.receiptReference,
            status: input.action,
            createdBy: ctx.user.id,
            submittedBy: input.action === "Submitted" ? ctx.user.id : null,
            submittedAt: input.action === "Submitted" ? timestamp : null,
            clientMutationId: input.clientMutationId,
          });
          await tx
            .insert(supplierInvoiceLines)
            .values(lines.map((line) => ({ id: randomUUID(), invoiceId: id, ...line })));
          await writeAudit(tx, {
            organizationId: scope.organizationId,
            siteId: scope.siteId,
            actorUserId: ctx.user.id,
            action: "supplier_invoice.create",
            entityType: "supplier_invoice",
            entityId: id,
            clientMutationId: input.clientMutationId,
            requestId: safeRequestId(ctx.req.headers["x-request-id"]),
            afterSummary: expectedSummary,
            reason: null,
          });
        });
        return { id, status: input.action, totalMinor: totals.totalMinor, replayed: false };
      } catch (error) {
        const raced = await db
          .select()
          .from(supplierInvoices)
          .where(eq(supplierInvoices.clientMutationId, input.clientMutationId))
          .limit(1);
        if (raced[0] && raced[0].createdBy === ctx.user.id) {
          const event = await findMutationEvent(db, ctx.user.id, input.clientMutationId);
          if (event) {
            verifyMutationEvent(event, {
              action: "supplier_invoice.create",
              entityType: "supplier_invoice",
              entityId: raced[0].id,
              afterSummary: expectedSummary,
              reason: null,
            });
            return {
              id: raced[0].id,
              status: raced[0].status,
              totalMinor: raced[0].totalMinor,
              replayed: true,
            };
          }
        }
        const duplicateNumber = await db
          .select({ id: supplierInvoices.id })
          .from(supplierInvoices)
          .where(
            and(
              eq(supplierInvoices.organizationId, scope.organizationId),
              eq(supplierInvoices.vendorId, input.vendorId),
              eq(supplierInvoices.invoiceNumberKey, invoiceNumberKey),
            ),
          )
          .limit(1);
        if (duplicateNumber.length)
          conflict("An invoice with this number is already recorded for this supplier.");
        if (error instanceof TRPCError) throw error;
        conflict(
          "Supplier invoice could not be saved safely. Check the invoice number and retry with the same mutation key.",
        );
      }
    }),

  submitInvoice: protectedProcedure
    .input(
      z.object({
        siteId: uuidSchema,
        invoiceId: uuidSchema,
        clientMutationId: mutationIdSchema,
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const scope = await getSiteScope(ctx.user, input.siteId, "finance.invoice.submit");
      const db = requireDb(await getDb());
      const expectedSummary = JSON.stringify({ status: "Submitted" });
      const replay = await findMutationEvent(db, ctx.user.id, input.clientMutationId);
      if (replay) {
        verifyMutationEvent(replay, {
          action: "supplier_invoice.submit",
          entityType: "supplier_invoice",
          entityId: input.invoiceId,
          afterSummary: expectedSummary,
          reason: null,
        });
        const [invoice] = await db
          .select({ status: supplierInvoices.status })
          .from(supplierInvoices)
          .where(
            and(
              eq(supplierInvoices.organizationId, scope.organizationId),
              eq(supplierInvoices.siteId, scope.siteId),
              eq(supplierInvoices.id, input.invoiceId),
            ),
          )
          .limit(1);
        if (!invoice)
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "Supplier invoice not found for this assigned site.",
          });
        return { status: invoice.status, replayed: true };
      }
      try {
        return await db.transaction(async (tx: any) => {
          const [invoice] = await tx
            .select()
            .from(supplierInvoices)
            .where(
              and(
                eq(supplierInvoices.organizationId, scope.organizationId),
                eq(supplierInvoices.siteId, scope.siteId),
                eq(supplierInvoices.id, input.invoiceId),
              ),
            )
            .for("update")
            .limit(1);
          if (!invoice)
            throw new TRPCError({
              code: "NOT_FOUND",
              message: "Supplier invoice not found for this assigned site.",
            });
          if (invoice.createdBy !== ctx.user.id)
            throw new TRPCError({
              code: "FORBIDDEN",
              message: "Only the invoice creator can submit this draft.",
            });
          if (invoice.status !== "Draft")
            throw new TRPCError({
              code: "CONFLICT",
              message: "Only a Draft supplier invoice can be submitted.",
            });
          await tx
            .update(supplierInvoices)
            .set({ status: "Submitted", submittedBy: ctx.user.id, submittedAt: new Date() })
            .where(eq(supplierInvoices.id, invoice.id));
          await writeAudit(tx, {
            organizationId: scope.organizationId,
            siteId: scope.siteId,
            actorUserId: ctx.user.id,
            action: "supplier_invoice.submit",
            entityType: "supplier_invoice",
            entityId: invoice.id,
            clientMutationId: input.clientMutationId,
            requestId: safeRequestId(ctx.req.headers["x-request-id"]),
            beforeSummary: JSON.stringify({ status: invoice.status }),
            afterSummary: expectedSummary,
            reason: null,
          });
          return { status: "Submitted" as const, replayed: false };
        });
      } catch (error) {
        const event = await findMutationEvent(db, ctx.user.id, input.clientMutationId);
        if (event) {
          verifyMutationEvent(event, {
            action: "supplier_invoice.submit",
            entityType: "supplier_invoice",
            entityId: input.invoiceId,
            afterSummary: expectedSummary,
            reason: null,
          });
          const [invoice] = await db
            .select({ status: supplierInvoices.status })
            .from(supplierInvoices)
            .where(eq(supplierInvoices.id, input.invoiceId))
            .limit(1);
          if (invoice) return { status: invoice.status, replayed: true };
        }
        if (error instanceof TRPCError) throw error;
        conflict(
          "Supplier invoice submission was not confirmed. Retry with the same mutation key.",
        );
      }
    }),

  reviewInvoice: protectedProcedure
    .input(
      z
        .object({
          siteId: uuidSchema,
          invoiceId: uuidSchema,
          decision: z.enum(["Approved", "Rejected", "Disputed"]),
          reason: z.string().trim().max(2000).optional(),
          clientMutationId: mutationIdSchema,
        })
        .refine((input) => input.decision === "Approved" || Boolean(input.reason?.trim()), {
          path: ["reason"],
          message: "A reason is required when rejecting or disputing an invoice.",
        }),
    )
    .mutation(async ({ ctx, input }) => {
      const scope = await getSiteScope(ctx.user, input.siteId, "finance.invoice.review");
      const db = requireDb(await getDb());
      const reason = input.reason?.trim() || null;
      const expectedSummary = JSON.stringify({ status: input.decision });
      const replay = await findMutationEvent(db, ctx.user.id, input.clientMutationId);
      if (replay) {
        verifyMutationEvent(replay, {
          action: "supplier_invoice.review",
          entityType: "supplier_invoice",
          entityId: input.invoiceId,
          afterSummary: expectedSummary,
          reason,
        });
        const [invoice] = await db
          .select({ status: supplierInvoices.status })
          .from(supplierInvoices)
          .where(
            and(
              eq(supplierInvoices.organizationId, scope.organizationId),
              eq(supplierInvoices.siteId, scope.siteId),
              eq(supplierInvoices.id, input.invoiceId),
            ),
          )
          .limit(1);
        if (!invoice)
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "Supplier invoice not found for this assigned site.",
          });
        return { status: invoice.status, replayed: true };
      }
      try {
        return await db.transaction(async (tx: any) => {
          const [invoice] = await tx
            .select()
            .from(supplierInvoices)
            .where(
              and(
                eq(supplierInvoices.organizationId, scope.organizationId),
                eq(supplierInvoices.siteId, scope.siteId),
                eq(supplierInvoices.id, input.invoiceId),
              ),
            )
            .for("update")
            .limit(1);
          if (!invoice)
            throw new TRPCError({
              code: "NOT_FOUND",
              message: "Supplier invoice not found for this assigned site.",
            });
          if (invoice.createdBy === ctx.user.id)
            throw new TRPCError({
              code: "FORBIDDEN",
              message: "The invoice creator cannot review their own invoice.",
            });
          if (invoice.status !== "Submitted")
            throw new TRPCError({
              code: "CONFLICT",
              message: "Only a Submitted invoice can be reviewed.",
            });
          await tx
            .update(supplierInvoices)
            .set({
              status: input.decision,
              reviewedBy: ctx.user.id,
              reviewedAt: new Date(),
              reviewReason: reason,
            })
            .where(eq(supplierInvoices.id, invoice.id));
          await writeAudit(tx, {
            organizationId: scope.organizationId,
            siteId: scope.siteId,
            actorUserId: ctx.user.id,
            action: "supplier_invoice.review",
            entityType: "supplier_invoice",
            entityId: invoice.id,
            clientMutationId: input.clientMutationId,
            requestId: safeRequestId(ctx.req.headers["x-request-id"]),
            beforeSummary: JSON.stringify({ status: invoice.status }),
            afterSummary: expectedSummary,
            reason,
          });
          return { status: input.decision, replayed: false };
        });
      } catch (error) {
        const event = await findMutationEvent(db, ctx.user.id, input.clientMutationId);
        if (event) {
          verifyMutationEvent(event, {
            action: "supplier_invoice.review",
            entityType: "supplier_invoice",
            entityId: input.invoiceId,
            afterSummary: expectedSummary,
            reason,
          });
          const [invoice] = await db
            .select({ status: supplierInvoices.status })
            .from(supplierInvoices)
            .where(
              and(
                eq(supplierInvoices.organizationId, scope.organizationId),
                eq(supplierInvoices.siteId, scope.siteId),
                eq(supplierInvoices.id, input.invoiceId),
              ),
            )
            .limit(1);
          if (invoice) return { status: invoice.status, replayed: true };
        }
        if (error instanceof TRPCError) throw error;
        conflict("Invoice review was not confirmed. Retry with the same mutation key.");
      }
    }),
  payments: supplierPaymentRouter,
});
