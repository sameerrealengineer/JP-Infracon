import { randomUUID } from "node:crypto";
import { and, desc, eq, inArray, like, or } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import {
  attendanceRecords,
  auditEvents,
  people,
  personDetails,
  personFeedback,
  personSiteAssignments,
  sites,
  supplierInvoices,
  supplierPayments,
  users,
  vendors,
  workerEngagements,
} from "../../drizzle/schema";
import { protectedProcedure, router } from "../_core/trpc";
import { getDb } from "../db";
import { assertModuleOn, getAccessibleSites, getSiteScope } from "./access";
import { siteCapabilities, type SiteCapability } from "./capabilities";
import {
  FEEDBACK_KINDS,
  summarizeAttendance,
  summarizeFeedback,
  sumMinor,
  validateFeedback,
  type AttendanceRow,
} from "../../lib/jp/person-history";
import type { RateType } from "../../lib/jp/attendance-domain";

/**
 * Person profiles: one place to look up a worker, technician or subcontractor contact by name
 * and see where they worked, attendance and estimated earnings, rates, feedback (quality,
 * defaults, praise) and, for a linked subcontractor firm, its bills and payments.
 * Every part is limited to the sites where the viewer holds the matching permission.
 */

/** Trims, drops control characters, and turns blank into null. */
function cleanText(value: string | null | undefined, max: number) {
  const text = (value ?? "")
    .replace(/[\u0000-\u001f]/g, " ")
    .trim()
    .slice(0, max);
  return text || null;
}

const uuid = z.string().uuid();
const mutationId = z.string().trim().min(16).max(64);
const LEADERS = ["owner", "director", "admin"];

function requireDb(db: Awaited<ReturnType<typeof getDb>>) {
  if (!db)
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message: "The business data service is temporarily unavailable.",
    });
  return db;
}
type Db = ReturnType<typeof requireDb>;

async function viewerScope(user: Parameters<typeof getAccessibleSites>[0]) {
  const accessible = await getAccessibleSites(user);
  const capabilities = await siteCapabilities(user, accessible);
  const can = (siteId: string, key: keyof SiteCapability) =>
    capabilities.find((row) => row.siteId === siteId)?.[key] === true;
  const sitesWith = (key: keyof SiteCapability) =>
    capabilities.filter((row) => row[key] === true).map((row) => row.siteId);
  const leaderOrgs = new Set(
    accessible.filter((site) => LEADERS.includes(site.businessRole)).map((s) => s.organizationId),
  );
  return { accessible, can, sitesWith, leaderOrgs };
}

/** Sites a person is or was linked to (assignment or rate). */
async function personSites(db: Db, personId: string) {
  const [assigned, engaged] = await Promise.all([
    db
      .select({ siteId: personSiteAssignments.siteId })
      .from(personSiteAssignments)
      .where(eq(personSiteAssignments.personId, personId)),
    db
      .select({ siteId: workerEngagements.siteId })
      .from(workerEngagements)
      .where(eq(workerEngagements.personId, personId)),
  ]);
  return [...new Set([...assigned, ...engaged].map((row) => row.siteId))];
}

async function loadVisiblePerson(
  db: Db,
  user: Parameters<typeof getAccessibleSites>[0],
  personId: string,
) {
  const [person] = await db.select().from(people).where(eq(people.id, personId)).limit(1);
  if (!person) throw new TRPCError({ code: "NOT_FOUND", message: "Person not found." });
  await assertModuleOn(person.organizationId, "workforce.view");
  const scope = await viewerScope(user);
  const linked = await personSites(db, personId);
  const workforceSites = new Set(scope.sitesWith("workforce.view"));
  const visibleSites = linked.filter((siteId) => workforceSites.has(siteId));
  const orgSites = scope.accessible.filter((s) => s.organizationId === person.organizationId);
  const leaderView =
    scope.leaderOrgs.has(person.organizationId) &&
    orgSites.some((site) => workforceSites.has(site.id));
  if (!visibleSites.length && !leaderView)
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "This person has not worked on a site where you can see the workforce.",
    });
  return { person, scope, linked, visibleSites: leaderView ? linked : visibleSites };
}

async function findEvent(db: Db, actorUserId: number, clientMutationId: string) {
  const [event] = await db
    .select()
    .from(auditEvents)
    .where(
      and(
        eq(auditEvents.actorUserId, actorUserId),
        eq(auditEvents.clientMutationId, clientMutationId),
      ),
    )
    .limit(1);
  return event;
}

const detailsInput = z.object({
  personId: uuid,
  siteId: uuid,
  addressLine: z.string().max(300).nullish(),
  city: z.string().max(120).nullish(),
  district: z.string().max(120).nullish(),
  pincode: z
    .string()
    .trim()
    .regex(/^(\d{6})?$/, "PIN code is 6 digits.")
    .nullish(),
  alternatePhone: z.string().max(40).nullish(),
  vendorId: uuid.nullish(),
  notes: z.string().max(2000).nullish(),
  clientMutationId: mutationId,
});

export const peopleRouter = router({
  /** Find people by name, phone or trade within the sites the viewer can see. */
  search: protectedProcedure
    .input(z.object({ query: z.string().trim().max(80).default("") }))
    .query(async ({ ctx, input }) => {
      const db = requireDb(await getDb());
      const scope = await viewerScope(ctx.user);
      const workforceSites = scope.sitesWith("workforce.view");
      if (!workforceSites.length) return { people: [] };
      const orgIds = [
        ...new Set(
          scope.accessible
            .filter((s) => workforceSites.includes(s.id))
            .map((s) => s.organizationId),
        ),
      ];
      const leaderOrgIds = orgIds.filter((id) => scope.leaderOrgs.has(id));
      const linkedIds = (
        await db
          .select({ personId: personSiteAssignments.personId })
          .from(personSiteAssignments)
          .where(inArray(personSiteAssignments.siteId, workforceSites))
          .limit(5000)
      ).map((row) => row.personId);
      const pattern = `%${input.query.replace(/[%_\\]/g, (c) => `\\${c}`)}%`;
      const visibility = or(
        ...(leaderOrgIds.length ? [inArray(people.organizationId, leaderOrgIds)] : []),
        ...(linkedIds.length ? [inArray(people.id, [...new Set(linkedIds)])] : []),
      );
      if (!visibility) return { people: [] };
      const rows = await db
        .select({
          id: people.id,
          fullName: people.fullName,
          personType: people.personType,
          skillCategory: people.skillCategory,
          tradeType: people.tradeType,
          status: people.status,
        })
        .from(people)
        .where(
          and(
            inArray(people.organizationId, orgIds),
            visibility,
            input.query
              ? or(
                  like(people.fullName, pattern),
                  like(people.tradeType, pattern),
                  like(people.phone, pattern),
                )
              : undefined,
          ),
        )
        .orderBy(people.fullName)
        .limit(50);
      const ids = rows.map((row) => row.id);
      const feedback = ids.length
        ? await db
            .select({
              personId: personFeedback.personId,
              kind: personFeedback.kind,
              rating: personFeedback.rating,
              siteId: personFeedback.siteId,
            })
            .from(personFeedback)
            .where(inArray(personFeedback.personId, ids))
            .catch(() => [])
        : [];
      return {
        people: rows.map((row) => {
          const mine = feedback.filter(
            (entry) =>
              entry.personId === row.id &&
              (scope.leaderOrgs.size > 0 || workforceSites.includes(entry.siteId)),
          );
          const summary = summarizeFeedback(mine);
          return {
            ...row,
            averageRating: summary.averageRating,
            defaults: summary.counts.Default,
          };
        }),
      };
    }),

  /** Everything known about one person, limited to what the viewer may see. */
  history: protectedProcedure.input(z.object({ personId: uuid })).query(async ({ ctx, input }) => {
    const db = requireDb(await getDb());
    const { person, scope, visibleSites } = await loadVisiblePerson(db, ctx.user, input.personId);
    const canContact = visibleSites.some((id) => scope.can(id, "workforce.manage"));
    const canKyc = visibleSites.some((id) => scope.can(id, "workforce.kyc.view"));
    const payViewSites = visibleSites.filter((id) => scope.can(id, "compensation.view"));
    const siteRows = visibleSites.length
      ? await db
          .select({ id: sites.id, name: sites.name, code: sites.siteCode })
          .from(sites)
          .where(inArray(sites.id, visibleSites))
      : [];
    const siteName = (id: string) => siteRows.find((row) => row.id === id)?.name ?? "Site";

    const [details] = await db
      .select()
      .from(personDetails)
      .where(eq(personDetails.personId, person.id))
      .limit(1)
      .catch(() => []);
    const engagements = visibleSites.length
      ? await db
          .select()
          .from(workerEngagements)
          .where(
            and(
              eq(workerEngagements.personId, person.id),
              inArray(workerEngagements.siteId, visibleSites),
            ),
          )
          .orderBy(desc(workerEngagements.effectiveFrom))
      : [];
    const engagementIds = engagements.map((row) => row.id);
    const attendance = engagementIds.length
      ? await db
          .select({
            siteId: attendanceRecords.siteId,
            workDate: attendanceRecords.workDate,
            status: attendanceRecords.attendanceStatus,
            regularHours: attendanceRecords.regularHours,
            overtimeHours: attendanceRecords.overtimeHours,
            overtimeStatus: attendanceRecords.overtimeApprovalStatus,
            rateMinor: attendanceRecords.rateSnapshotMinor,
            engagementId: attendanceRecords.workerEngagementId,
          })
          .from(attendanceRecords)
          .where(inArray(attendanceRecords.workerEngagementId, engagementIds))
          .limit(20_000)
      : [];
    const rateTypeOf = new Map(engagements.map((row) => [row.id, row.rateType as RateType]));
    const work = summarizeAttendance(
      attendance.map(
        (row): AttendanceRow => ({
          siteId: row.siteId,
          workDate: String(row.workDate),
          status: row.status,
          regularHours: String(row.regularHours),
          overtimeHours: String(row.overtimeHours),
          overtimeApproved: row.overtimeStatus === "Approved",
          rateType: rateTypeOf.get(row.engagementId) ?? null,
          rateMinor: row.rateMinor ?? null,
        }),
      ),
    );

    const feedbackRows = visibleSites.length
      ? await db
          .select({
            id: personFeedback.id,
            siteId: personFeedback.siteId,
            kind: personFeedback.kind,
            rating: personFeedback.rating,
            note: personFeedback.note,
            createdAt: personFeedback.createdAt,
            recordedByName: users.name,
          })
          .from(personFeedback)
          .leftJoin(users, eq(personFeedback.recordedBy, users.id))
          .where(
            and(
              eq(personFeedback.personId, person.id),
              inArray(personFeedback.siteId, visibleSites),
            ),
          )
          .orderBy(desc(personFeedback.createdAt))
          .limit(200)
          .catch(() => [])
      : [];

    // A linked subcontractor firm: approved bills and posted payments on sites the viewer may see.
    let firm: {
      id: string;
      name: string;
      vendorType: string;
      sites: {
        siteId: string;
        siteName: string;
        billedMinor: string | null;
        paidMinor: string | null;
      }[];
    } | null = null;
    if (details?.vendorId) {
      const [vendor] = await db
        .select({ id: vendors.id, name: vendors.legalName, vendorType: vendors.vendorType })
        .from(vendors)
        .where(eq(vendors.id, details.vendorId))
        .limit(1);
      const invoiceSites = scope.sitesWith("finance.invoice.view");
      const paymentSites = scope.sitesWith("finance.payment.view");
      const [invoices, payments] = await Promise.all([
        invoiceSites.length
          ? db
              .select({ siteId: supplierInvoices.siteId, total: supplierInvoices.totalMinor })
              .from(supplierInvoices)
              .where(
                and(
                  eq(supplierInvoices.vendorId, details.vendorId),
                  eq(supplierInvoices.status, "Approved"),
                  inArray(supplierInvoices.siteId, invoiceSites),
                ),
              )
          : [],
        paymentSites.length
          ? db
              .select({ siteId: supplierPayments.siteId, amount: supplierPayments.amountMinor })
              .from(supplierPayments)
              .where(
                and(
                  eq(supplierPayments.vendorId, details.vendorId),
                  eq(supplierPayments.status, "Posted"),
                  inArray(supplierPayments.siteId, paymentSites),
                ),
              )
          : [],
      ]);
      const firmSites = [...new Set([...invoices, ...payments].map((row) => row.siteId))];
      const names = firmSites.length
        ? await db
            .select({ id: sites.id, name: sites.name })
            .from(sites)
            .where(inArray(sites.id, firmSites))
        : [];
      if (vendor)
        firm = {
          ...vendor,
          sites: firmSites.map((siteId) => ({
            siteId,
            siteName: names.find((row) => row.id === siteId)?.name ?? "Site",
            billedMinor: invoiceSites.includes(siteId)
              ? sumMinor(invoices.filter((row) => row.siteId === siteId).map((row) => row.total))
              : null,
            paidMinor: paymentSites.includes(siteId)
              ? sumMinor(payments.filter((row) => row.siteId === siteId).map((row) => row.amount))
              : null,
          })),
        };
    }

    return {
      person: {
        id: person.id,
        fullName: person.fullName,
        personType: person.personType,
        skillCategory: person.skillCategory,
        tradeType: person.tradeType,
        status: person.status,
        kycStatus: canKyc ? person.kycStatus : null,
        phone: canContact ? person.phone : null,
        createdAt: person.createdAt,
      },
      contact: canContact
        ? {
            addressLine: details?.addressLine ?? null,
            city: details?.city ?? null,
            district: details?.district ?? null,
            pincode: details?.pincode ?? null,
            alternatePhone: details?.alternatePhone ?? null,
            notes: details?.notes ?? null,
            vendorId: details?.vendorId ?? null,
          }
        : null,
      canEdit: visibleSites.filter((id) => scope.can(id, "workforce.manage")),
      sites: visibleSites.map((siteId) => {
        const summary = work.find((row) => row.siteId === siteId);
        const seesPay = payViewSites.includes(siteId);
        return {
          siteId,
          siteName: siteName(siteId),
          rates: seesPay
            ? engagements
                .filter((row) => row.siteId === siteId)
                .map((row) => ({
                  engagementType: row.engagementType,
                  rateType: row.rateType,
                  rateMinor: String(row.rateMinor),
                  effectiveFrom: String(row.effectiveFrom),
                  effectiveTo: row.effectiveTo ? String(row.effectiveTo) : null,
                  status: row.status,
                }))
            : null,
          work: summary
            ? {
                ...summary,
                estimatedEarningsMinor: seesPay ? summary.estimatedEarningsMinor : null,
              }
            : null,
        };
      }),
      feedback: feedbackRows.map((row) => ({ ...row, siteName: siteName(row.siteId) })),
      feedbackSummary: summarizeFeedback(feedbackRows),
      firm,
    };
  }),

  /** Address, second phone, linked subcontractor firm and notes. */
  saveDetails: protectedProcedure.input(detailsInput).mutation(async ({ ctx, input }) => {
    const db = requireDb(await getDb());
    const scope = await getSiteScope(ctx.user, input.siteId, "workforce.manage");
    const replay = await findEvent(db, ctx.user.id, input.clientMutationId);
    if (replay) {
      if (replay.action !== "person.details_saved" || replay.entityId !== input.personId)
        throw new TRPCError({ code: "CONFLICT", message: "This retry key was already used." });
      return { personId: input.personId };
    }
    const [person] = await db
      .select({ id: people.id, organizationId: people.organizationId })
      .from(people)
      .where(eq(people.id, input.personId))
      .limit(1);
    if (!person || person.organizationId !== scope.organizationId)
      throw new TRPCError({ code: "NOT_FOUND", message: "Person not found." });
    if (!(await personSites(db, person.id)).includes(scope.siteId))
      throw new TRPCError({
        code: "FORBIDDEN",
        message: "This person is not linked to the chosen site.",
      });
    if (input.vendorId) {
      const [vendor] = await db
        .select({ organizationId: vendors.organizationId })
        .from(vendors)
        .where(eq(vendors.id, input.vendorId))
        .limit(1);
      if (!vendor || vendor.organizationId !== scope.organizationId)
        throw new TRPCError({ code: "NOT_FOUND", message: "Subcontractor firm not found." });
    }
    const values = {
      addressLine: cleanText(input.addressLine, 300),
      city: cleanText(input.city, 120),
      district: cleanText(input.district, 120),
      pincode: input.pincode?.trim() || null,
      alternatePhone: cleanText(input.alternatePhone, 40),
      vendorId: input.vendorId ?? null,
      notes: cleanText(input.notes, 2000),
    };
    await db.transaction(async (tx) => {
      const [before] = await tx
        .select()
        .from(personDetails)
        .where(eq(personDetails.personId, person.id))
        .for("update");
      await tx
        .insert(personDetails)
        .values({
          personId: person.id,
          organizationId: person.organizationId,
          ...values,
          updatedBy: ctx.user.id,
        })
        .onDuplicateKeyUpdate({ set: { ...values, updatedBy: ctx.user.id } });
      await tx.insert(auditEvents).values({
        id: randomUUID(),
        organizationId: scope.organizationId,
        siteId: scope.siteId,
        actorUserId: ctx.user.id,
        action: "person.details_saved",
        entityType: "person",
        entityId: person.id,
        clientMutationId: input.clientMutationId,
        beforeSummary: before
          ? JSON.stringify({ city: before.city, vendorId: before.vendorId })
          : null,
        afterSummary: JSON.stringify({ city: values.city, vendorId: values.vendorId }),
      });
    });
    return { personId: person.id };
  }),

  /** Records a quality rating, default, safety note, praise or payment dispute. Append-only. */
  addFeedback: protectedProcedure
    .input(
      z.object({
        personId: uuid,
        siteId: uuid,
        kind: z.enum(FEEDBACK_KINDS),
        rating: z.number().int().min(1).max(5).nullish(),
        note: z.string().max(1000),
        clientMutationId: mutationId,
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const db = requireDb(await getDb());
      const scope = await getSiteScope(ctx.user, input.siteId, "workforce.manage");
      const problem = validateFeedback(input);
      if (problem) throw new TRPCError({ code: "BAD_REQUEST", message: problem.message });
      const [existing] = await db
        .select({ id: personFeedback.id, personId: personFeedback.personId })
        .from(personFeedback)
        .where(eq(personFeedback.clientMutationId, input.clientMutationId))
        .limit(1);
      if (existing) {
        if (existing.personId !== input.personId)
          throw new TRPCError({ code: "CONFLICT", message: "This retry key was already used." });
        return { id: existing.id };
      }
      const [person] = await db
        .select({ organizationId: people.organizationId })
        .from(people)
        .where(eq(people.id, input.personId))
        .limit(1);
      if (!person || person.organizationId !== scope.organizationId)
        throw new TRPCError({ code: "NOT_FOUND", message: "Person not found." });
      if (!(await personSites(db, input.personId)).includes(scope.siteId))
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "Feedback can only be recorded for a site this person worked on.",
        });
      const id = randomUUID();
      await db.transaction(async (tx) => {
        await tx.insert(personFeedback).values({
          id,
          organizationId: scope.organizationId,
          personId: input.personId,
          siteId: scope.siteId,
          kind: input.kind,
          rating: input.kind === "Quality" ? (input.rating ?? null) : null,
          note: input.note.trim(),
          recordedBy: ctx.user.id,
          clientMutationId: input.clientMutationId,
        });
        await tx.insert(auditEvents).values({
          id: randomUUID(),
          organizationId: scope.organizationId,
          siteId: scope.siteId,
          actorUserId: ctx.user.id,
          action: "workforce.person_feedback_added",
          entityType: "person",
          entityId: input.personId,
          clientMutationId: input.clientMutationId,
          afterSummary: JSON.stringify({ kind: input.kind, rating: input.rating ?? null }),
        });
      });
      return { id };
    }),
});
