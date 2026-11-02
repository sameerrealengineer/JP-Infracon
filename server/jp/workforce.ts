import { randomUUID } from "node:crypto";
import { and, desc, eq, gte, isNull, lte, or } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { auditEvents, people, permissionGrants, personSiteAssignments, workerEngagements } from "../../drizzle/schema";
import { parseRupeesToPaise, previousCalendarDate } from "../../lib/jp/workforce-domain";
import { protectedProcedure, router } from "../_core/trpc";
import { getSiteScope } from "./access";
import { resolveSitePermission, type PermissionGrantForResolution } from "./policy";
import { getDb } from "../db";

const uuidSchema = z.string().uuid();
const mutationIdSchema = z.string().trim().min(16).max(64);
const dateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine((value) => {
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}, "Enter a valid calendar date.");
const rateAmountSchema = z.string().trim().regex(/^(?:0|[1-9]\d{0,7})(?:\.\d{1,2})?$/);
const rateTypes = ["daily", "hourly", "shift", "piece", "per_connection", "per_measurement", "contract"] as const;
const kycStatuses = ["Not Required", "Pending", "Verified by authorised reviewer", "Rejected"] as const;
const reviewReasonSchema = z.string().trim().min(3).max(1000).refine((value) => !/\b\d{4}[\s-]?\d{4}[\s-]?\d{4}\b/.test(value), "Do not include a full national identity number in an audit reason.");

function requireDb(db: Awaited<ReturnType<typeof getDb>>) {
  if (!db) throw new TRPCError({ code: "PRECONDITION_FAILED", message: "The business data service is temporarily unavailable." });
  return db;
}

function jsonSummary(value: unknown) {
  return JSON.stringify(value);
}

async function scopedPermission(user: Parameters<typeof getSiteScope>[0], siteId: string, permissionKey: string) {
  const scope = await getSiteScope(user, siteId, "site.view");
  if (!permissionKey.endsWith(".view") && scope.siteStatus !== "Active") {
    throw new TRPCError({ code: "PRECONDITION_FAILED", message: "This site is not accepting routine workforce changes." });
  }
  const db = requireDb(await getDb());
  const now = new Date();
  const grants = await db.select().from(permissionGrants).where(and(
    eq(permissionGrants.organizationId, scope.organizationId),
    eq(permissionGrants.userId, user.id),
    eq(permissionGrants.status, "Active"),
    lte(permissionGrants.effectiveFrom, now),
    or(isNull(permissionGrants.effectiveTo), gte(permissionGrants.effectiveTo, now)),
  ));
  const allowed = resolveSitePermission({
    role: scope.businessRole,
    permissionKey,
    scope: { organizationId: scope.organizationId, projectId: scope.projectId, siteId: scope.siteId },
    grants: grants as PermissionGrantForResolution[],
    now,
  });
  if (!allowed) throw new TRPCError({ code: "FORBIDDEN", message: `Your current role does not include ${permissionKey} for this site.` });
  return { scope, db, now };
}

function ensureSamePayload(existing: { actorUserId: number; action: string; entityType: string; entityId: string; afterSummary: string | null; reason: string | null }, expected: {
  actorUserId: number; action: string; entityType: string; entityId: string; afterSummary: string; reason: string;
}) {
  if (existing.actorUserId !== expected.actorUserId || existing.action !== expected.action || existing.entityType !== expected.entityType || existing.entityId !== expected.entityId || existing.afterSummary !== expected.afterSummary || existing.reason !== expected.reason) {
    throw new TRPCError({ code: "CONFLICT", message: "This retry key was already used for a different workforce action." });
  }
}

async function findMutationEvent(db: NonNullable<Awaited<ReturnType<typeof getDb>>>, actorUserId: number, clientMutationId: string) {
  const [event] = await db.select().from(auditEvents).where(and(eq(auditEvents.actorUserId, actorUserId), eq(auditEvents.clientMutationId, clientMutationId))).limit(1);
  return event;
}

async function writeAudit(tx: any, input: {
  organizationId: string;
  siteId: string;
  actorUserId: number;
  action: string;
  entityType: string;
  entityId: string;
  clientMutationId: string;
  beforeSummary?: string | null;
  afterSummary: string;
  reason: string;
}) {
  await tx.insert(auditEvents).values({ id: randomUUID(), ...input });
}

const personList = protectedProcedure.input(z.object({ siteId: uuidSchema })).query(async ({ ctx, input }) => {
  const { scope, db } = await scopedPermission(ctx.user, input.siteId, "workforce.view");
  const grants = await db.select().from(permissionGrants).where(and(
    eq(permissionGrants.organizationId, scope.organizationId),
    eq(permissionGrants.userId, ctx.user.id),
    eq(permissionGrants.status, "Active"),
    lte(permissionGrants.effectiveFrom, new Date()),
    or(isNull(permissionGrants.effectiveTo), gte(permissionGrants.effectiveTo, new Date())),
  ));
  const role = scope.businessRole;
  const canSeeContact = resolveSitePermission({ role, permissionKey: "workforce.manage", scope: { organizationId: scope.organizationId, projectId: scope.projectId, siteId: scope.siteId }, grants: grants as PermissionGrantForResolution[] });
  const canSeeKyc = resolveSitePermission({ role, permissionKey: "workforce.kyc.view", scope: { organizationId: scope.organizationId, projectId: scope.projectId, siteId: scope.siteId }, grants: grants as PermissionGrantForResolution[] });
  const rows = await db.select({
    id: people.id,
    fullName: people.fullName,
    personType: people.personType,
    phone: people.phone,
    skillCategory: people.skillCategory,
    tradeType: people.tradeType,
    status: people.status,
    kycStatus: people.kycStatus,
    kycReviewedAt: people.kycReviewedAt,
    kycReviewReason: people.kycReviewReason,
    createdAt: people.createdAt,
  }).from(personSiteAssignments)
    .innerJoin(people, eq(personSiteAssignments.personId, people.id))
    .where(and(eq(personSiteAssignments.organizationId, scope.organizationId), eq(personSiteAssignments.siteId, scope.siteId), eq(personSiteAssignments.status, "Active")))
    .orderBy(desc(people.updatedAt)).limit(300);
  return rows.map((row) => ({
    id: row.id,
    fullName: row.fullName,
    personType: row.personType,
    phone: canSeeContact ? row.phone : null,
    skillCategory: row.skillCategory,
    tradeType: row.tradeType,
    status: row.status,
    kycStatus: canSeeKyc ? row.kycStatus : null,
    kycReviewedAt: canSeeKyc ? row.kycReviewedAt : null,
    kycReviewReason: canSeeKyc ? row.kycReviewReason : null,
    createdAt: row.createdAt,
  }));
});

const createPerson = protectedProcedure.input(z.object({
  siteId: uuidSchema,
  fullName: z.string().trim().min(2).max(180),
  personType: z.enum(["worker", "technician", "subcontractor_contact"]),
  phone: z.string().trim().max(40).optional(),
  skillCategory: z.enum(["Skilled", "Semi-skilled", "Unskilled", "Not specified"]).default("Not specified"),
  tradeType: z.string().trim().max(80).optional(),
  initialKycStatus: z.enum(["Not Required", "Pending"]).optional(),
  clientMutationId: mutationIdSchema,
})).mutation(async ({ ctx, input }) => {
  const { scope, db } = await scopedPermission(ctx.user, input.siteId, "workforce.manage");
  if (input.initialKycStatus !== undefined) await scopedPermission(ctx.user, input.siteId, "workforce.kyc.review");
  const initialKycStatus = input.initialKycStatus ?? "Pending";
  const expected = {
    fullName: input.fullName,
    personType: input.personType,
    phone: input.phone?.trim() || null,
    skillCategory: input.skillCategory,
    tradeType: input.tradeType?.trim() || null,
    initialKycStatus,
    siteId: scope.siteId,
  };
  const createSummary = jsonSummary({ personType: input.personType, status: "Draft", kycStatus: initialKycStatus });
  const replay = async () => {
    const event = await findMutationEvent(db, ctx.user.id, input.clientMutationId);
    if (!event) return null;
    if (event.action !== "workforce.person.created" || event.entityType !== "person" || event.afterSummary !== createSummary || event.reason !== "Workforce profile captured; no identity documents or national identity number were collected.") {
      throw new TRPCError({ code: "CONFLICT", message: "This retry key was already used for a different workforce action." });
    }
    const [existing] = await db.select().from(people).where(and(eq(people.id, event.entityId), eq(people.clientMutationId, input.clientMutationId), eq(people.createdBy, ctx.user.id))).limit(1);
    if (!existing) throw new TRPCError({ code: "CONFLICT", message: "The original profile for this retry key is unavailable." });
    const [assignment] = await db.select().from(personSiteAssignments).where(and(eq(personSiteAssignments.personId, existing.id), eq(personSiteAssignments.siteId, scope.siteId))).limit(1);
    if (!assignment || existing.fullName !== expected.fullName || existing.personType !== expected.personType || existing.phone !== expected.phone || existing.skillCategory !== expected.skillCategory || existing.tradeType !== expected.tradeType) {
      throw new TRPCError({ code: "CONFLICT", message: "This retry key was already used for a different worker profile." });
    }
    return { id: existing.id, status: existing.status, replayed: true };
  };
  const repeated = await replay();
  if (repeated) return repeated;
  const id = randomUUID();
  try {
    await db.transaction(async (tx) => {
      await tx.insert(people).values({
        id,
        organizationId: scope.organizationId,
        personType: input.personType,
        fullName: input.fullName,
        phone: expected.phone,
        skillCategory: input.skillCategory,
        tradeType: expected.tradeType,
        status: "Draft",
        kycStatus: initialKycStatus,
        createdBy: ctx.user.id,
        clientMutationId: input.clientMutationId,
      });
      await tx.insert(personSiteAssignments).values({ id: randomUUID(), organizationId: scope.organizationId, personId: id, siteId: scope.siteId, status: "Active", assignedBy: ctx.user.id });
      await writeAudit(tx, {
        organizationId: scope.organizationId,
        siteId: scope.siteId,
        actorUserId: ctx.user.id,
        action: "workforce.person.created",
        entityType: "person",
        entityId: id,
        clientMutationId: input.clientMutationId,
        afterSummary: createSummary,
        reason: "Workforce profile captured; no identity documents or national identity number were collected.",
      });
    });
  } catch (error) {
    const raced = await replay();
    if (raced) return raced;
    if (error instanceof TRPCError) throw error;
    throw new TRPCError({ code: "CONFLICT", message: "Worker profile could not be saved. Check whether this person is already assigned to the site and retry with a new key only for a new record." });
  }
  return { id, status: "Draft" as const, replayed: false };
});

const reviewPerson = protectedProcedure.input(z.object({
  siteId: uuidSchema,
  personId: uuidSchema,
  status: z.enum(["Active", "Inactive"]),
  kycStatus: z.enum(kycStatuses).optional(),
  reason: reviewReasonSchema,
  clientMutationId: mutationIdSchema,
})).mutation(async ({ ctx, input }) => {
  const { scope, db } = await scopedPermission(ctx.user, input.siteId, "workforce.review");
  if (input.kycStatus !== undefined) await scopedPermission(ctx.user, input.siteId, "workforce.kyc.review");
  const afterSummary = jsonSummary({ personId: input.personId, status: input.status, kycStatus: input.kycStatus ?? null });
  const expected = { actorUserId: ctx.user.id, action: "workforce.person.reviewed", entityType: "person", entityId: input.personId, afterSummary, reason: input.reason };
  const repeated = await findMutationEvent(db, ctx.user.id, input.clientMutationId);
  if (repeated) {
    ensureSamePayload(repeated, expected);
    return { personId: input.personId, status: input.status, replayed: true };
  }
  await db.transaction(async (tx) => {
    const [assignment] = await tx.select({ id: personSiteAssignments.id }).from(personSiteAssignments).where(and(
      eq(personSiteAssignments.personId, input.personId), eq(personSiteAssignments.siteId, scope.siteId), eq(personSiteAssignments.organizationId, scope.organizationId), eq(personSiteAssignments.status, "Active"),
    )).for("update").limit(1);
    if (!assignment) throw new TRPCError({ code: "NOT_FOUND", message: "The worker is not actively assigned to this site." });
    const [person] = await tx.select().from(people).where(and(eq(people.id, input.personId), eq(people.organizationId, scope.organizationId))).for("update").limit(1);
    if (!person) throw new TRPCError({ code: "NOT_FOUND", message: "Worker profile not found." });
    await tx.update(people).set({
      status: input.status,
      ...(input.kycStatus ? { kycStatus: input.kycStatus, kycReviewedBy: ctx.user.id, kycReviewedAt: new Date(), kycReviewReason: input.reason } : {}),
    }).where(eq(people.id, input.personId));
    await writeAudit(tx, {
      organizationId: scope.organizationId,
      siteId: scope.siteId,
      actorUserId: ctx.user.id,
      action: "workforce.person.reviewed",
      entityType: "person",
      entityId: input.personId,
      clientMutationId: input.clientMutationId,
      beforeSummary: jsonSummary({ status: person.status, kycStatus: person.kycStatus }),
      afterSummary,
      reason: input.reason,
    });
  });
  return { personId: input.personId, status: input.status, replayed: false };
});

const engagementList = protectedProcedure.input(z.object({ siteId: uuidSchema, personId: uuidSchema.optional() })).query(async ({ ctx, input }) => {
  const { scope, db } = await scopedPermission(ctx.user, input.siteId, "compensation.view");
  const filters = [eq(workerEngagements.organizationId, scope.organizationId), eq(workerEngagements.siteId, scope.siteId)];
  if (input.personId) filters.push(eq(workerEngagements.personId, input.personId));
  return db.select({
    id: workerEngagements.id,
    personId: workerEngagements.personId,
    personName: people.fullName,
    engagementType: workerEngagements.engagementType,
    rateType: workerEngagements.rateType,
    rateMinor: workerEngagements.rateMinor,
    currency: workerEngagements.currency,
    effectiveFrom: workerEngagements.effectiveFrom,
    effectiveTo: workerEngagements.effectiveTo,
    status: workerEngagements.status,
    createdBy: workerEngagements.createdBy,
    approvedBy: workerEngagements.approvedBy,
    reviewedAt: workerEngagements.reviewedAt,
    reviewReason: workerEngagements.reviewReason,
    createdAt: workerEngagements.createdAt,
  }).from(workerEngagements)
    .innerJoin(people, eq(workerEngagements.personId, people.id))
    .where(and(...filters)).orderBy(desc(workerEngagements.effectiveFrom), desc(workerEngagements.createdAt)).limit(300);
});

const proposeEngagement = protectedProcedure.input(z.object({
  siteId: uuidSchema,
  personId: uuidSchema,
  engagementType: z.string().trim().min(2).max(64),
  rateType: z.enum(rateTypes),
  rateRupees: rateAmountSchema,
  effectiveFrom: dateSchema,
  effectiveTo: dateSchema.optional(),
  contractReference: z.string().trim().max(120).optional(),
  clientMutationId: mutationIdSchema,
})).mutation(async ({ ctx, input }) => {
  const { scope, db } = await scopedPermission(ctx.user, input.siteId, "compensation.manage");
  if (input.effectiveTo && input.effectiveTo < input.effectiveFrom) throw new TRPCError({ code: "BAD_REQUEST", message: "The rate end date cannot precede its effective start date." });
  let rateMinor: number;
  try { rateMinor = parseRupeesToPaise(input.rateRupees); }
  catch (error) { throw new TRPCError({ code: "BAD_REQUEST", message: error instanceof Error ? error.message : "Enter a valid rate." }); }
  const [assignment] = await db.select({ id: personSiteAssignments.id }).from(personSiteAssignments).where(and(
    eq(personSiteAssignments.organizationId, scope.organizationId), eq(personSiteAssignments.siteId, scope.siteId), eq(personSiteAssignments.personId, input.personId), eq(personSiteAssignments.status, "Active"),
  )).limit(1);
  if (!assignment) throw new TRPCError({ code: "NOT_FOUND", message: "Assign this worker to the site before proposing a rate." });
  const afterSummary = jsonSummary({ personId: input.personId, engagementType: input.engagementType, rateType: input.rateType, rateMinor, currency: "INR", effectiveFrom: input.effectiveFrom, effectiveTo: input.effectiveTo ?? null, contractReference: input.contractReference?.trim() || null, status: "Draft" });
  const proposalReplay = async () => {
    const event = await findMutationEvent(db, ctx.user.id, input.clientMutationId);
    if (!event) return null;
    ensureSamePayload(event, { actorUserId: ctx.user.id, action: "workforce.rate.proposed", entityType: "worker_engagement", entityId: event.entityId, afterSummary, reason: "Rate proposal captured; it is not active until an authorised reviewer approves it." });
    const [existing] = await db.select().from(workerEngagements).where(and(eq(workerEngagements.id, event.entityId), eq(workerEngagements.createdBy, ctx.user.id))).limit(1);
    if (!existing) throw new TRPCError({ code: "CONFLICT", message: "The original rate proposal for this retry key is unavailable." });
    return { id: existing.id, status: existing.status, rateMinor: existing.rateMinor, replayed: true };
  };
  const existingReplay = await proposalReplay();
  if (existingReplay) return existingReplay;
  const id = randomUUID();
  try {
    await db.transaction(async (tx) => {
      await tx.insert(workerEngagements).values({
        id,
        organizationId: scope.organizationId,
        personId: input.personId,
        siteId: scope.siteId,
        engagementType: input.engagementType,
        rateType: input.rateType,
        rateMinor,
        currency: "INR",
        effectiveFrom: input.effectiveFrom,
        effectiveTo: input.effectiveTo ?? null,
        status: "Draft",
        createdBy: ctx.user.id,
        clientMutationId: input.clientMutationId,
        contractReference: input.contractReference?.trim() || null,
      });
      await writeAudit(tx, {
        organizationId: scope.organizationId,
        siteId: scope.siteId,
        actorUserId: ctx.user.id,
        action: "workforce.rate.proposed",
        entityType: "worker_engagement",
        entityId: id,
        clientMutationId: input.clientMutationId,
        afterSummary,
        reason: "Rate proposal captured; it is not active until an authorised reviewer approves it.",
      });
    });
  } catch (error) {
    const raced = await proposalReplay();
    if (raced) return raced;
    if (error instanceof TRPCError) throw error;
    throw new TRPCError({ code: "CONFLICT", message: "Rate proposal was not saved. Refresh the register and retry the same proposal with its original key." });
  }
  return { id, status: "Draft" as const, rateMinor, replayed: false };
});

const reviewEngagement = protectedProcedure.input(z.object({
  siteId: uuidSchema,
  engagementId: uuidSchema,
  decision: z.enum(["Approve", "Reject"]),
  reason: reviewReasonSchema,
  clientMutationId: mutationIdSchema,
})).mutation(async ({ ctx, input }) => {
  const { scope, db } = await scopedPermission(ctx.user, input.siteId, "compensation.review");
  const afterSummary = jsonSummary({ engagementId: input.engagementId, decision: input.decision });
  const expected = { actorUserId: ctx.user.id, action: `workforce.rate.${input.decision === "Approve" ? "activated" : "rejected"}`, entityType: "worker_engagement", entityId: input.engagementId, afterSummary, reason: input.reason };
  const replay = await findMutationEvent(db, ctx.user.id, input.clientMutationId);
  if (replay) {
    ensureSamePayload(replay, expected);
    return { id: input.engagementId, status: input.decision === "Approve" ? "Active" as const : "Rejected" as const, replayed: true };
  }

  await db.transaction(async (tx) => {
    const [engagement] = await tx.select().from(workerEngagements).where(and(
      eq(workerEngagements.id, input.engagementId), eq(workerEngagements.organizationId, scope.organizationId), eq(workerEngagements.siteId, scope.siteId),
    )).for("update").limit(1);
    if (!engagement) throw new TRPCError({ code: "NOT_FOUND", message: "Rate proposal not found for this site." });
    if (engagement.status !== "Draft") throw new TRPCError({ code: "CONFLICT", message: "Only a draft rate proposal can be reviewed. Existing rate history is preserved." });
    const [personAssignment] = await tx.select({ id: personSiteAssignments.id }).from(personSiteAssignments).where(and(
      eq(personSiteAssignments.personId, engagement.personId), eq(personSiteAssignments.siteId, scope.siteId), eq(personSiteAssignments.status, "Active"),
    )).for("update").limit(1);
    if (!personAssignment) throw new TRPCError({ code: "PRECONDITION_FAILED", message: "The worker is no longer actively assigned to this site." });

    if (input.decision === "Reject") {
      await tx.update(workerEngagements).set({ status: "Rejected", approvedBy: null, reviewedAt: new Date(), reviewReason: input.reason }).where(eq(workerEngagements.id, engagement.id));
      await writeAudit(tx, { organizationId: scope.organizationId, siteId: scope.siteId, actorUserId: ctx.user.id, action: expected.action, entityType: expected.entityType, entityId: engagement.id, clientMutationId: input.clientMutationId, beforeSummary: jsonSummary({ status: engagement.status }), afterSummary, reason: input.reason });
      return;
    }

    const [person] = await tx.select({ status: people.status }).from(people).where(and(eq(people.id, engagement.personId), eq(people.organizationId, scope.organizationId))).for("update").limit(1);
    if (!person || person.status !== "Active") throw new TRPCError({ code: "PRECONDITION_FAILED", message: "Activate the worker profile before activating a rate." });

    const existingRates = await tx.select().from(workerEngagements).where(and(
      eq(workerEngagements.organizationId, scope.organizationId),
      eq(workerEngagements.siteId, scope.siteId),
      eq(workerEngagements.personId, engagement.personId),
      eq(workerEngagements.engagementType, engagement.engagementType),
      or(eq(workerEngagements.status, "Active"), eq(workerEngagements.status, "Ended")),
    )).for("update");
    const superseded: typeof existingRates = [];
    for (const prior of existingRates) {
      if (prior.id === engagement.id) continue;
      const overlaps = (prior.effectiveTo === null || prior.effectiveTo >= engagement.effectiveFrom) && (engagement.effectiveTo === null || engagement.effectiveTo >= prior.effectiveFrom);
      if (!overlaps) continue;
      if (prior.status !== "Active" || prior.effectiveFrom >= engagement.effectiveFrom) {
        throw new TRPCError({ code: "CONFLICT", message: "This rate overlaps an existing or future active rate. End or reject the conflicting rate before activating this proposal." });
      }
      const newPriorEnd = previousCalendarDate(engagement.effectiveFrom);
      await tx.update(workerEngagements).set({ status: "Ended", effectiveTo: newPriorEnd }).where(eq(workerEngagements.id, prior.id));
      superseded.push(prior);
    }
    await tx.update(workerEngagements).set({ status: "Active", approvedBy: ctx.user.id, reviewedAt: new Date(), reviewReason: input.reason }).where(eq(workerEngagements.id, engagement.id));
    for (const prior of superseded) {
      await tx.insert(auditEvents).values({
        id: randomUUID(), organizationId: scope.organizationId, siteId: scope.siteId, actorUserId: ctx.user.id,
        action: "workforce.rate.superseded", entityType: "worker_engagement", entityId: prior.id,
        beforeSummary: jsonSummary({ status: prior.status, effectiveTo: prior.effectiveTo }),
        afterSummary: jsonSummary({ status: "Ended", effectiveTo: previousCalendarDate(engagement.effectiveFrom), replacedBy: engagement.id }),
        reason: `Rate change activated for ${engagement.effectiveFrom}; the prior effective-dated rate was closed one calendar day earlier.`,
      });
    }
    await writeAudit(tx, { organizationId: scope.organizationId, siteId: scope.siteId, actorUserId: ctx.user.id, action: expected.action, entityType: expected.entityType, entityId: engagement.id, clientMutationId: input.clientMutationId, beforeSummary: jsonSummary({ status: engagement.status }), afterSummary, reason: input.reason });
  });
  return { id: input.engagementId, status: input.decision === "Approve" ? "Active" as const : "Rejected" as const, replayed: false };
});

export const workforceRouter = router({
  list: personList,
  createPerson,
  reviewPerson,
  rates: engagementList,
  proposeRate: proposeEngagement,
  reviewRate: reviewEngagement,
});
