import { randomUUID } from "node:crypto";
import { and, eq, gte } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import {
  auditEvents,
  organizationMemberships,
  organizationSettings,
  organizations,
  projects,
  sites,
} from "../../drizzle/schema";
import { protectedProcedure, router } from "../_core/trpc";
import { getDb } from "../db";
import { aiJson, geminiKey, rateLimit, sarvamKey } from "./ai";
import { disabledModulesFor, forgetModuleSettings } from "./module-settings";
import {
  MODULES,
  MODULE_KEYS,
  cleanModuleList,
  moduleForAuditAction,
  type ModuleKey,
} from "../../lib/jp/modules";

/**
 * Company module settings: list with 30-day usage, turn modules on or off (owner, director or
 * admin), and an AI suggestion of which modules this company needs. A suggestion is never
 * applied by itself; an admin reviews and saves it.
 */

function requireDb(db: Awaited<ReturnType<typeof getDb>>) {
  if (!db)
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message: "The business data service is temporarily unavailable.",
    });
  return db;
}
type Db = ReturnType<typeof requireDb>;

const LEADER_ROLES = ["owner", "director", "admin"];

async function membershipOf(db: Db, userId: number) {
  const rows = await db
    .select({
      organizationId: organizationMemberships.organizationId,
      businessRole: organizationMemberships.businessRole,
      name: organizations.name,
    })
    .from(organizationMemberships)
    .innerJoin(organizations, eq(organizationMemberships.organizationId, organizations.id))
    .where(
      and(eq(organizationMemberships.userId, userId), eq(organizationMemberships.status, "Active")),
    )
    .limit(20);
  const leader = rows.find((row) => LEADER_ROLES.includes(row.businessRole));
  return leader ?? rows[0] ?? null;
}

async function requireLeader(db: Db, userId: number) {
  const membership = await membershipOf(db, userId);
  if (!membership)
    throw new TRPCError({ code: "FORBIDDEN", message: "Set up your company first." });
  if (!LEADER_ROLES.includes(membership.businessRole))
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "Only the owner, a director or an admin can change company modules.",
    });
  return membership;
}

async function usage(db: Db, organizationId: string) {
  const since = new Date(Date.now() - 30 * 86_400_000);
  const rows = await db
    .select({ action: auditEvents.action })
    .from(auditEvents)
    .where(and(eq(auditEvents.organizationId, organizationId), gte(auditEvents.occurredAt, since)))
    .limit(50_000);
  const counts = Object.fromEntries(MODULE_KEYS.map((key) => [key, 0])) as Record<
    ModuleKey,
    number
  >;
  for (const row of rows) {
    const module = moduleForAuditAction(row.action);
    if (module) counts[module] += 1;
  }
  return counts;
}

const suggestionSchema = {
  type: "object",
  properties: {
    summary: { type: "string" },
    turnOn: { type: "array", items: { type: "string", enum: MODULE_KEYS } },
    turnOff: { type: "array", items: { type: "string", enum: MODULE_KEYS } },
    reasons: {
      type: "array",
      items: {
        type: "object",
        properties: {
          module: { type: "string", enum: MODULE_KEYS },
          reason: { type: "string" },
        },
        required: ["module", "reason"],
      },
    },
  },
  required: ["summary", "turnOn", "turnOff", "reasons"],
};

/** Simple rules when no AI key is set: keep what is used, suggest switching off what is not. */
function ruleSuggestion(counts: Record<ModuleKey, number>, disabled: ModuleKey[]) {
  const core: ModuleKey[] = ["reports", "schedule", "materials", "issues"];
  const turnOff = MODULE_KEYS.filter(
    (key) => !core.includes(key) && !disabled.includes(key) && counts[key] === 0,
  );
  const turnOn = core.filter((key) => disabled.includes(key));
  return {
    source: "rules" as const,
    summary:
      turnOff.length === 0 && turnOn.length === 0
        ? "Your current modules match how the company works."
        : "Based on the last 30 days of activity.",
    turnOn,
    turnOff,
    reasons: [
      ...turnOff.map((module) => ({ module, reason: "Not used in the last 30 days." })),
      ...turnOn.map((module) => ({
        module,
        reason: "Daily site work usually needs this module.",
      })),
    ],
  };
}

export const modulesRouter = router({
  /** All modules with on/off state and how much each was used in the last 30 days. */
  settings: protectedProcedure.query(async ({ ctx }) => {
    const db = requireDb(await getDb());
    const membership = await membershipOf(db, ctx.user.id);
    if (!membership) return { canManage: false, modules: [], companyName: null };
    const [disabled, counts] = await Promise.all([
      disabledModulesFor(membership.organizationId),
      usage(db, membership.organizationId),
    ]);
    return {
      canManage: LEADER_ROLES.includes(membership.businessRole),
      companyName: membership.name,
      modules: MODULES.map((module) => ({
        key: module.key,
        title: module.title,
        detail: module.detail,
        enabled: !disabled.includes(module.key),
        actionsLast30Days: counts[module.key],
      })),
    };
  }),

  update: protectedProcedure
    .input(
      z.object({
        disabled: z.array(z.string()).max(MODULE_KEYS.length),
        reason: z.string().trim().max(500).nullish(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const db = requireDb(await getDb());
      const membership = await requireLeader(db, ctx.user.id);
      const disabled = cleanModuleList(input.disabled);
      const before = await disabledModulesFor(membership.organizationId);
      const [anySite] = await db
        .select({ id: sites.id })
        .from(sites)
        .innerJoin(projects, eq(sites.projectId, projects.id))
        .where(eq(projects.organizationId, membership.organizationId))
        .limit(1);
      await db.transaction(async (tx) => {
        await tx
          .insert(organizationSettings)
          .values({
            organizationId: membership.organizationId,
            disabledModules: JSON.stringify(disabled),
            updatedBy: ctx.user.id,
          })
          .onDuplicateKeyUpdate({
            set: { disabledModules: JSON.stringify(disabled), updatedBy: ctx.user.id },
          });
        await tx.insert(auditEvents).values({
          id: randomUUID(),
          organizationId: membership.organizationId,
          siteId: anySite?.id ?? null,
          actorUserId: ctx.user.id,
          action: "settings.modules_changed",
          entityType: "organization",
          entityId: membership.organizationId,
          beforeSummary: JSON.stringify({ disabled: before }),
          afterSummary: JSON.stringify({ disabled }),
          reason: input.reason?.trim() || null,
        });
      });
      forgetModuleSettings(membership.organizationId);
      return { disabled };
    }),

  /**
   * Which modules this company needs, from what the admin says about the work and the last 30
   * days of activity. Only a suggestion.
   */
  suggest: protectedProcedure
    .input(z.object({ about: z.string().trim().max(1500).default("") }))
    .mutation(async ({ ctx, input }) => {
      const db = requireDb(await getDb());
      const membership = await requireLeader(db, ctx.user.id);
      const [disabled, counts] = await Promise.all([
        disabledModulesFor(membership.organizationId),
        usage(db, membership.organizationId),
      ]);
      if (!geminiKey() && !sarvamKey()) return ruleSuggestion(counts, disabled);
      rateLimit(ctx.user.id);
      const catalogue = MODULES.map(
        (module) =>
          `- ${module.key}: ${module.title} (${module.detail}); ${
            disabled.includes(module.key) ? "OFF" : "ON"
          }; ${counts[module.key]} actions in 30 days`,
      ).join("\n");
      const prompt =
        "You advise an Indian construction company on which modules of their site app to use. " +
        "Keep the app simple: suggest turning off modules they do not need, and turning on ones " +
        "that would clearly help. Daily reports and schedule are almost always needed. Do not " +
        "suggest turning off a module with real recent use unless the admin says so. Answer " +
        "with short plain-English reasons a site owner understands.\n\n" +
        `Modules:\n${catalogue}\n\nWhat the admin says about their work:\n"""${
          input.about || "(nothing said)"
        }"""`;
      let raw: unknown;
      try {
        raw = await aiJson([{ text: prompt }], suggestionSchema, {
          system:
            `${prompt}\nReply as JSON with keys summary, turnOn, turnOff, reasons ` +
            "(array of {module, reason}). Use only the module keys listed.",
          text: input.about || "Suggest modules.",
        });
      } catch {
        return ruleSuggestion(counts, disabled);
      }
      const value = (raw ?? {}) as {
        summary?: unknown;
        turnOn?: unknown;
        turnOff?: unknown;
        reasons?: unknown;
      };
      const list = (v: unknown) => cleanModuleList(Array.isArray(v) ? v.map(String) : []);
      const turnOn = list(value.turnOn).filter((key) => disabled.includes(key));
      const turnOff = list(value.turnOff).filter((key) => !disabled.includes(key));
      const reasons = (Array.isArray(value.reasons) ? value.reasons : [])
        .map((row) => row as { module?: unknown; reason?: unknown })
        .filter(
          (row) =>
            typeof row.reason === "string" && MODULE_KEYS.includes(String(row.module) as ModuleKey),
        )
        .map((row) => ({
          module: String(row.module) as ModuleKey,
          reason: String(row.reason).slice(0, 300),
        }));
      return {
        source: "ai" as const,
        summary: typeof value.summary === "string" ? value.summary.slice(0, 600) : "",
        turnOn,
        turnOff,
        reasons,
      };
    }),
});
