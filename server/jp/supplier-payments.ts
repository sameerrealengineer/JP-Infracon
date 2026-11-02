import { createHash, randomUUID } from "node:crypto";
import { and, asc, count, desc, eq, gte, inArray, isNull, lte, or, sql } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import {
  attachments,
  auditEvents,
  permissionGrants,
  sites,
  supplierInvoices,
  supplierPaymentAllocations,
  supplierPayments,
  vendors,
} from "../../drizzle/schema";
import {
  calculateInvoicePaymentBalance,
  calculatePaymentAllocationTotal,
  parseRupeesToMinor,
} from "../../lib/jp/finance-domain";
import { getDb } from "../db";
import { protectedProcedure, router } from "../_core/trpc";
import { getSiteScope } from "./access";

const uuidSchema = z.string().uuid();
const mutationIdSchema = z.string().trim().min(16).max(64);
const pageSchema = {
  offset: z.number().int().min(0).max(1_000_000).default(0),
  limit: z.number().int().min(1).max(100).default(25),
};
const dateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine((value) => {
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}, "Enter a valid calendar date.");
const rupeesSchema = z.string().trim().regex(/^\d{1,16}(?:\.\d{1,2})?$/).refine((value) => {
  try { parseRupeesToMinor(value); return true; }
  catch { return false; }
}, "Enter a positive rupee amount with at most two decimal places.");
const paymentModeSchema = z.enum(["Bank Transfer", "UPI", "Cheque", "Cash", "Other"]);
const decisionSchema = z.enum(["Approved", "Rejected"]);
const reasonSchema = z.string().trim().min(3).max(2000);
const allocationSchema = z.object({ invoiceId: uuidSchema, amountRupees: rupeesSchema });

function requireDb(db: Awaited<ReturnType<typeof getDb>>) {
  if (!db) throw new TRPCError({ code: "PRECONDITION_FAILED", message: "The business data service is temporarily unavailable." });
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

async function findMutationEvent(queryable: any, actorUserId: number, clientMutationId: string) {
  const [event] = await queryable.select().from(auditEvents).where(and(
    eq(auditEvents.actorUserId, actorUserId),
    eq(auditEvents.clientMutationId, clientMutationId),
  )).limit(1);
  return event ?? null;
}
function verifyMutationEvent(event: typeof auditEvents.$inferSelect, expected: {
  action: string;
  entityType: string;
  entityId: string;
  afterSummary: string;
  reason: string | null;
}) {
  if (event.action !== expected.action || event.entityType !== expected.entityType
    || event.entityId !== expected.entityId || event.afterSummary !== expected.afterSummary
    || event.reason !== expected.reason) {
    conflict("This retry key is already associated with a different payment action or payload.");
  }
}
async function writeAudit(tx: any, input: {
  organizationId: string;
  siteId: string;
  actorUserId: number;
  action: string;
  entityType: string;
  entityId: string;
  clientMutationId: string;
  requestId?: string;
  beforeSummary?: string | null;
  afterSummary: string;
  reason?: string | null;
}) {
  await tx.insert(auditEvents).values({ id: randomUUID(), ...input });
}

function grantAppliesToSite(grant: typeof permissionGrants.$inferSelect, scope: {
  organizationId: string; projectId: string; siteId: string;
}) {
  if (grant.scopeType === "organization") return grant.scopeId === scope.organizationId;
  if (grant.scopeType === "project") return grant.scopeId === scope.projectId;
  return grant.scopeId === scope.siteId;
}

/** Limits/evidence that exist in grant data are never silently ignored by a payment action. */
async function enforceConfiguredActionLimits(tx: any, input: {
  userId: number;
  scope: { organizationId: string; projectId: string; siteId: string };
  permissionKey: "finance.payment.review" | "finance.payment.post";
  paymentId: string;
  amountMinor: string;
}) {
  const now = new Date();
  const grants = await tx.select().from(permissionGrants).where(and(
    eq(permissionGrants.organizationId, input.scope.organizationId),
    eq(permissionGrants.userId, input.userId),
    eq(permissionGrants.permissionKey, input.permissionKey),
    eq(permissionGrants.status, "Active"),
    lte(permissionGrants.effectiveFrom, now),
    or(isNull(permissionGrants.effectiveTo), gte(permissionGrants.effectiveTo, now)),
  )).for("update");
  const matching = (grants as (typeof permissionGrants.$inferSelect)[])
    .filter((grant) => grant.effect === "allow" && grantAppliesToSite(grant, input.scope));

  for (const grant of matching) {
    if (grant.maxAmountMinor !== null && BigInt(input.amountMinor) > BigInt(grant.maxAmountMinor)) {
      throw new TRPCError({ code: "PRECONDITION_FAILED", message: "This payment exceeds your configured per-action limit. It remains unposted and must be routed to a different authorised reviewer/poster with sufficient authority." });
    }
    for (const [period, limit] of [["daily", grant.dailyLimitMinor], ["monthly", grant.monthlyLimitMinor]] as const) {
      if (limit === null) continue;
      const start = new Date(now);
      if (period === "daily") start.setUTCHours(0, 0, 0, 0);
      else { start.setUTCDate(1); start.setUTCHours(0, 0, 0, 0); }

      const actorColumn = input.permissionKey === "finance.payment.post" ? supplierPayments.postedBy : supplierPayments.reviewedBy;
      const timeColumn = input.permissionKey === "finance.payment.post" ? supplierPayments.postedAt : supplierPayments.reviewedAt;
      const conditions = [
        eq(supplierPayments.organizationId, input.scope.organizationId),
        eq(supplierPayments.direction, "Outflow"),
        gte(timeColumn, start),
      ];
      if (input.permissionKey === "finance.payment.post") conditions.push(eq(supplierPayments.status, "Posted") as never);
      else conditions.push(inArray(supplierPayments.status, ["Approved", "Posted"]) as never);
      if (grant.scopeType === "site") conditions.push(eq(supplierPayments.siteId, grant.scopeId) as never);
      else if (grant.scopeType === "project") {
        const projectSites = await tx.select({ id: sites.id }).from(sites).where(and(
          eq(sites.organizationId, input.scope.organizationId),
          eq(sites.projectId, grant.scopeId),
        ));
        const ids = projectSites.map((row: { id: string }) => row.id);
        if (ids.length === 0) continue;
        conditions.push(inArray(supplierPayments.siteId, ids) as never);
      }
      conditions.push(eq(actorColumn, input.userId) as never);
      const [sumRow] = await tx.select({ total: sql<string>`coalesce(sum(${supplierPayments.amountMinor}), 0)` })
        .from(supplierPayments).where(and(...conditions));
      const prior = BigInt(String(sumRow?.total ?? "0"));
      if (prior + BigInt(input.amountMinor) > BigInt(limit)) {
        throw new TRPCError({ code: "PRECONDITION_FAILED", message: `This payment would exceed your configured ${period} limit. No payment was posted; route it to another authorised person with available authority.` });
      }
    }
    if (grant.requiresEvidence === "yes") {
      const [evidence] = await tx.select({ id: attachments.id }).from(attachments).where(and(
        eq(attachments.organizationId, input.scope.organizationId),
        eq(attachments.entityType, "supplier_payment"),
        eq(attachments.entityId, input.paymentId),
        eq(attachments.scanStatus, "Accepted"),
      )).limit(1);
      if (!evidence) throw new TRPCError({ code: "PRECONDITION_FAILED", message: "An accepted payment evidence attachment is required by your active permission grant. No ledger posting was made." });
    }
  }
}

async function loadApprovedInvoiceBalances(queryable: any, scope: {
  organizationId: string; siteId: string;
}, vendorId: string, invoiceIds: string[], lockInvoices = false) {
  if (invoiceIds.length === 0) return { invoices: [], balances: new Map<string, string>() };
  const uniqueIds = [...new Set(invoiceIds)].sort();
  if (invoiceIds.length > 0 && uniqueIds.length !== invoiceIds.length) conflict("Each invoice may be allocated only once in a payment.");
  let invoiceQuery = queryable.select({
    id: supplierInvoices.id,
    invoiceNumber: supplierInvoices.invoiceNumber,
    invoiceDate: supplierInvoices.invoiceDate,
    dueDate: supplierInvoices.dueDate,
    totalMinor: supplierInvoices.totalMinor,
    status: supplierInvoices.status,
  }).from(supplierInvoices).where(and(
    eq(supplierInvoices.organizationId, scope.organizationId),
    eq(supplierInvoices.siteId, scope.siteId),
    eq(supplierInvoices.vendorId, vendorId),
    eq(supplierInvoices.status, "Approved"),
    ...(uniqueIds.length ? [inArray(supplierInvoices.id, uniqueIds)] : []),
  )).orderBy(asc(supplierInvoices.id));
  const invoices = lockInvoices ? await invoiceQuery.for("update") : await invoiceQuery;
  if (uniqueIds.length > 0 && invoices.length !== uniqueIds.length) {
    throw new TRPCError({ code: "BAD_REQUEST", message: "Every allocation must reference an Approved invoice for this supplier and assigned site." });
  }
  if (invoices.length === 0) return { invoices, balances: new Map<string, string>() };

  const invoiceKeys = invoices.map((invoice: { id: string }) => invoice.id);
  const posted = await queryable.select({
    invoiceId: supplierPaymentAllocations.invoiceId,
    amountMinor: supplierPaymentAllocations.amountMinor,
  }).from(supplierPaymentAllocations).innerJoin(supplierPayments, eq(
    supplierPaymentAllocations.paymentId,
    supplierPayments.id,
  )).where(and(
    eq(supplierPaymentAllocations.organizationId, scope.organizationId),
    eq(supplierPaymentAllocations.siteId, scope.siteId),
    eq(supplierPaymentAllocations.vendorId, vendorId),
    inArray(supplierPaymentAllocations.invoiceId, invoiceKeys),
    eq(supplierPayments.status, "Posted"),
    eq(supplierPayments.direction, "Outflow"),
  ));
  const byInvoice = new Map<string, string[]>();
  for (const row of posted) byInvoice.set(row.invoiceId, [...(byInvoice.get(row.invoiceId) ?? []), row.amountMinor]);
  const balances = new Map<string, string>();
  for (const invoice of invoices) {
    try {
      balances.set(invoice.id, calculateInvoicePaymentBalance(invoice.totalMinor, byInvoice.get(invoice.id) ?? []).balanceMinor);
    } catch {
      conflict("Posted invoice allocations exceed the approved invoice total; further payment posting is blocked pending reconciliation.");
    }
  }
  return { invoices, balances };
}

function toMinorAllocations(allocations: readonly { invoiceId: string; amountRupees: string }[]) {
  return allocations.map((item) => ({ invoiceId: item.invoiceId, amountMinor: parseRupeesToMinor(item.amountRupees) }))
    .sort((left, right) => left.invoiceId.localeCompare(right.invoiceId));
}

async function getPaymentAllocations(queryable: any, paymentId: string): Promise<Array<{ invoiceId: string; invoiceNumber: string; amountMinor: string }>> {
  return queryable.select({
    invoiceId: supplierPaymentAllocations.invoiceId,
    invoiceNumber: supplierInvoices.invoiceNumber,
    amountMinor: supplierPaymentAllocations.amountMinor,
  }).from(supplierPaymentAllocations).innerJoin(supplierInvoices, and(
    eq(supplierPaymentAllocations.organizationId, supplierInvoices.organizationId),
    eq(supplierPaymentAllocations.siteId, supplierInvoices.siteId),
    eq(supplierPaymentAllocations.vendorId, supplierInvoices.vendorId),
    eq(supplierPaymentAllocations.invoiceId, supplierInvoices.id),
  )).where(eq(supplierPaymentAllocations.paymentId, paymentId)).orderBy(asc(supplierInvoices.invoiceNumber));
}

async function recoverCreateReplay(db: any, actorUserId: number, clientMutationId: string, expectedHash: string) {
  const [existing] = await db.select().from(supplierPayments).where(eq(supplierPayments.clientMutationId, clientMutationId)).limit(1);
  if (!existing) return null;
  if (existing.createdBy !== actorUserId) conflict("This payment retry key belongs to another record.");
  const event = await findMutationEvent(db, actorUserId, clientMutationId);
  const summary = JSON.stringify({ status: "Draft", payloadHash: expectedHash, amountMinor: existing.amountMinor });
  if (!event) conflict("The payment retry could not be verified safely. Contact an administrator before retrying.");
  verifyMutationEvent(event, { action: "supplier_payment.create", entityType: "supplier_payment", entityId: existing.id, afterSummary: summary, reason: null });
  return { id: existing.id, status: existing.status, amountMinor: existing.amountMinor, replayed: true };
}

export const supplierPaymentRouter = router({
  listPayments: protectedProcedure.input(z.object({
    siteId: uuidSchema,
    ...pageSchema,
    status: z.enum(["Draft", "Submitted", "Approved", "Rejected", "Cancelled", "Posted", "Reversed"]).optional(),
  })).query(async ({ ctx, input }) => {
    const scope = await getSiteScope(ctx.user, input.siteId, "finance.payment.view");
    const db = requireDb(await getDb());
    const predicates = [eq(supplierPayments.organizationId, scope.organizationId), eq(supplierPayments.siteId, scope.siteId)];
    if (input.status) predicates.push(eq(supplierPayments.status, input.status));
    const where = and(...predicates);
    const [{ total = 0 } = {}] = await db.select({ total: count() }).from(supplierPayments).where(where);
    const rows = await db.select({
      id: supplierPayments.id,
      vendorId: supplierPayments.vendorId,
      vendorName: supplierPayments.beneficiaryNameSnapshot,
      transactionType: supplierPayments.transactionType,
      direction: supplierPayments.direction,
      amountMinor: supplierPayments.amountMinor,
      currency: supplierPayments.currency,
      paymentDate: supplierPayments.paymentDate,
      paymentMode: supplierPayments.paymentMode,
      paidByName: supplierPayments.paidByName,
      fundingSourceLabel: supplierPayments.fundingSourceLabel,
      category: supplierPayments.category,
      purpose: supplierPayments.purpose,
      externalReference: supplierPayments.externalReference,
      status: supplierPayments.status,
      createdBy: supplierPayments.createdBy,
      submittedBy: supplierPayments.submittedBy,
      reviewedBy: supplierPayments.reviewedBy,
      reviewedAt: supplierPayments.reviewedAt,
      reviewReason: supplierPayments.reviewReason,
      postedBy: supplierPayments.postedBy,
      postedAt: supplierPayments.postedAt,
      cancelledBy: supplierPayments.cancelledBy,
      cancelledAt: supplierPayments.cancelledAt,
      cancellationReason: supplierPayments.cancellationReason,
      createdAt: supplierPayments.createdAt,
      updatedAt: supplierPayments.updatedAt,
    }).from(supplierPayments).where(where).orderBy(desc(supplierPayments.updatedAt)).limit(input.limit).offset(input.offset);
    return { rows, total, limit: input.limit, offset: input.offset };
  }),

  paymentDetail: protectedProcedure.input(z.object({ siteId: uuidSchema, paymentId: uuidSchema })).query(async ({ ctx, input }) => {
    const scope = await getSiteScope(ctx.user, input.siteId, "finance.payment.view");
    const db = requireDb(await getDb());
    const [payment] = await db.select({
      id: supplierPayments.id,
      vendorId: supplierPayments.vendorId,
      vendorName: supplierPayments.beneficiaryNameSnapshot,
      transactionType: supplierPayments.transactionType,
      direction: supplierPayments.direction,
      amountMinor: supplierPayments.amountMinor,
      currency: supplierPayments.currency,
      paymentDate: supplierPayments.paymentDate,
      paymentMode: supplierPayments.paymentMode,
      paidByName: supplierPayments.paidByName,
      fundingSourceLabel: supplierPayments.fundingSourceLabel,
      category: supplierPayments.category,
      purpose: supplierPayments.purpose,
      externalReference: supplierPayments.externalReference,
      status: supplierPayments.status,
      createdBy: supplierPayments.createdBy,
      submittedBy: supplierPayments.submittedBy,
      submittedAt: supplierPayments.submittedAt,
      reviewedBy: supplierPayments.reviewedBy,
      reviewedAt: supplierPayments.reviewedAt,
      reviewReason: supplierPayments.reviewReason,
      postedBy: supplierPayments.postedBy,
      postedAt: supplierPayments.postedAt,
      cancelledBy: supplierPayments.cancelledBy,
      cancelledAt: supplierPayments.cancelledAt,
      cancellationReason: supplierPayments.cancellationReason,
      createdAt: supplierPayments.createdAt,
    }).from(supplierPayments).where(and(
      eq(supplierPayments.organizationId, scope.organizationId),
      eq(supplierPayments.siteId, scope.siteId),
      eq(supplierPayments.id, input.paymentId),
    )).limit(1);
    if (!payment) throw new TRPCError({ code: "NOT_FOUND", message: "Supplier payment not found for this assigned site." });
    return { payment, allocations: await getPaymentAllocations(db, payment.id) };
  }),

  listInvoiceCandidates: protectedProcedure.input(z.object({
    siteId: uuidSchema,
    vendorId: uuidSchema,
    ...pageSchema,
  })).query(async ({ ctx, input }) => {
    const scope = await getSiteScope(ctx.user, input.siteId, "finance.payment.create");
    const db = requireDb(await getDb());
    const [{ total = 0 } = {}] = await db.select({ total: count() }).from(supplierInvoices).where(and(
      eq(supplierInvoices.organizationId, scope.organizationId),
      eq(supplierInvoices.siteId, scope.siteId),
      eq(supplierInvoices.vendorId, input.vendorId),
      eq(supplierInvoices.status, "Approved"),
    ));
    const invoicePage = await db.select({
      id: supplierInvoices.id,
      invoiceNumber: supplierInvoices.invoiceNumber,
      invoiceDate: supplierInvoices.invoiceDate,
      dueDate: supplierInvoices.dueDate,
      totalMinor: supplierInvoices.totalMinor,
    }).from(supplierInvoices).where(and(
      eq(supplierInvoices.organizationId, scope.organizationId),
      eq(supplierInvoices.siteId, scope.siteId),
      eq(supplierInvoices.vendorId, input.vendorId),
      eq(supplierInvoices.status, "Approved"),
    )).orderBy(asc(supplierInvoices.dueDate), asc(supplierInvoices.invoiceDate), asc(supplierInvoices.id)).limit(input.limit).offset(input.offset);
    const { balances } = await loadApprovedInvoiceBalances(db, scope, input.vendorId, invoicePage.map((invoice) => invoice.id));
    const rows = invoicePage.map((invoice) => {
      const balanceMinor = balances.get(invoice.id) ?? "0";
      return { ...invoice, balanceMinor, postedAllocatedMinor: (BigInt(invoice.totalMinor) - BigInt(balanceMinor)).toString() };
    });
    return { rows, total, limit: input.limit, offset: input.offset };
  }),

  createPayment: protectedProcedure.input(z.object({
    siteId: uuidSchema,
    vendorId: uuidSchema,
    paymentDate: dateSchema,
    amountRupees: rupeesSchema,
    paymentMode: paymentModeSchema,
    paidByName: z.string().trim().min(2).max(180),
    fundingSourceLabel: z.string().trim().min(2).max(180),
    category: z.string().trim().min(2).max(80),
    purpose: z.string().trim().min(3).max(500),
    externalReference: z.string().trim().max(120).optional(),
    allocations: z.array(allocationSchema).min(1).max(50),
    clientMutationId: mutationIdSchema,
  })).mutation(async ({ ctx, input }) => {
    const scope = await getSiteScope(ctx.user, input.siteId, "finance.payment.create");
    const db = requireDb(await getDb());
    const amountMinor = parseRupeesToMinor(input.amountRupees);
    const allocations = toMinorAllocations(input.allocations);
    const canonical = {
      siteId: scope.siteId,
      vendorId: input.vendorId,
      paymentDate: input.paymentDate,
      amountMinor,
      paymentMode: input.paymentMode,
      paidByName: input.paidByName.trim(),
      fundingSourceLabel: input.fundingSourceLabel.trim(),
      category: input.category.trim(),
      purpose: input.purpose.trim(),
      externalReference: input.externalReference?.trim() || null,
      allocations,
    };
    const hash = payloadHash(canonical);
    const replay = await recoverCreateReplay(db, ctx.user.id, input.clientMutationId, hash);
    if (replay) return replay;

    const id = randomUUID();
    const expectedSummary = JSON.stringify({ status: "Draft", payloadHash: hash, amountMinor });
    try {
      await db.transaction(async (tx: any) => {
        const [vendor] = await tx.select({ id: vendors.id, legalName: vendors.legalName }).from(vendors).where(and(
          eq(vendors.id, input.vendorId),
          eq(vendors.organizationId, scope.organizationId),
          eq(vendors.status, "Active"),
        )).for("update").limit(1);
        if (!vendor) throw new TRPCError({ code: "BAD_REQUEST", message: "Choose an active supplier in this organisation." });
        const { balances } = await loadApprovedInvoiceBalances(tx, scope, input.vendorId, allocations.map((item) => item.invoiceId), true);
        calculatePaymentAllocationTotal(amountMinor, allocations, balances);
        await tx.insert(supplierPayments).values({
          id,
          organizationId: scope.organizationId,
          siteId: scope.siteId,
          vendorId: input.vendorId,
          transactionType: "Supplier Invoice Payment",
          direction: "Outflow",
          amountMinor,
          currency: "INR",
          paymentDate: input.paymentDate,
          paymentMode: input.paymentMode,
          beneficiaryNameSnapshot: vendor.legalName,
          paidByName: canonical.paidByName,
          fundingSourceLabel: canonical.fundingSourceLabel,
          category: canonical.category,
          purpose: canonical.purpose,
          externalReference: canonical.externalReference,
          status: "Draft",
          createdBy: ctx.user.id,
          clientMutationId: input.clientMutationId,
        });
        await tx.insert(supplierPaymentAllocations).values(allocations.map((allocation) => ({
          id: randomUUID(),
          organizationId: scope.organizationId,
          siteId: scope.siteId,
          vendorId: input.vendorId,
          paymentId: id,
          invoiceId: allocation.invoiceId,
          amountMinor: allocation.amountMinor,
        })));
        await writeAudit(tx, {
          organizationId: scope.organizationId,
          siteId: scope.siteId,
          actorUserId: ctx.user.id,
          action: "supplier_payment.create",
          entityType: "supplier_payment",
          entityId: id,
          clientMutationId: input.clientMutationId,
          requestId: safeRequestId(ctx.req.headers["x-request-id"]),
          afterSummary: expectedSummary,
          reason: null,
        });
      });
      return { id, status: "Draft" as const, amountMinor, replayed: false };
    } catch (error) {
      const raced = await recoverCreateReplay(db, ctx.user.id, input.clientMutationId, hash);
      if (raced) return raced;
      if (error instanceof TRPCError) throw error;
      conflict("Supplier payment draft could not be saved safely. Retry with the same mutation key; no provider payment was attempted.");
    }
  }),

  submitPayment: protectedProcedure.input(z.object({ siteId: uuidSchema, paymentId: uuidSchema, clientMutationId: mutationIdSchema })).mutation(async ({ ctx, input }) => {
    const scope = await getSiteScope(ctx.user, input.siteId, "finance.payment.submit");
    const db = requireDb(await getDb());
    const expectedSummary = JSON.stringify({ status: "Submitted" });
    const replay = await findMutationEvent(db, ctx.user.id, input.clientMutationId);
    if (replay) {
      verifyMutationEvent(replay, { action: "supplier_payment.submit", entityType: "supplier_payment", entityId: input.paymentId, afterSummary: expectedSummary, reason: null });
      const [payment] = await db.select({ status: supplierPayments.status }).from(supplierPayments).where(and(
        eq(supplierPayments.organizationId, scope.organizationId), eq(supplierPayments.siteId, scope.siteId), eq(supplierPayments.id, input.paymentId),
      )).limit(1);
      if (!payment) throw new TRPCError({ code: "NOT_FOUND", message: "Supplier payment not found for this assigned site." });
      return { status: payment.status, replayed: true };
    }
    return db.transaction(async (tx: any) => {
      const [payment] = await tx.select().from(supplierPayments).where(and(
        eq(supplierPayments.organizationId, scope.organizationId), eq(supplierPayments.siteId, scope.siteId), eq(supplierPayments.id, input.paymentId),
      )).for("update").limit(1);
      if (!payment) throw new TRPCError({ code: "NOT_FOUND", message: "Supplier payment not found for this assigned site." });
      if (payment.createdBy !== ctx.user.id) throw new TRPCError({ code: "FORBIDDEN", message: "Only the payment creator can submit this draft." });
      if (payment.status !== "Draft") throw new TRPCError({ code: "CONFLICT", message: "Only a Draft supplier payment can be submitted." });
      const allocations = await tx.select({ invoiceId: supplierPaymentAllocations.invoiceId, amountMinor: supplierPaymentAllocations.amountMinor })
        .from(supplierPaymentAllocations).where(eq(supplierPaymentAllocations.paymentId, payment.id));
      const { balances } = await loadApprovedInvoiceBalances(tx, scope, payment.vendorId, allocations.map((item: { invoiceId: string }) => item.invoiceId), true);
      calculatePaymentAllocationTotal(payment.amountMinor, allocations, balances);
      const timestamp = new Date();
      await tx.update(supplierPayments).set({ status: "Submitted", submittedBy: ctx.user.id, submittedAt: timestamp }).where(eq(supplierPayments.id, payment.id));
      await writeAudit(tx, {
        organizationId: scope.organizationId, siteId: scope.siteId, actorUserId: ctx.user.id,
        action: "supplier_payment.submit", entityType: "supplier_payment", entityId: payment.id,
        clientMutationId: input.clientMutationId, requestId: safeRequestId(ctx.req.headers["x-request-id"]),
        beforeSummary: JSON.stringify({ status: payment.status }), afterSummary: expectedSummary, reason: null,
      });
      return { status: "Submitted" as const, replayed: false };
    });
  }),

  reviewPayment: protectedProcedure.input(z.object({
    siteId: uuidSchema,
    paymentId: uuidSchema,
    decision: decisionSchema,
    reason: reasonSchema,
    clientMutationId: mutationIdSchema,
  })).mutation(async ({ ctx, input }) => {
    const scope = await getSiteScope(ctx.user, input.siteId, "finance.payment.review");
    const db = requireDb(await getDb());
    const reason = input.reason.trim();
    const status = input.decision;
    const expectedSummary = JSON.stringify({ status });
    const replay = await findMutationEvent(db, ctx.user.id, input.clientMutationId);
    if (replay) {
      verifyMutationEvent(replay, { action: "supplier_payment.review", entityType: "supplier_payment", entityId: input.paymentId, afterSummary: expectedSummary, reason });
      const [payment] = await db.select({ status: supplierPayments.status }).from(supplierPayments).where(and(
        eq(supplierPayments.organizationId, scope.organizationId), eq(supplierPayments.siteId, scope.siteId), eq(supplierPayments.id, input.paymentId),
      )).limit(1);
      if (!payment) throw new TRPCError({ code: "NOT_FOUND", message: "Supplier payment not found for this assigned site." });
      return { status: payment.status, replayed: true };
    }
    return db.transaction(async (tx: any) => {
      const [payment] = await tx.select().from(supplierPayments).where(and(
        eq(supplierPayments.organizationId, scope.organizationId), eq(supplierPayments.siteId, scope.siteId), eq(supplierPayments.id, input.paymentId),
      )).for("update").limit(1);
      if (!payment) throw new TRPCError({ code: "NOT_FOUND", message: "Supplier payment not found for this assigned site." });
      if (payment.createdBy === ctx.user.id) throw new TRPCError({ code: "FORBIDDEN", message: "The payment creator cannot review their own payment." });
      if (payment.status !== "Submitted") throw new TRPCError({ code: "CONFLICT", message: "Only a Submitted payment can be reviewed." });
      await enforceConfiguredActionLimits(tx, {
        userId: ctx.user.id,
        scope: { organizationId: scope.organizationId, projectId: scope.projectId, siteId: scope.siteId },
        permissionKey: "finance.payment.review",
        paymentId: payment.id,
        amountMinor: payment.amountMinor,
      });
      const allocations = await tx.select({ invoiceId: supplierPaymentAllocations.invoiceId, amountMinor: supplierPaymentAllocations.amountMinor })
        .from(supplierPaymentAllocations).where(eq(supplierPaymentAllocations.paymentId, payment.id));
      const { balances } = await loadApprovedInvoiceBalances(tx, scope, payment.vendorId, allocations.map((item: { invoiceId: string }) => item.invoiceId), true);
      calculatePaymentAllocationTotal(payment.amountMinor, allocations, balances);
      const timestamp = new Date();
      await tx.update(supplierPayments).set({ status, reviewedBy: ctx.user.id, reviewedAt: timestamp, reviewReason: reason }).where(eq(supplierPayments.id, payment.id));
      await writeAudit(tx, {
        organizationId: scope.organizationId, siteId: scope.siteId, actorUserId: ctx.user.id,
        action: "supplier_payment.review", entityType: "supplier_payment", entityId: payment.id,
        clientMutationId: input.clientMutationId, requestId: safeRequestId(ctx.req.headers["x-request-id"]),
        beforeSummary: JSON.stringify({ status: payment.status }), afterSummary: expectedSummary, reason,
      });
      return { status, replayed: false };
    });
  }),

  postPayment: protectedProcedure.input(z.object({
    siteId: uuidSchema,
    paymentId: uuidSchema,
    reason: z.string().trim().min(3).max(1000).optional(),
    clientMutationId: mutationIdSchema,
  })).mutation(async ({ ctx, input }) => {
    const scope = await getSiteScope(ctx.user, input.siteId, "finance.payment.post");
    const db = requireDb(await getDb());
    const reason = input.reason?.trim() || null;
    const expectedSummary = JSON.stringify({ status: "Posted" });
    const replay = await findMutationEvent(db, ctx.user.id, input.clientMutationId);
    if (replay) {
      const [payment] = await db.select({ status: supplierPayments.status, reviewedBy: supplierPayments.reviewedBy }).from(supplierPayments).where(and(
        eq(supplierPayments.organizationId, scope.organizationId), eq(supplierPayments.siteId, scope.siteId), eq(supplierPayments.id, input.paymentId),
      )).limit(1);
      if (!payment) throw new TRPCError({ code: "NOT_FOUND", message: "Supplier payment not found for this assigned site." });
      verifyMutationEvent(replay, { action: "supplier_payment.post", entityType: "supplier_payment", entityId: input.paymentId, afterSummary: expectedSummary, reason: payment.reviewedBy ? null : reason });
      return { status: payment.status, replayed: true };
    }
    return db.transaction(async (tx: any) => {
      const [payment] = await tx.select().from(supplierPayments).where(and(
        eq(supplierPayments.organizationId, scope.organizationId), eq(supplierPayments.siteId, scope.siteId), eq(supplierPayments.id, input.paymentId),
      )).for("update").limit(1);
      if (!payment) throw new TRPCError({ code: "NOT_FOUND", message: "Supplier payment not found for this assigned site." });
      if (payment.createdBy === ctx.user.id) throw new TRPCError({ code: "FORBIDDEN", message: "The payment creator cannot post their own payment." });
      if (payment.status !== "Submitted" && payment.status !== "Approved") throw new TRPCError({ code: "CONFLICT", message: "Only a Submitted or Approved payment can be posted." });
      if (payment.status === "Approved" && (!payment.reviewedBy || !payment.reviewReason)) conflict("The approved payment is missing its required reviewer attribution or reason.");
      if (payment.status === "Submitted" && !reason) conflict("Direct posting requires a reason; alternatively, obtain review first.");

      const allocations = await tx.select({ invoiceId: supplierPaymentAllocations.invoiceId, amountMinor: supplierPaymentAllocations.amountMinor })
        .from(supplierPaymentAllocations).where(eq(supplierPaymentAllocations.paymentId, payment.id)).orderBy(asc(supplierPaymentAllocations.invoiceId));
      const { balances } = await loadApprovedInvoiceBalances(tx, scope, payment.vendorId, allocations.map((item: { invoiceId: string }) => item.invoiceId), true);
      calculatePaymentAllocationTotal(payment.amountMinor, allocations, balances);
      await enforceConfiguredActionLimits(tx, {
        userId: ctx.user.id,
        scope: { organizationId: scope.organizationId, projectId: scope.projectId, siteId: scope.siteId },
        permissionKey: "finance.payment.post",
        paymentId: payment.id,
        amountMinor: payment.amountMinor,
      });
      const timestamp = new Date();
      await tx.update(supplierPayments).set({ status: "Posted", postedBy: ctx.user.id, postedAt: timestamp }).where(eq(supplierPayments.id, payment.id));
      await writeAudit(tx, {
        organizationId: scope.organizationId, siteId: scope.siteId, actorUserId: ctx.user.id,
        action: "supplier_payment.post", entityType: "supplier_payment", entityId: payment.id,
        clientMutationId: input.clientMutationId, requestId: safeRequestId(ctx.req.headers["x-request-id"]),
        beforeSummary: JSON.stringify({ status: payment.status }), afterSummary: expectedSummary,
        reason: payment.status === "Submitted" ? reason : null,
      });
      return { status: "Posted" as const, replayed: false };
    });
  }),

  cancelPayment: protectedProcedure.input(z.object({
    siteId: uuidSchema,
    paymentId: uuidSchema,
    reason: reasonSchema,
    clientMutationId: mutationIdSchema,
  })).mutation(async ({ ctx, input }) => {
    const scope = await getSiteScope(ctx.user, input.siteId, "finance.payment.cancel");
    const db = requireDb(await getDb());
    const reason = input.reason.trim();
    const expectedSummary = JSON.stringify({ status: "Cancelled" });
    const replay = await findMutationEvent(db, ctx.user.id, input.clientMutationId);
    if (replay) {
      verifyMutationEvent(replay, { action: "supplier_payment.cancel", entityType: "supplier_payment", entityId: input.paymentId, afterSummary: expectedSummary, reason });
      const [payment] = await db.select({ status: supplierPayments.status }).from(supplierPayments).where(and(
        eq(supplierPayments.organizationId, scope.organizationId), eq(supplierPayments.siteId, scope.siteId), eq(supplierPayments.id, input.paymentId),
      )).limit(1);
      if (!payment) throw new TRPCError({ code: "NOT_FOUND", message: "Supplier payment not found for this assigned site." });
      return { status: payment.status, replayed: true };
    }
    return db.transaction(async (tx: any) => {
      const [payment] = await tx.select().from(supplierPayments).where(and(
        eq(supplierPayments.organizationId, scope.organizationId), eq(supplierPayments.siteId, scope.siteId), eq(supplierPayments.id, input.paymentId),
      )).for("update").limit(1);
      if (!payment) throw new TRPCError({ code: "NOT_FOUND", message: "Supplier payment not found for this assigned site." });
      if (payment.createdBy !== ctx.user.id) throw new TRPCError({ code: "FORBIDDEN", message: "Only the payment creator can cancel this unposted payment." });
      if (payment.status !== "Draft" && payment.status !== "Submitted") throw new TRPCError({ code: "CONFLICT", message: "Only a Draft or Submitted payment can be cancelled." });
      await tx.update(supplierPayments).set({ status: "Cancelled", cancelledBy: ctx.user.id, cancelledAt: new Date(), cancellationReason: reason }).where(eq(supplierPayments.id, payment.id));
      await writeAudit(tx, {
        organizationId: scope.organizationId, siteId: scope.siteId, actorUserId: ctx.user.id,
        action: "supplier_payment.cancel", entityType: "supplier_payment", entityId: payment.id,
        clientMutationId: input.clientMutationId, requestId: safeRequestId(ctx.req.headers["x-request-id"]),
        beforeSummary: JSON.stringify({ status: payment.status }), afterSummary: expectedSummary, reason,
      });
      return { status: "Cancelled" as const, replayed: false };
    });
  }),
});
