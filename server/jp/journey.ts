import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import {
  auditEvents,
  organizationMemberships,
  organizationSettings,
  organizations,
} from "../../drizzle/schema";
import { JOURNEY, journeyView, parseJourney } from "../../lib/jp/journey";
import { MODULES, cleanModuleList } from "../../lib/jp/modules";
import { protectedProcedure, router } from "../_core/trpc";
import { getDb } from "../db";
import { forgetModuleSettings, journeyCounts, journeyFor } from "./module-settings";

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

async function myCompany(db: Db, userId: number) {
  const rows = await db
    .select({
      organizationId: organizationMemberships.organizationId,
      role: organizationMemberships.businessRole,
      name: organizations.name,
    })
    .from(organizationMemberships)
    .innerJoin(organizations, eq(organizationMemberships.organizationId, organizations.id))
    .where(
      and(eq(organizationMemberships.userId, userId), eq(organizationMemberships.status, "Active")),
    )
    .limit(20);
  return rows.find((row) => LEADERS.includes(row.role)) ?? rows[0] ?? null;
}

async function requireLeader(db: Db, userId: number) {
  const company = await myCompany(db, userId);
  if (!company || !LEADERS.includes(company.role))
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "Only the owner, a director or an admin can change the steps.",
    });
  return company;
}

async function saveState(
  db: Db,
  userId: number,
  organizationId: string,
  state: { mode: "guided" | "all"; early: string[] },
  action: string,
  summary: Record<string, unknown>,
) {
  const journeyState = JSON.stringify({ mode: state.mode, early: cleanModuleList(state.early) });
  await db.transaction(async (tx) => {
    await tx
      .insert(organizationSettings)
      .values({ organizationId, journeyState, updatedBy: userId })
      .onDuplicateKeyUpdate({ set: { journeyState, updatedBy: userId } });
    await tx.insert(auditEvents).values({
      id: randomUUID(),
      organizationId,
      actorUserId: userId,
      action,
      entityType: "organization",
      entityId: organizationId,
      afterSummary: JSON.stringify(summary),
    });
  });
  forgetModuleSettings(organizationId);
}

/**
 * Step-by-step mode: where the company is, what opens the next step, and (leaders) switch the
 * mode or open the next step early. Steps open by themselves from real records.
 */
export const journeyRouter = router({
  status: protectedProcedure.query(async ({ ctx }) => {
    const db = requireDb(await getDb());
    const company = await myCompany(db, ctx.user.id);
    if (!company) return null;
    const entry = await journeyFor(company.organizationId);
    const counts = entry.counts ?? (await journeyCounts(db, company.organizationId));
    const view = journeyView(counts, entry.journey);
    const titleOf = (key: string) => MODULES.find((m) => m.key === key)?.title ?? key;
    return {
      ...view,
      canManage: LEADERS.includes(company.role),
      steps: view.steps.map((step) => ({ ...step, moduleTitles: step.modules.map(titleOf) })),
      extraTitles: view.extras.map(titleOf),
    };
  }),

  setMode: protectedProcedure
    .input(z.object({ mode: z.enum(["guided", "all"]) }))
    .mutation(async ({ ctx, input }) => {
      const db = requireDb(await getDb());
      const company = await requireLeader(db, ctx.user.id);
      const entry = await journeyFor(company.organizationId);
      await saveState(
        db,
        ctx.user.id,
        company.organizationId,
        { mode: input.mode, early: entry.journey.early },
        "settings.journey_mode",
        { mode: input.mode },
      );
      return { ok: true as const };
    }),

  /** Opens the next step now, before its goal is met. */
  openNext: protectedProcedure.mutation(async ({ ctx }) => {
    const db = requireDb(await getDb());
    const company = await requireLeader(db, ctx.user.id);
    const entry = await journeyFor(company.organizationId);
    const state = parseJourney(JSON.stringify(entry.journey));
    const next = JOURNEY.find(
      (step) => step.level > entry.level && step.modules.some((key) => !state.early.includes(key)),
    );
    if (!next) return { opened: null };
    await saveState(
      db,
      ctx.user.id,
      company.organizationId,
      { mode: state.mode, early: [...state.early, ...next.modules] },
      "settings.journey_opened_early",
      { step: next.level, modules: next.modules },
    );
    return { opened: next.title };
  }),
});
