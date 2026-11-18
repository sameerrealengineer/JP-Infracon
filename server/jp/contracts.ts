import { randomUUID } from "node:crypto";
import { and, count, desc, eq, inArray } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { auditEvents, guarantees, projects, tenders, timeExtensions } from "../../drizzle/schema";
import {
  GUARANTEE_INSTRUMENTS,
  GUARANTEE_KINDS,
  TENDER_STATUSES,
  daysUntil,
  extendedCompletion,
  guaranteeProblem,
  guaranteeState,
  lockedByKind,
  quotedPercent,
  tenderCode,
  tenderMoveProblem,
} from "../../lib/jp/contract-domain";
import { parseRupeesToMinor } from "../../lib/jp/finance-domain";
import { protectedProcedure, router } from "../_core/trpc";
import { commercialAccess, requireProject, type CommercialAccess } from "./commercial-access";

const mutationIdSchema = z.string().trim().min(16).max(64);
const dateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const rupees = z.string().trim().max(20);

function todayIst() {
  return new Date(Date.now() + 330 * 60_000).toISOString().slice(0, 10);
}

function paise(text: string | undefined | null, label: string): string | null {
  if (!text) return null;
  try {
    return parseRupeesToMinor(text.replace(/,/g, ""), true);
  } catch {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: `${label}: enter rupees with up to 2 decimals.`,
    });
  }
}

async function audit(
  access: CommercialAccess,
  userId: number,
  action: string,
  entityType: string,
  entityId: string,
  after: Record<string, unknown>,
  reason?: string,
) {
  await access.db.insert(auditEvents).values({
    id: randomUUID(),
    organizationId: access.organizationId,
    actorUserId: userId,
    action,
    entityType,
    entityId,
    afterSummary: JSON.stringify(after),
    reason: reason ?? null,
  });
}

/**
 * Tenders & contracts (company level, `contract.*`): tender register with EMD and result,
 * guarantees and deposits with expiry, and extensions of time per project.
 */
export const contractsRouter = router({
  overview: protectedProcedure.query(async ({ ctx }) => {
    const access = await commercialAccess(ctx.user, "contract.view");
    const db = access.db;
    const today = todayIst();
    const [tenderRows, guaranteeRows, extensionRows, projectRows] = await Promise.all([
      db
        .select()
        .from(tenders)
        .where(eq(tenders.organizationId, access.organizationId))
        .orderBy(desc(tenders.createdAt)),
      db
        .select()
        .from(guarantees)
        .where(eq(guarantees.organizationId, access.organizationId))
        .orderBy(desc(guarantees.createdAt)),
      db
        .select()
        .from(timeExtensions)
        .where(eq(timeExtensions.organizationId, access.organizationId))
        .orderBy(desc(timeExtensions.createdAt)),
      db
        .select({ id: projects.id, name: projects.name, targetEndDate: projects.targetEndDate })
        .from(projects)
        .where(eq(projects.organizationId, access.organizationId)),
    ]);
    const visibleProject = (id: string | null) =>
      !id ||
      access.projectIds.has(id) ||
      access.role === "owner" ||
      access.role === "director" ||
      access.role === "admin";
    const g = guaranteeRows
      .filter((row) => visibleProject(row.projectId))
      .map((row) => ({
        ...row,
        amountMinor: String(row.amountMinor),
        state: guaranteeState(row, today),
        daysLeft: row.expiryDate ? daysUntil(row.expiryDate, today) : null,
      }));
    const lostTenders = new Set(
      tenderRows
        .filter((row) => ["Lost", "Withdrawn", "Cancelled"].includes(row.status))
        .map((row) => row.id),
    );
    const projectName = new Map(projectRows.map((p) => [p.id, p.name]));
    const grantedByProject = new Map<string, number[]>();
    for (const e of extensionRows)
      if (e.status === "Granted" && e.grantedDays)
        grantedByProject.set(e.projectId, [
          ...(grantedByProject.get(e.projectId) ?? []),
          e.grantedDays,
        ]);
    return {
      today,
      canManage: access.can("contract.manage"),
      canApprove: access.can("contract.approve"),
      kinds: GUARANTEE_KINDS,
      instruments: GUARANTEE_INSTRUMENTS,
      statuses: TENDER_STATUSES,
      projects: projectRows
        .filter((p) => visibleProject(p.id))
        .map((p) => ({ id: p.id, name: p.name, targetEndDate: p.targetEndDate })),
      summary: {
        locked: lockedByKind(g),
        expiringSoon: g.filter((row) => row.state === "Expiring").length,
        expired: g.filter((row) => row.state === "Expired").length,
        emdToRecover: g
          .filter(
            (row) =>
              row.kind === "EMD" &&
              row.status === "Active" &&
              row.tenderId &&
              lostTenders.has(row.tenderId),
          )
          .reduce((sum, row) => sum + BigInt(row.amountMinor), 0n)
          .toString(),
        tendersOpen: tenderRows.filter((row) =>
          ["Preparing", "Submitted", "Opened"].includes(row.status),
        ).length,
        tendersWon: tenderRows.filter((row) => row.status === "Won").length,
      },
      tenders: tenderRows.map((row) => ({
        ...row,
        estimateMinor: row.estimateMinor === null ? null : String(row.estimateMinor),
        quotedMinor: row.quotedMinor === null ? null : String(row.quotedMinor),
        quotedPercent: quotedPercent(
          row.estimateMinor === null ? null : String(row.estimateMinor),
          row.quotedMinor === null ? null : String(row.quotedMinor),
        ),
        bidDueInDays: row.bidDueDate ? daysUntil(row.bidDueDate, today) : null,
        projectName: row.projectId ? (projectName.get(row.projectId) ?? null) : null,
      })),
      guarantees: g.map((row) => ({
        ...row,
        projectName: row.projectId ? (projectName.get(row.projectId) ?? null) : null,
        tenderCode: row.tenderId
          ? (tenderRows.find((t) => t.id === row.tenderId)?.code ?? null)
          : null,
      })),
      extensions: extensionRows
        .filter((row) => visibleProject(row.projectId))
        .map((row) => ({
          ...row,
          projectName: projectName.get(row.projectId) ?? "",
          newCompletion: extendedCompletion(
            row.stipulatedCompletion,
            grantedByProject.get(row.projectId) ?? [],
          ),
        })),
    };
  }),

  createTender: protectedProcedure
    .input(
      z.object({
        nitNumber: z.string().trim().min(2).max(120),
        department: z.string().trim().min(2).max(180),
        workName: z.string().trim().min(3).max(300),
        location: z.string().trim().max(180).optional(),
        estimateRupees: rupees.optional(),
        bidDueDate: dateSchema.optional(),
        bidOpeningDate: dateSchema.optional(),
        bidValidityDate: dateSchema.optional(),
        clientMutationId: mutationIdSchema,
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const access = await commercialAccess(ctx.user, "contract.manage");
      const db = access.db;
      const [prior] = await db
        .select({ id: tenders.id, code: tenders.code })
        .from(tenders)
        .where(eq(tenders.clientMutationId, input.clientMutationId))
        .limit(1);
      if (prior) return prior;
      const id = randomUUID();
      let code = "";
      await db.transaction(async (tx) => {
        const year = Number(todayIst().slice(0, 4));
        const [n] = await tx
          .select({ n: count() })
          .from(tenders)
          .where(eq(tenders.organizationId, access.organizationId));
        code = tenderCode(year, Number(n?.n ?? 0) + 1);
        await tx.insert(tenders).values({
          id,
          organizationId: access.organizationId,
          code,
          nitNumber: input.nitNumber,
          department: input.department,
          workName: input.workName,
          location: input.location || null,
          estimateMinor: paise(input.estimateRupees, "Estimated value"),
          bidDueDate: input.bidDueDate || null,
          bidOpeningDate: input.bidOpeningDate || null,
          bidValidityDate: input.bidValidityDate || null,
          clientMutationId: input.clientMutationId,
          createdBy: ctx.user.id,
        });
        await tx.insert(auditEvents).values({
          id: randomUUID(),
          organizationId: access.organizationId,
          actorUserId: ctx.user.id,
          action: "tender.created",
          entityType: "tender",
          entityId: id,
          afterSummary: JSON.stringify({ code, nit: input.nitNumber }),
        });
      });
      return { id, code };
    }),

  moveTender: protectedProcedure
    .input(
      z.object({
        id: z.string().uuid(),
        to: z.enum(TENDER_STATUSES),
        quotedRupees: rupees.optional(),
        rank: z.string().trim().max(20).optional(),
        resultNote: z.string().trim().max(1000).optional(),
        projectId: z.string().uuid().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const access = await commercialAccess(ctx.user, "contract.manage");
      const db = access.db;
      await db.transaction(async (tx) => {
        const [row] = await tx
          .select()
          .from(tenders)
          .where(and(eq(tenders.id, input.id), eq(tenders.organizationId, access.organizationId)))
          .for("update")
          .limit(1);
        if (!row) throw new TRPCError({ code: "NOT_FOUND", message: "Tender not found." });
        const problem = tenderMoveProblem(row.status, input.to);
        if (problem) throw new TRPCError({ code: "CONFLICT", message: problem });
        if (["Lost", "Withdrawn", "Cancelled"].includes(input.to) && !input.resultNote?.trim())
          throw new TRPCError({ code: "BAD_REQUEST", message: "Write the reason or result." });
        if (input.projectId) requireProject(access, input.projectId);
        const quoted = paise(input.quotedRupees, "Quoted value");
        await tx
          .update(tenders)
          .set({
            status: input.to,
            quotedMinor: quoted ?? row.quotedMinor,
            rank: input.rank || row.rank,
            resultNote: input.resultNote || row.resultNote,
            projectId: input.projectId || row.projectId,
          })
          .where(eq(tenders.id, row.id));
        await tx.insert(auditEvents).values({
          id: randomUUID(),
          organizationId: access.organizationId,
          actorUserId: ctx.user.id,
          action: `tender.${input.to.toLowerCase()}`,
          entityType: "tender",
          entityId: row.id,
          beforeSummary: JSON.stringify({ status: row.status }),
          afterSummary: JSON.stringify({ status: input.to, rank: input.rank ?? null }),
          reason: input.resultNote ?? null,
        });
      });
      return { ok: true as const };
    }),

  addGuarantee: protectedProcedure
    .input(
      z.object({
        tenderId: z.string().uuid().optional(),
        projectId: z.string().uuid().optional(),
        kind: z.string(),
        instrument: z.string(),
        bankName: z.string().trim().max(160).optional(),
        instrumentNumber: z.string().trim().max(120).optional(),
        beneficiary: z.string().trim().max(180).optional(),
        amountRupees: rupees,
        issueDate: dateSchema,
        expiryDate: dateSchema.optional(),
        claimDate: dateSchema.optional(),
        note: z.string().trim().max(1000).optional(),
        clientMutationId: mutationIdSchema,
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const access = await commercialAccess(ctx.user, "contract.manage");
      const db = access.db;
      if (input.projectId) requireProject(access, input.projectId);
      const amount = paise(input.amountRupees, "Amount") ?? "0";
      const problem = guaranteeProblem({
        kind: input.kind,
        instrument: input.instrument,
        amountMinor: BigInt(amount),
        issueDate: input.issueDate,
        expiryDate: input.expiryDate ?? null,
      });
      if (problem) throw new TRPCError({ code: "BAD_REQUEST", message: problem });
      const [prior] = await db
        .select({ id: guarantees.id })
        .from(guarantees)
        .where(eq(guarantees.clientMutationId, input.clientMutationId))
        .limit(1);
      if (prior) return prior;
      if (input.tenderId) {
        const [t] = await db
          .select({ id: tenders.id })
          .from(tenders)
          .where(
            and(eq(tenders.id, input.tenderId), eq(tenders.organizationId, access.organizationId)),
          )
          .limit(1);
        if (!t) throw new TRPCError({ code: "NOT_FOUND", message: "Tender not found." });
      }
      const id = randomUUID();
      await db.transaction(async (tx) => {
        await tx.insert(guarantees).values({
          id,
          organizationId: access.organizationId,
          tenderId: input.tenderId || null,
          projectId: input.projectId || null,
          kind: input.kind,
          instrument: input.instrument,
          bankName: input.bankName || null,
          instrumentNumber: input.instrumentNumber || null,
          beneficiary: input.beneficiary || null,
          amountMinor: amount,
          issueDate: input.issueDate,
          expiryDate: input.expiryDate || null,
          claimDate: input.claimDate || null,
          note: input.note || null,
          clientMutationId: input.clientMutationId,
          createdBy: ctx.user.id,
        });
        await tx.insert(auditEvents).values({
          id: randomUUID(),
          organizationId: access.organizationId,
          actorUserId: ctx.user.id,
          action: "guarantee.added",
          entityType: "guarantee",
          entityId: id,
          afterSummary: JSON.stringify({
            kind: input.kind,
            amountMinor: amount,
            expiry: input.expiryDate ?? null,
          }),
        });
      });
      return { id };
    }),

  renewGuarantee: protectedProcedure
    .input(
      z.object({
        id: z.string().uuid(),
        expiryDate: dateSchema,
        claimDate: dateSchema.optional(),
        note: z.string().trim().min(3).max(500),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const access = await commercialAccess(ctx.user, "contract.manage");
      const [row] = await access.db
        .select()
        .from(guarantees)
        .where(
          and(eq(guarantees.id, input.id), eq(guarantees.organizationId, access.organizationId)),
        )
        .limit(1);
      if (!row) throw new TRPCError({ code: "NOT_FOUND", message: "Guarantee not found." });
      if (row.status !== "Active")
        throw new TRPCError({
          code: "CONFLICT",
          message: "Only an active guarantee can be extended.",
        });
      if (input.expiryDate <= (row.expiryDate ?? row.issueDate))
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "The new expiry must be after the current one.",
        });
      await access.db
        .update(guarantees)
        .set({ expiryDate: input.expiryDate, claimDate: input.claimDate || row.claimDate })
        .where(eq(guarantees.id, row.id));
      await audit(
        access,
        ctx.user.id,
        "guarantee.extended",
        "guarantee",
        row.id,
        { from: row.expiryDate, to: input.expiryDate },
        input.note,
      );
      return { ok: true as const };
    }),

  closeGuarantee: protectedProcedure
    .input(
      z.object({
        id: z.string().uuid(),
        status: z.enum(["Released", "Encashed"]),
        closedOn: dateSchema,
        note: z.string().trim().min(3).max(500),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const access = await commercialAccess(
        ctx.user,
        input.status === "Encashed" ? "contract.approve" : "contract.manage",
      );
      if (input.closedOn > todayIst())
        throw new TRPCError({ code: "BAD_REQUEST", message: "The date cannot be in the future." });
      const [row] = await access.db
        .select()
        .from(guarantees)
        .where(
          and(eq(guarantees.id, input.id), eq(guarantees.organizationId, access.organizationId)),
        )
        .limit(1);
      if (!row) throw new TRPCError({ code: "NOT_FOUND", message: "Guarantee not found." });
      if (row.status !== "Active")
        throw new TRPCError({ code: "CONFLICT", message: "This guarantee is already closed." });
      await access.db
        .update(guarantees)
        .set({ status: input.status, closedOn: input.closedOn, note: input.note })
        .where(eq(guarantees.id, row.id));
      await audit(
        access,
        ctx.user.id,
        `guarantee.${input.status.toLowerCase()}`,
        "guarantee",
        row.id,
        { status: input.status, on: input.closedOn },
        input.note,
      );
      return { ok: true as const };
    }),

  addExtension: protectedProcedure
    .input(
      z.object({
        projectId: z.string().uuid(),
        stipulatedCompletion: dateSchema,
        requestedDays: z.number().int().min(1).max(3650),
        basis: z.string().trim().min(5).max(2000),
        letterReference: z.string().trim().max(160).optional(),
        requestDate: dateSchema,
        clientMutationId: mutationIdSchema,
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const access = await commercialAccess(ctx.user, "contract.manage");
      requireProject(access, input.projectId);
      const [prior] = await access.db
        .select({ id: timeExtensions.id })
        .from(timeExtensions)
        .where(eq(timeExtensions.clientMutationId, input.clientMutationId))
        .limit(1);
      if (prior) return prior;
      const id = randomUUID();
      await access.db.insert(timeExtensions).values({
        id,
        organizationId: access.organizationId,
        projectId: input.projectId,
        stipulatedCompletion: input.stipulatedCompletion,
        requestedDays: input.requestedDays,
        basis: input.basis,
        letterReference: input.letterReference || null,
        requestDate: input.requestDate,
        clientMutationId: input.clientMutationId,
        createdBy: ctx.user.id,
      });
      await audit(access, ctx.user.id, "extension.requested", "time_extension", id, {
        days: input.requestedDays,
      });
      return { id };
    }),

  decideExtension: protectedProcedure
    .input(
      z.object({
        id: z.string().uuid(),
        status: z.enum(["Granted", "Rejected"]),
        grantedDays: z.number().int().min(0).max(3650).optional(),
        decisionDate: dateSchema,
        decisionReference: z.string().trim().max(160).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const access = await commercialAccess(ctx.user, "contract.manage");
      const [row] = await access.db
        .select()
        .from(timeExtensions)
        .where(
          and(
            eq(timeExtensions.id, input.id),
            eq(timeExtensions.organizationId, access.organizationId),
          ),
        )
        .limit(1);
      if (!row) throw new TRPCError({ code: "NOT_FOUND", message: "Extension not found." });
      if (row.status !== "Requested")
        throw new TRPCError({ code: "CONFLICT", message: "This extension is already decided." });
      if (input.status === "Granted" && !input.grantedDays)
        throw new TRPCError({ code: "BAD_REQUEST", message: "Enter the days granted." });
      await access.db
        .update(timeExtensions)
        .set({
          status: input.status,
          grantedDays: input.status === "Granted" ? input.grantedDays! : 0,
          decisionDate: input.decisionDate,
          decisionReference: input.decisionReference || null,
        })
        .where(eq(timeExtensions.id, row.id));
      await audit(
        access,
        ctx.user.id,
        `extension.${input.status.toLowerCase()}`,
        "time_extension",
        row.id,
        { days: input.grantedDays ?? 0 },
      );
      return { ok: true as const };
    }),
});

/** Guarantees expiring within 30 days or already expired (for the night summary). */
export async function guaranteesNeedingAction(
  access: Pick<CommercialAccess, "db" | "organizationId">,
) {
  const today = todayIst();
  const rows = await access.db
    .select({
      kind: guarantees.kind,
      amountMinor: guarantees.amountMinor,
      expiryDate: guarantees.expiryDate,
      status: guarantees.status,
      bank: guarantees.bankName,
    })
    .from(guarantees)
    .where(
      and(
        eq(guarantees.organizationId, access.organizationId),
        inArray(guarantees.status, ["Active"]),
      ),
    )
    .catch(() => []);
  return rows
    .map((row) => ({
      ...row,
      amountMinor: String(row.amountMinor),
      state: guaranteeState(row, today),
    }))
    .filter((row) => row.state === "Expiring" || row.state === "Expired");
}
