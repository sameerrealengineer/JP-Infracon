import { randomUUID } from "node:crypto";
import { and, asc, desc, eq, inArray } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { auditEvents, sites, vendors, warranties, warrantyClaims } from "../../drizzle/schema";
import {
  WARRANTY_CATEGORIES,
  daysLeft,
  warrantyDateProblem,
  warrantyState,
} from "../../lib/jp/warranty-domain";
import { protectedProcedure, router } from "../_core/trpc";
import { getDb } from "../db";
import { getAccessibleSites, getSiteScope } from "./access";
import { siteCapabilities } from "./capabilities";

function requireDb(db: Awaited<ReturnType<typeof getDb>>) {
  if (!db)
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message: "The business data service is temporarily unavailable.",
    });
  return db;
}

const today = () => new Date().toISOString().slice(0, 10);
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use a date like 2026-11-14.");
const mutationId = z.string().trim().min(16).max(64);
const bad = (message: string): never => {
  throw new TRPCError({ code: "BAD_REQUEST", message });
};

/** Sites where the person may see documents (and so warranties). */
async function viewableSiteIds(user: Parameters<typeof getAccessibleSites>[0]) {
  const sitesList = await getAccessibleSites(user);
  const capabilities = await siteCapabilities(user, sitesList);
  return capabilities
    .filter((row) => (row as Record<string, unknown>)["document.view"] === true)
    .map((row) => row.siteId);
}

async function audit(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  tx: any,
  values: {
    organizationId: string;
    siteId: string;
    actorUserId: number;
    action: string;
    entityId: string;
    afterSummary?: string;
    reason?: string;
  },
) {
  await tx.insert(auditEvents).values({ id: randomUUID(), entityType: "warranty", ...values });
}

async function loadWarranty(warrantyId: string) {
  const db = requireDb(await getDb());
  const [row] = await db.select().from(warranties).where(eq(warranties.id, warrantyId)).limit(1);
  if (!row) throw new TRPCError({ code: "NOT_FOUND", message: "Warranty not found." });
  return { db, row };
}

/**
 * Warranty tracker: warranties received from suppliers and given to clients, with claims.
 * Seeing them needs document.view on the site; adding or changing needs document.upload, and
 * works on Completed sites too (warranties start at handover).
 */
export const warrantiesRouter = router({
  list: protectedProcedure
    .input(z.object({ siteId: z.string().uuid().optional() }).default({}))
    .query(async ({ ctx, input }) => {
      const db = requireDb(await getDb());
      const allowed = await viewableSiteIds(ctx.user);
      const siteIds = input.siteId ? allowed.filter((id) => id === input.siteId) : allowed;
      if (!siteIds.length) return { rows: [], counts: { active: 0, expiring: 0, expired: 0 } };
      const rows = await db
        .select({
          warranty: warranties,
          siteName: sites.name,
          vendorName: vendors.legalName,
        })
        .from(warranties)
        .innerJoin(sites, eq(warranties.siteId, sites.id))
        .leftJoin(vendors, eq(warranties.vendorId, vendors.id))
        .where(inArray(warranties.siteId, siteIds))
        .orderBy(asc(warranties.endDate))
        .limit(500);
      const ids = rows.map((row) => row.warranty.id);
      const claims = ids.length
        ? await db
            .select({ warrantyId: warrantyClaims.warrantyId, status: warrantyClaims.status })
            .from(warrantyClaims)
            .where(inArray(warrantyClaims.warrantyId, ids))
        : [];
      const now = today();
      const result = rows.map(({ warranty, siteName, vendorName }) => ({
        ...warranty,
        siteName,
        vendorName,
        state: warrantyState(warranty, now),
        daysLeft: daysLeft(warranty.endDate, now),
        openClaims: claims.filter((c) => c.warrantyId === warranty.id && c.status === "Open")
          .length,
      }));
      return {
        rows: result,
        counts: {
          active: result.filter((row) => row.state === "Active").length,
          expiring: result.filter((row) => row.state === "Expiring").length,
          expired: result.filter((row) => row.state === "Expired").length,
        },
      };
    }),

  create: protectedProcedure
    .input(
      z.object({
        siteId: z.string().uuid(),
        direction: z.enum(["Received", "Given"]),
        itemName: z.string().trim().min(2).max(180),
        category: z.enum(WARRANTY_CATEGORIES),
        vendorId: z.string().uuid().nullish(),
        partyName: z.string().trim().max(180).nullish(),
        reference: z.string().trim().max(120).nullish(),
        startDate: date,
        endDate: date,
        terms: z.string().trim().max(4000).nullish(),
        contactPhone: z.string().trim().max(40).nullish(),
        clientMutationId: mutationId,
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const scope = await getSiteScope(ctx.user, input.siteId, "document.upload", {
        allowCompletedSite: true,
      });
      const problem = warrantyDateProblem(input.startDate, input.endDate);
      if (problem) bad(problem);
      const db = requireDb(await getDb());
      const [prior] = await db
        .select({ id: warranties.id })
        .from(warranties)
        .where(
          and(
            eq(warranties.createdBy, ctx.user.id),
            eq(warranties.clientMutationId, input.clientMutationId),
          ),
        )
        .limit(1);
      if (prior) return { id: prior.id, replayed: true };
      if (input.vendorId) {
        const [vendor] = await db
          .select({ organizationId: vendors.organizationId })
          .from(vendors)
          .where(eq(vendors.id, input.vendorId))
          .limit(1);
        if (vendor?.organizationId !== scope.organizationId)
          bad("Choose a supplier of this company.");
      }
      const id = randomUUID();
      await db.transaction(async (tx) => {
        await tx.insert(warranties).values({
          id,
          organizationId: scope.organizationId,
          siteId: scope.siteId,
          direction: input.direction,
          itemName: input.itemName,
          category: input.category,
          vendorId: input.vendorId ?? null,
          partyName: input.partyName || null,
          reference: input.reference || null,
          startDate: input.startDate,
          endDate: input.endDate,
          terms: input.terms || null,
          contactPhone: input.contactPhone || null,
          createdBy: ctx.user.id,
          clientMutationId: input.clientMutationId,
        });
        await audit(tx, {
          organizationId: scope.organizationId,
          siteId: scope.siteId,
          actorUserId: ctx.user.id,
          action: "warranty.created",
          entityId: id,
          afterSummary: JSON.stringify({
            itemName: input.itemName,
            direction: input.direction,
            endDate: input.endDate,
          }),
        });
      });
      return { id, replayed: false };
    }),

  close: protectedProcedure
    .input(z.object({ warrantyId: z.string().uuid(), reason: z.string().trim().min(3).max(500) }))
    .mutation(async ({ ctx, input }) => {
      const { db, row } = await loadWarranty(input.warrantyId);
      await getSiteScope(ctx.user, row.siteId, "document.upload", { allowCompletedSite: true });
      if (row.status === "Closed") return { id: row.id };
      await db.transaction(async (tx) => {
        await tx.update(warranties).set({ status: "Closed" }).where(eq(warranties.id, row.id));
        await audit(tx, {
          organizationId: row.organizationId,
          siteId: row.siteId,
          actorUserId: ctx.user.id,
          action: "warranty.closed",
          entityId: row.id,
          reason: input.reason,
        });
      });
      return { id: row.id };
    }),

  claims: protectedProcedure
    .input(z.object({ warrantyId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const { db, row } = await loadWarranty(input.warrantyId);
      await getSiteScope(ctx.user, row.siteId, "document.view");
      return db
        .select()
        .from(warrantyClaims)
        .where(eq(warrantyClaims.warrantyId, row.id))
        .orderBy(desc(warrantyClaims.claimDate));
    }),

  addClaim: protectedProcedure
    .input(
      z.object({
        warrantyId: z.string().uuid(),
        claimDate: date,
        problem: z.string().trim().min(3).max(2000),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const { db, row } = await loadWarranty(input.warrantyId);
      await getSiteScope(ctx.user, row.siteId, "document.upload", { allowCompletedSite: true });
      if (row.status === "Closed") bad("This warranty is closed.");
      if (input.claimDate > row.endDate) bad("The warranty had ended on that date.");
      const id = randomUUID();
      await db.transaction(async (tx) => {
        await tx.insert(warrantyClaims).values({
          id,
          warrantyId: row.id,
          claimDate: input.claimDate,
          problem: input.problem,
          createdBy: ctx.user.id,
        });
        await audit(tx, {
          organizationId: row.organizationId,
          siteId: row.siteId,
          actorUserId: ctx.user.id,
          action: "warranty.claim_raised",
          entityId: row.id,
          afterSummary: JSON.stringify({ claimId: id, claimDate: input.claimDate }),
        });
      });
      return { id };
    }),

  resolveClaim: protectedProcedure
    .input(
      z.object({
        claimId: z.string().uuid(),
        status: z.enum(["Resolved", "Rejected"]),
        resolution: z.string().trim().min(3).max(2000),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const db = requireDb(await getDb());
      const [claim] = await db
        .select()
        .from(warrantyClaims)
        .where(eq(warrantyClaims.id, input.claimId))
        .limit(1);
      if (!claim) throw new TRPCError({ code: "NOT_FOUND", message: "Claim not found." });
      const { row } = await loadWarranty(claim.warrantyId);
      await getSiteScope(ctx.user, row.siteId, "document.upload", { allowCompletedSite: true });
      if (claim.status !== "Open") return { id: claim.id };
      await db.transaction(async (tx) => {
        await tx
          .update(warrantyClaims)
          .set({
            status: input.status,
            resolution: input.resolution,
            resolvedBy: ctx.user.id,
            resolvedAt: new Date(),
          })
          .where(eq(warrantyClaims.id, claim.id));
        await audit(tx, {
          organizationId: row.organizationId,
          siteId: row.siteId,
          actorUserId: ctx.user.id,
          action: "warranty.claim_closed",
          entityId: row.id,
          afterSummary: JSON.stringify({ claimId: claim.id, status: input.status }),
          reason: input.resolution,
        });
      });
      return { id: claim.id };
    }),
});
