import { randomUUID } from "node:crypto";
import { and, asc, desc, eq, inArray, like, lte, or } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import {
  auditEvents,
  crmActivities,
  crmClients,
  crmLeads,
  projects,
  quotationLines,
  quotations,
  users,
} from "../../drizzle/schema";
import { protectedProcedure, router } from "../_core/trpc";
import {
  ACTIVITY_KINDS,
  CLIENT_TYPES,
  LEAD_SOURCES,
  LEAD_STAGES,
  leadStageChange,
  lineAmountMinor,
  nextNumber,
  parsePercentBps,
  parseQuantity,
  quotationTotals,
  type LeadStage,
} from "../../lib/jp/billing-domain";
import { parseRupeesToMinor } from "../../lib/jp/finance-domain";
import { normalizeIndianMobile } from "../../lib/jp/notify-policy";
import { commercialAccess, type Db } from "./commercial-access";

/**
 * CRM: clients, enquiries (leads) with follow-ups and stages, and quotations with exact GST
 * totals. Company-level: crm.view to read, crm.manage to change. Every change is audited and
 * repeatable with the same clientMutationId.
 */

const uuid = z.string().uuid();
const mutationId = z.string().trim().min(16).max(64);
const optionalText = (max: number) => z.string().trim().max(max).nullish();
const today = () => new Date().toISOString().slice(0, 10);
const dateText = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use a date like 2026-11-04.");

function bad(message: string): never {
  throw new TRPCError({ code: "BAD_REQUEST", message });
}

function rupees(value: string | null | undefined, label: string, allowZero = false) {
  if (!value?.trim()) return null;
  try {
    return parseRupeesToMinor(value, allowZero);
  } catch {
    bad(`${label}: enter an amount in rupees, like 125000 or 1250.50.`);
  }
}

async function audit(
  db: Db,
  args: {
    organizationId: string;
    userId: number;
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
    organizationId: args.organizationId,
    actorUserId: args.userId,
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
    .select({ entityId: auditEvents.entityId, action: auditEvents.action })
    .from(auditEvents)
    .where(
      and(eq(auditEvents.actorUserId, userId), eq(auditEvents.clientMutationId, clientMutationId)),
    )
    .limit(1);
  return event ?? null;
}

async function loadClient(db: Db, organizationId: string, clientId: string) {
  const [client] = await db.select().from(crmClients).where(eq(crmClients.id, clientId)).limit(1);
  if (!client || client.organizationId !== organizationId)
    throw new TRPCError({ code: "NOT_FOUND", message: "Client not found." });
  return client;
}

async function loadLead(db: Db, organizationId: string, leadId: string) {
  const [lead] = await db.select().from(crmLeads).where(eq(crmLeads.id, leadId)).limit(1);
  if (!lead || lead.organizationId !== organizationId)
    throw new TRPCError({ code: "NOT_FOUND", message: "Enquiry not found." });
  return lead;
}

function cleanPhone(value: string | null | undefined) {
  if (!value?.trim()) return null;
  const phone = normalizeIndianMobile(value);
  if (!phone) bad("Enter a valid 10-digit mobile number.");
  return phone;
}

const clientInput = z.object({
  name: z.string().trim().min(2).max(180),
  clientType: z.enum(CLIENT_TYPES),
  contactPerson: optionalText(120),
  phone: optionalText(20),
  email: z.string().trim().email().max(254).nullish().or(z.literal("")),
  gstin: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^(\d{2}[A-Z]{5}\d{4}[A-Z][1-9A-Z]Z[0-9A-Z])?$/, "GSTIN looks wrong (15 characters).")
    .nullish(),
  address: optionalText(600),
});

const lineInput = z.object({
  itemCode: optionalText(40),
  description: z.string().trim().min(2).max(500),
  unit: z.string().trim().min(1).max(20),
  quantity: z.string().trim().max(20),
  rateRupees: z.string().trim().max(20),
});

const clientsRouter = router({
  list: protectedProcedure
    .input(z.object({ query: z.string().trim().max(80).default("") }))
    .query(async ({ ctx, input }) => {
      const { db, organizationId } = await commercialAccess(ctx.user, "crm.view");
      const pattern = `%${input.query.replace(/[%_\\]/g, (c) => `\\${c}`)}%`;
      return db
        .select()
        .from(crmClients)
        .where(
          and(
            eq(crmClients.organizationId, organizationId),
            input.query
              ? or(like(crmClients.name, pattern), like(crmClients.phone, pattern))
              : undefined,
          ),
        )
        .orderBy(asc(crmClients.name))
        .limit(200);
    }),

  create: protectedProcedure
    .input(clientInput.extend({ clientMutationId: mutationId }))
    .mutation(async ({ ctx, input }) => {
      const { db, organizationId } = await commercialAccess(ctx.user, "crm.manage");
      const [existing] = await db
        .select({ id: crmClients.id })
        .from(crmClients)
        .where(eq(crmClients.clientMutationId, input.clientMutationId))
        .limit(1);
      if (existing) return { id: existing.id };
      const id = randomUUID();
      await db.transaction(async (tx) => {
        await tx.insert(crmClients).values({
          id,
          organizationId,
          name: input.name,
          clientType: input.clientType,
          contactPerson: input.contactPerson || null,
          phone: cleanPhone(input.phone),
          email: input.email || null,
          gstin: input.gstin || null,
          address: input.address || null,
          clientMutationId: input.clientMutationId,
          createdBy: ctx.user.id,
        });
        await audit(tx as unknown as Db, {
          organizationId,
          userId: ctx.user.id,
          action: "crm.client_created",
          entityType: "crm_client",
          entityId: id,
          clientMutationId: input.clientMutationId,
          after: { name: input.name, clientType: input.clientType },
        });
      });
      return { id };
    }),

  update: protectedProcedure
    .input(clientInput.extend({ clientId: uuid, status: z.enum(["Active", "Inactive"]) }))
    .mutation(async ({ ctx, input }) => {
      const { db, organizationId } = await commercialAccess(ctx.user, "crm.manage");
      const before = await loadClient(db, organizationId, input.clientId);
      await db.transaction(async (tx) => {
        await tx
          .update(crmClients)
          .set({
            name: input.name,
            clientType: input.clientType,
            contactPerson: input.contactPerson || null,
            phone: cleanPhone(input.phone),
            email: input.email || null,
            gstin: input.gstin || null,
            address: input.address || null,
            status: input.status,
          })
          .where(eq(crmClients.id, input.clientId));
        await audit(tx as unknown as Db, {
          organizationId,
          userId: ctx.user.id,
          action: "crm.client_updated",
          entityType: "crm_client",
          entityId: input.clientId,
          before: { name: before.name, status: before.status },
          after: { name: input.name, status: input.status },
        });
      });
      return { id: input.clientId };
    }),

  /** One client with their enquiries, quotations and projects. */
  detail: protectedProcedure.input(z.object({ clientId: uuid })).query(async ({ ctx, input }) => {
    const { db, organizationId } = await commercialAccess(ctx.user, "crm.view");
    const client = await loadClient(db, organizationId, input.clientId);
    const [leads, quotes] = await Promise.all([
      db
        .select()
        .from(crmLeads)
        .where(eq(crmLeads.clientId, client.id))
        .orderBy(desc(crmLeads.updatedAt))
        .limit(100),
      db
        .select()
        .from(quotations)
        .where(eq(quotations.clientId, client.id))
        .orderBy(desc(quotations.quotationDate))
        .limit(100),
    ]);
    return { client, leads, quotations: quotes };
  }),
});

const leadsRouter = router({
  /** The pipeline: enquiries with their client, owner and whether a follow-up is due. */
  list: protectedProcedure
    .input(
      z.object({
        stage: z.enum(LEAD_STAGES).nullish(),
        dueOnly: z.boolean().default(false),
      }),
    )
    .query(async ({ ctx, input }) => {
      const { db, organizationId } = await commercialAccess(ctx.user, "crm.view");
      const rows = await db
        .select({
          lead: crmLeads,
          clientName: crmClients.name,
          ownerName: users.name,
        })
        .from(crmLeads)
        .leftJoin(crmClients, eq(crmLeads.clientId, crmClients.id))
        .leftJoin(users, eq(crmLeads.ownerUserId, users.id))
        .where(
          and(
            eq(crmLeads.organizationId, organizationId),
            input.stage ? eq(crmLeads.stage, input.stage) : undefined,
            input.dueOnly ? lte(crmLeads.nextFollowUpOn, today()) : undefined,
          ),
        )
        .orderBy(asc(crmLeads.nextFollowUpOn), desc(crmLeads.updatedAt))
        .limit(300);
      const todayText = today();
      const leads = rows.map(({ lead, clientName, ownerName }) => ({
        ...lead,
        clientName,
        ownerName,
        followUpDue:
          Boolean(lead.nextFollowUpOn) &&
          String(lead.nextFollowUpOn) <= todayText &&
          !["Won", "Lost"].includes(lead.stage),
      }));
      const pipeline = LEAD_STAGES.map((stage) => {
        const inStage = leads.filter((lead) => lead.stage === stage);
        return {
          stage,
          count: inStage.length,
          valueMinor: inStage
            .reduce((sum, lead) => sum + BigInt(lead.estimatedValueMinor ?? "0"), 0n)
            .toString(),
        };
      });
      return { leads, pipeline, due: leads.filter((lead) => lead.followUpDue).length };
    }),

  create: protectedProcedure
    .input(
      z.object({
        title: z.string().trim().min(3).max(180),
        clientId: uuid.nullish(),
        contactName: optionalText(120),
        phone: optionalText(20),
        location: optionalText(180),
        source: z.enum(LEAD_SOURCES),
        estimatedValueRupees: optionalText(20),
        nextFollowUpOn: dateText.nullish(),
        note: optionalText(1000),
        clientMutationId: mutationId,
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const { db, organizationId } = await commercialAccess(ctx.user, "crm.manage");
      const [existing] = await db
        .select({ id: crmLeads.id })
        .from(crmLeads)
        .where(eq(crmLeads.clientMutationId, input.clientMutationId))
        .limit(1);
      if (existing) return { id: existing.id };
      if (input.clientId) await loadClient(db, organizationId, input.clientId);
      const id = randomUUID();
      await db.transaction(async (tx) => {
        await tx.insert(crmLeads).values({
          id,
          organizationId,
          clientId: input.clientId ?? null,
          title: input.title,
          contactName: input.contactName || null,
          phone: cleanPhone(input.phone),
          location: input.location || null,
          source: input.source,
          stage: "New",
          estimatedValueMinor: rupees(input.estimatedValueRupees, "Estimated value"),
          ownerUserId: ctx.user.id,
          nextFollowUpOn: input.nextFollowUpOn ?? null,
          clientMutationId: input.clientMutationId,
          createdBy: ctx.user.id,
        });
        if (input.note)
          await tx.insert(crmActivities).values({
            id: randomUUID(),
            organizationId,
            leadId: id,
            kind: "Note",
            note: input.note,
            createdBy: ctx.user.id,
          });
        await audit(tx as unknown as Db, {
          organizationId,
          userId: ctx.user.id,
          action: "crm.lead_created",
          entityType: "crm_lead",
          entityId: id,
          clientMutationId: input.clientMutationId,
          after: { title: input.title, source: input.source },
        });
      });
      return { id };
    }),

  detail: protectedProcedure.input(z.object({ leadId: uuid })).query(async ({ ctx, input }) => {
    const { db, organizationId } = await commercialAccess(ctx.user, "crm.view");
    const lead = await loadLead(db, organizationId, input.leadId);
    const [client, activities, quotes, owner] = await Promise.all([
      lead.clientId ? loadClient(db, organizationId, lead.clientId) : Promise.resolve(null),
      db
        .select({ activity: crmActivities, byName: users.name })
        .from(crmActivities)
        .leftJoin(users, eq(crmActivities.createdBy, users.id))
        .where(eq(crmActivities.leadId, lead.id))
        .orderBy(desc(crmActivities.createdAt))
        .limit(200),
      db
        .select()
        .from(quotations)
        .where(eq(quotations.leadId, lead.id))
        .orderBy(desc(quotations.createdAt)),
      lead.ownerUserId
        ? db.select({ name: users.name }).from(users).where(eq(users.id, lead.ownerUserId))
        : Promise.resolve([]),
    ]);
    return {
      lead,
      client,
      ownerName: owner[0]?.name ?? null,
      activities: activities.map(({ activity, byName }) => ({ ...activity, byName })),
      quotations: quotes,
    };
  }),

  /** Logs a call, visit, meeting or note, and sets the next follow-up date. */
  addActivity: protectedProcedure
    .input(
      z.object({
        leadId: uuid,
        kind: z.enum(ACTIVITY_KINDS),
        note: z.string().trim().min(2).max(2000),
        nextFollowUpOn: dateText.nullish(),
        clientMutationId: mutationId,
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const { db, organizationId } = await commercialAccess(ctx.user, "crm.manage");
      if (await replayed(db, ctx.user.id, input.clientMutationId)) return { ok: true };
      const lead = await loadLead(db, organizationId, input.leadId);
      const id = randomUUID();
      await db.transaction(async (tx) => {
        await tx.insert(crmActivities).values({
          id,
          organizationId,
          leadId: lead.id,
          kind: input.kind,
          note: input.note,
          createdBy: ctx.user.id,
        });
        if (input.nextFollowUpOn !== undefined)
          await tx
            .update(crmLeads)
            .set({ nextFollowUpOn: input.nextFollowUpOn ?? null })
            .where(eq(crmLeads.id, lead.id));
        await audit(tx as unknown as Db, {
          organizationId,
          userId: ctx.user.id,
          action: "crm.activity_logged",
          entityType: "crm_lead",
          entityId: lead.id,
          clientMutationId: input.clientMutationId,
          after: { kind: input.kind, nextFollowUpOn: input.nextFollowUpOn ?? null },
        });
      });
      return { ok: true };
    }),

  /** Moves an enquiry to another stage. Lost needs a reason; Won may link a project. */
  move: protectedProcedure
    .input(
      z.object({
        leadId: uuid,
        stage: z.enum(LEAD_STAGES),
        reason: optionalText(1000),
        projectId: uuid.nullish(),
        clientMutationId: mutationId,
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const access = await commercialAccess(ctx.user, "crm.manage");
      const { db, organizationId } = access;
      if (await replayed(db, ctx.user.id, input.clientMutationId)) return { ok: true };
      await db.transaction(async (tx) => {
        const [lead] = await tx
          .select()
          .from(crmLeads)
          .where(eq(crmLeads.id, input.leadId))
          .for("update");
        if (!lead || lead.organizationId !== organizationId)
          throw new TRPCError({ code: "NOT_FOUND", message: "Enquiry not found." });
        const problem = leadStageChange(lead.stage as LeadStage, input.stage, input.reason);
        if (problem) bad(problem.message);
        if (input.projectId) {
          const [project] = await tx
            .select({ organizationId: projects.organizationId })
            .from(projects)
            .where(eq(projects.id, input.projectId));
          if (project?.organizationId !== organizationId) bad("Project not found.");
        }
        await tx
          .update(crmLeads)
          .set({
            stage: input.stage,
            lostReason: input.stage === "Lost" ? (input.reason ?? null) : null,
            projectId: input.stage === "Won" ? (input.projectId ?? lead.projectId) : lead.projectId,
          })
          .where(eq(crmLeads.id, lead.id));
        await tx.insert(crmActivities).values({
          id: randomUUID(),
          organizationId,
          leadId: lead.id,
          kind: "Note",
          note: input.reason?.trim() || `Moved to ${input.stage}`,
          stageFrom: lead.stage,
          stageTo: input.stage,
          createdBy: ctx.user.id,
        });
        await audit(tx as unknown as Db, {
          organizationId,
          userId: ctx.user.id,
          action: "crm.lead_moved",
          entityType: "crm_lead",
          entityId: lead.id,
          clientMutationId: input.clientMutationId,
          before: { stage: lead.stage },
          after: { stage: input.stage },
          reason: input.reason ?? null,
        });
      });
      return { ok: true };
    }),
});

const quotationsRouter = router({
  list: protectedProcedure
    .input(z.object({ clientId: uuid.nullish() }))
    .query(async ({ ctx, input }) => {
      const { db, organizationId } = await commercialAccess(ctx.user, "crm.view");
      return db
        .select({ quotation: quotations, clientName: crmClients.name })
        .from(quotations)
        .innerJoin(crmClients, eq(quotations.clientId, crmClients.id))
        .where(
          and(
            eq(quotations.organizationId, organizationId),
            input.clientId ? eq(quotations.clientId, input.clientId) : undefined,
          ),
        )
        .orderBy(desc(quotations.quotationDate), desc(quotations.createdAt))
        .limit(200)
        .then((rows) => rows.map(({ quotation, clientName }) => ({ ...quotation, clientName })));
    }),

  detail: protectedProcedure
    .input(z.object({ quotationId: uuid }))
    .query(async ({ ctx, input }) => {
      const { db, organizationId } = await commercialAccess(ctx.user, "crm.view");
      const [quotation] = await db
        .select()
        .from(quotations)
        .where(eq(quotations.id, input.quotationId))
        .limit(1);
      if (!quotation || quotation.organizationId !== organizationId)
        throw new TRPCError({ code: "NOT_FOUND", message: "Quotation not found." });
      const [client, lines] = await Promise.all([
        loadClient(db, organizationId, quotation.clientId),
        db
          .select()
          .from(quotationLines)
          .where(eq(quotationLines.quotationId, quotation.id))
          .orderBy(asc(quotationLines.lineNumber)),
      ]);
      return { quotation, client, lines };
    }),

  /** Creates a quotation; the server numbers it and computes every amount. */
  create: protectedProcedure
    .input(
      z.object({
        clientId: uuid,
        leadId: uuid.nullish(),
        title: z.string().trim().min(3).max(180),
        quotationDate: dateText,
        validUntil: dateText.nullish(),
        gstPercent: z.string().trim().max(6),
        terms: optionalText(4000),
        lines: z.array(lineInput).min(1).max(200),
        clientMutationId: mutationId,
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const { db, organizationId } = await commercialAccess(ctx.user, "crm.manage");
      const [existing] = await db
        .select({ id: quotations.id, number: quotations.quotationNumber })
        .from(quotations)
        .where(eq(quotations.clientMutationId, input.clientMutationId))
        .limit(1);
      if (existing) return { id: existing.id, quotationNumber: existing.number };
      await loadClient(db, organizationId, input.clientId);
      if (input.leadId) {
        const lead = await loadLead(db, organizationId, input.leadId);
        if (lead.clientId && lead.clientId !== input.clientId)
          bad("This enquiry belongs to another client.");
      }
      const gstBps = parsePercentBps(input.gstPercent);
      if (gstBps === null) bad("GST: enter a percentage like 18 or 12.");
      if (input.validUntil && input.validUntil < input.quotationDate)
        bad("Valid until cannot be before the quotation date.");
      const lines = input.lines.map((line, index) => {
        const quantity = parseQuantity(line.quantity);
        if (quantity === null)
          bad(`Line ${index + 1}: quantity must be more than 0 (up to 3 decimals).`);
        const rate = rupees(line.rateRupees, `Line ${index + 1} rate`);
        if (!rate) bad(`Line ${index + 1}: enter the rate.`);
        return { ...line, quantityThousandths: quantity, rateMinor: BigInt(rate) };
      });
      const totals = quotationTotals(lines, gstBps);
      const prefix = `QT-${input.quotationDate.slice(0, 4)}-`;
      const id = randomUUID();
      let quotationNumber = "";
      await db.transaction(async (tx) => {
        const numbers = await tx
          .select({ number: quotations.quotationNumber })
          .from(quotations)
          .where(
            and(
              eq(quotations.organizationId, organizationId),
              like(quotations.quotationNumber, `${prefix}%`),
            ),
          );
        quotationNumber = nextNumber(
          prefix,
          numbers.map((row) => row.number),
        );
        await tx.insert(quotations).values({
          id,
          organizationId,
          clientId: input.clientId,
          leadId: input.leadId ?? null,
          quotationNumber,
          title: input.title,
          quotationDate: input.quotationDate,
          validUntil: input.validUntil ?? null,
          gstBps,
          subtotalMinor: totals.subtotalMinor.toString(),
          gstMinor: totals.gstMinor.toString(),
          totalMinor: totals.totalMinor.toString(),
          terms: input.terms || null,
          clientMutationId: input.clientMutationId,
          createdBy: ctx.user.id,
        });
        await tx.insert(quotationLines).values(
          lines.map((line, index) => ({
            id: randomUUID(),
            quotationId: id,
            lineNumber: index + 1,
            itemCode: line.itemCode || null,
            description: line.description,
            unit: line.unit,
            quantityThousandths: line.quantityThousandths.toString(),
            rateMinor: line.rateMinor.toString(),
            amountMinor: lineAmountMinor(line.quantityThousandths, line.rateMinor).toString(),
          })),
        );
        await audit(tx as unknown as Db, {
          organizationId,
          userId: ctx.user.id,
          action: "crm.quotation_created",
          entityType: "quotation",
          entityId: id,
          clientMutationId: input.clientMutationId,
          after: { quotationNumber, totalMinor: totals.totalMinor.toString() },
        });
      });
      return { id, quotationNumber };
    }),

  /** Sent, Accepted or Rejected. Accepting a quotation marks its enquiry Won. */
  setStatus: protectedProcedure
    .input(
      z.object({
        quotationId: uuid,
        status: z.enum(["Sent", "Accepted", "Rejected", "Expired"]),
        reason: optionalText(1000),
        clientMutationId: mutationId,
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const { db, organizationId } = await commercialAccess(ctx.user, "crm.manage");
      if (await replayed(db, ctx.user.id, input.clientMutationId)) return { ok: true };
      if (input.status === "Rejected" && !input.reason?.trim())
        bad("Say why the client rejected the quotation.");
      await db.transaction(async (tx) => {
        const [quotation] = await tx
          .select()
          .from(quotations)
          .where(eq(quotations.id, input.quotationId))
          .for("update");
        if (!quotation || quotation.organizationId !== organizationId)
          throw new TRPCError({ code: "NOT_FOUND", message: "Quotation not found." });
        const allowed: Record<string, string[]> = {
          Draft: ["Sent"],
          Sent: ["Accepted", "Rejected", "Expired"],
          Expired: ["Sent"],
          Rejected: [],
          Accepted: [],
        };
        if (!allowed[quotation.status]?.includes(input.status))
          bad(`A ${quotation.status} quotation cannot be marked ${input.status}.`);
        await tx
          .update(quotations)
          .set({ status: input.status })
          .where(eq(quotations.id, quotation.id));
        if (quotation.leadId) {
          const [lead] = await tx
            .select()
            .from(crmLeads)
            .where(eq(crmLeads.id, quotation.leadId))
            .for("update");
          const stage =
            input.status === "Accepted"
              ? "Won"
              : input.status === "Sent" &&
                  lead &&
                  !["Won", "Lost", "Negotiation"].includes(lead.stage)
                ? "Quotation sent"
                : null;
          if (lead && stage && lead.stage !== stage) {
            await tx.update(crmLeads).set({ stage }).where(eq(crmLeads.id, lead.id));
            await tx.insert(crmActivities).values({
              id: randomUUID(),
              organizationId,
              leadId: lead.id,
              kind: "Note",
              note: `Quotation ${quotation.quotationNumber} ${input.status.toLowerCase()}`,
              stageFrom: lead.stage,
              stageTo: stage,
              createdBy: ctx.user.id,
            });
          }
        }
        await audit(tx as unknown as Db, {
          organizationId,
          userId: ctx.user.id,
          action: "crm.quotation_status",
          entityType: "quotation",
          entityId: quotation.id,
          clientMutationId: input.clientMutationId,
          before: { status: quotation.status },
          after: { status: input.status },
          reason: input.reason ?? null,
        });
      });
      return { ok: true };
    }),
});

/** Who may be chosen as an enquiry owner, and the company's projects for linking. */
const lookups = protectedProcedure.query(async ({ ctx }) => {
  const access = await commercialAccess(ctx.user, "crm.view");
  const projectRows = access.projectIds.size
    ? await access.db
        .select({ id: projects.id, name: projects.name })
        .from(projects)
        .where(inArray(projects.id, [...access.projectIds]))
    : [];
  return {
    canManage: access.can("crm.manage"),
    stages: LEAD_STAGES,
    sources: LEAD_SOURCES,
    activityKinds: ACTIVITY_KINDS,
    clientTypes: CLIENT_TYPES,
    projects: projectRows,
  };
});

export const crmRouter = router({
  lookups,
  clients: clientsRouter,
  leads: leadsRouter,
  quotations: quotationsRouter,
});
