import { randomUUID } from "node:crypto";
import { and, desc, eq, gte, inArray, isNull, or, sql, type SQL } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import {
  appReports,
  organizationMemberships,
  people,
  personSiteAssignments,
  sites,
  users,
  workerAccounts,
  type User,
} from "../../drizzle/schema";
import { protectedProcedure, publicProcedure, router } from "../_core/trpc";
import { getDb } from "../db";
import { getAccessibleSites, getSiteScope } from "./access";
import { dispatchAlert, siteLeadIds } from "./notify";
import { normalizeIndianMobile } from "../../lib/jp/notify-policy";
import {
  DUPLICATE_WINDOW_MINUTES,
  PIN_RESET_REPEAT_HOURS,
  REPORT_DETAIL_MAX,
  REPORT_MESSAGE_MAX,
  REPORT_SOURCES,
  STAFF_CATEGORY_KEYS,
  WORKER_PROBLEMS,
  cleanText,
  errorFingerprint,
  trimStack,
  type WorkerProblem,
} from "../../lib/jp/app-reports";

/**
 * Problem reports. Workers tap "something is wrong" or "forgot PIN" and the site's supervisor
 * and managers are told (inbox and alert). Staff send feedback; phones send app errors by
 * themselves. Company leaders (owner, director, admin) see and close everything; a site
 * manager with workforce.review sees and closes worker reports for their sites.
 */

type Db = NonNullable<Awaited<ReturnType<typeof getDb>>>;
function requireDb(db: Awaited<ReturnType<typeof getDb>>): Db {
  if (!db)
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message: "The business data service is temporarily unavailable.",
    });
  return db;
}

const LEADER_ROLES = ["owner", "director", "admin"] as const;

/** Simple per-key limit kept in memory (one API process; enough for tens of users). */
const hits = new Map<string, number[]>();
export function allowHit(key: string, perHour: number, now = Date.now()) {
  const recent = (hits.get(key) ?? []).filter((time) => now - time < 3_600_000);
  if (recent.length >= perHour) {
    hits.set(key, recent);
    return false;
  }
  recent.push(now);
  hits.set(key, recent);
  if (hits.size > 5000) hits.clear();
  return true;
}

async function membershipOf(db: Db, userId: number) {
  const rows = await db
    .select({
      organizationId: organizationMemberships.organizationId,
      role: organizationMemberships.businessRole,
    })
    .from(organizationMemberships)
    .where(
      and(eq(organizationMemberships.userId, userId), eq(organizationMemberships.status, "Active")),
    )
    .limit(20);
  const leader = rows.find((row) => (LEADER_ROLES as readonly string[]).includes(row.role));
  const row = leader ?? rows[0];
  return row ? { organizationId: row.organizationId, leader: Boolean(leader) } : null;
}

/** The first active site a worker is on, for routing their request. */
async function firstSiteOf(db: Db, personId: string) {
  const [row] = await db
    .select({ siteId: personSiteAssignments.siteId, siteName: sites.name })
    .from(personSiteAssignments)
    .innerJoin(sites, eq(personSiteAssignments.siteId, sites.id))
    .where(
      and(eq(personSiteAssignments.personId, personId), eq(personSiteAssignments.status, "Active")),
    )
    .limit(1);
  return row ?? null;
}

/**
 * A worker forgot their PIN. Always gives the same answer, so nobody can learn which numbers
 * have a login. A real request tells the site's supervisor and managers once in a few hours.
 */
export async function requestPinReset(mobileInput: string, clientKey: string) {
  const answer = {
    ok: true as const,
    message:
      "If this number has a worker login, your supervisor has been told. They will give you a new PIN.",
  };
  const mobile = normalizeIndianMobile(mobileInput);
  if (!mobile) bad("Enter a 10-digit Indian mobile number.");
  if (!allowHit(`pin-reset-ip:${clientKey}`, 10) || !allowHit(`pin-reset:${mobile}`, 3))
    throw new TRPCError({
      code: "TOO_MANY_REQUESTS",
      message: "Too many tries. Wait a minute and try again.",
    });
  const db = requireDb(await getDb());
  const [row] = await db
    .select({ account: workerAccounts, name: people.fullName })
    .from(workerAccounts)
    .innerJoin(people, eq(workerAccounts.personId, people.id))
    .where(eq(workerAccounts.mobile, mobile))
    .limit(1);
  if (!row || row.account.status !== "Active") return answer;
  const since = new Date(Date.now() - PIN_RESET_REPEAT_HOURS * 3_600_000);
  const [recent] = await db
    .select({ id: appReports.id })
    .from(appReports)
    .where(
      and(
        eq(appReports.source, "pin_reset"),
        eq(appReports.personId, row.account.personId),
        eq(appReports.status, "Open"),
        gte(appReports.createdAt, since),
      ),
    )
    .limit(1);
  if (recent) return answer;
  const site = await firstSiteOf(db, row.account.personId);
  await db.insert(appReports).values({
    id: randomUUID(),
    source: "pin_reset",
    organizationId: row.account.organizationId,
    siteId: site?.siteId ?? null,
    userId: row.account.userId,
    personId: row.account.personId,
    category: "pin",
    message: "Forgot PIN",
  });
  if (site)
    void siteLeadIds(row.account.organizationId, site.siteId).then((recipientUserIds) =>
      dispatchAlert({
        organizationId: row.account.organizationId,
        siteId: site.siteId,
        siteName: site.siteName,
        kind: "worker.pin_reset",
        title: `${row.name} forgot the app PIN. Set a new PIN for them.`,
        route: `/person?id=${row.account.personId}`,
        recipientUserIds,
      }),
    );
  return answer;
}

/** A signed-in worker reports a problem; their supervisor and managers are told. */
export async function workerProblem(
  db: Db,
  account: typeof workerAccounts.$inferSelect,
  personName: string,
  input: { problem: WorkerProblem; message?: string | null; appVersion?: string | null },
) {
  if (!allowHit(`worker-report:${account.userId}`, 10))
    throw new TRPCError({
      code: "TOO_MANY_REQUESTS",
      message: "You already told us. Your supervisor will call you.",
    });
  const site = await firstSiteOf(db, account.personId);
  const label = WORKER_PROBLEMS.find((item) => item.key === input.problem)?.label ?? "Problem";
  await db.insert(appReports).values({
    id: randomUUID(),
    source: "worker",
    organizationId: account.organizationId,
    siteId: site?.siteId ?? null,
    userId: account.userId,
    personId: account.personId,
    category: input.problem,
    message: cleanText(input.message, REPORT_MESSAGE_MAX),
    appVersion: cleanText(input.appVersion, 32),
  });
  if (site)
    void siteLeadIds(account.organizationId, site.siteId).then((recipientUserIds) =>
      dispatchAlert({
        organizationId: account.organizationId,
        siteId: site.siteId,
        siteName: site.siteName,
        kind: "worker.problem",
        title: `${personName} says: ${label}. Please call them.`,
        route: `/person?id=${account.personId}`,
        recipientUserIds,
      }),
    );
  return { ok: true as const };
}

/** Closes open PIN-reset requests once a new PIN has been set. */
export async function closePinResets(db: Db, personId: string, userId: number) {
  await db
    .update(appReports)
    .set({
      status: "Resolved",
      resolvedBy: userId,
      resolvedAt: new Date(),
      resolution: "New PIN set",
    })
    .where(
      and(
        eq(appReports.source, "pin_reset"),
        eq(appReports.personId, personId),
        eq(appReports.status, "Open"),
      ),
    );
}

function bad(message: string): never {
  throw new TRPCError({ code: "BAD_REQUEST", message });
}

/** What the caller may see: everything in their company (leaders) or worker reports on sites. */
async function viewScope(user: User) {
  const db = requireDb(await getDb());
  const membership = await membershipOf(db, user.id);
  if (!membership)
    throw new TRPCError({ code: "FORBIDDEN", message: "You are not in an active company." });
  if (membership.leader || user.role === "super_admin")
    return { db, organizationId: membership.organizationId, siteIds: null as string[] | null };
  const accessible = await getAccessibleSites(user);
  const siteIds: string[] = [];
  for (const site of accessible)
    if (
      await getSiteScope(user, site.id, "workforce.review")
        .then(() => true)
        .catch(() => false)
    )
      siteIds.push(site.id);
  if (!siteIds.length)
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "Only company leaders and site managers can see problem reports.",
    });
  return { db, organizationId: membership.organizationId, siteIds };
}

function scopeFilter(organizationId: string, siteIds: string[] | null): SQL {
  // Leaders also see app errors sent before anyone signed in (no company yet, no company data).
  if (!siteIds)
    return or(
      eq(appReports.organizationId, organizationId),
      and(isNull(appReports.organizationId), eq(appReports.source, "app_error")),
    )!;
  return and(
    eq(appReports.organizationId, organizationId),
    inArray(appReports.siteId, siteIds),
    inArray(appReports.source, ["worker", "pin_reset"]),
  )!;
}

const deviceFields = {
  screen: z.string().trim().max(160).nullish(),
  appVersion: z.string().trim().max(32).nullish(),
  platform: z.string().trim().max(16).nullish(),
};

export const reportsRouter = router({
  /** Staff tell the company about a problem or an idea. */
  send: protectedProcedure
    .input(
      z.object({
        category: z.enum(STAFF_CATEGORY_KEYS),
        message: z.string().trim().min(3).max(REPORT_MESSAGE_MAX),
        ...deviceFields,
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const db = requireDb(await getDb());
      if (!allowHit(`staff-report:${ctx.user.id}`, 20))
        throw new TRPCError({
          code: "TOO_MANY_REQUESTS",
          message: "Too many reports this hour. Try again later.",
        });
      const membership = await membershipOf(db, ctx.user.id);
      await db.insert(appReports).values({
        id: randomUUID(),
        source: "staff",
        organizationId: membership?.organizationId ?? null,
        userId: ctx.user.id,
        category: input.category,
        message: cleanText(input.message, REPORT_MESSAGE_MAX),
        screen: cleanText(input.screen, 160),
        appVersion: cleanText(input.appVersion, 32),
        platform: cleanText(input.platform, 16),
      });
      return { ok: true as const };
    }),

  /**
   * The phone reports an app error by itself (also before sign-in). Repeats within a few
   * minutes are counted on the first report instead of stored again; limited per phone.
   */
  appError: publicProcedure
    .input(
      z.object({
        message: z.string().trim().min(1).max(REPORT_MESSAGE_MAX),
        stack: z.string().max(20_000).nullish(),
        ...deviceFields,
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const clientKey = ctx.user
        ? `u:${ctx.user.id}`
        : `ip:${String(ctx.req.ip ?? ctx.req.socket?.remoteAddress ?? "unknown")}`;
      if (!allowHit(`app-error:${clientKey}`, 30)) return { ok: true as const, stored: false };
      const db = await getDb();
      if (!db) return { ok: true as const, stored: false };
      const message = cleanText(input.message, REPORT_MESSAGE_MAX) ?? "Unknown error";
      const screen = cleanText(input.screen, 160);
      const fingerprint = errorFingerprint(message, screen).slice(0, 255);
      let organizationId: string | null = null;
      if (ctx.user) {
        const membership = await membershipOf(db, ctx.user.id);
        organizationId = membership?.organizationId ?? null;
        if (!organizationId) {
          const [worker] = await db
            .select({ organizationId: workerAccounts.organizationId })
            .from(workerAccounts)
            .where(eq(workerAccounts.userId, ctx.user.id))
            .limit(1);
          organizationId = worker?.organizationId ?? null;
        }
      }
      const since = new Date(Date.now() - DUPLICATE_WINDOW_MINUTES * 60_000);
      const [repeat] = await db
        .select({ id: appReports.id })
        .from(appReports)
        .where(
          and(
            eq(appReports.fingerprint, fingerprint),
            gte(appReports.lastSeenAt, since),
            ctx.user ? eq(appReports.userId, ctx.user.id) : sql`${appReports.userId} is null`,
          ),
        )
        .limit(1);
      if (repeat) {
        await db
          .update(appReports)
          .set({ repeatCount: sql`${appReports.repeatCount} + 1`, lastSeenAt: new Date() })
          .where(eq(appReports.id, repeat.id));
        return { ok: true as const, stored: false };
      }
      await db.insert(appReports).values({
        id: randomUUID(),
        source: "app_error",
        organizationId,
        userId: ctx.user?.id ?? null,
        category: "error",
        message,
        detail: trimStack(input.stack, REPORT_DETAIL_MAX),
        screen,
        appVersion: cleanText(input.appVersion, 32),
        platform: cleanText(input.platform, 16),
        fingerprint,
      });
      return { ok: true as const, stored: true };
    }),

  /** Reports the caller may see, newest first. */
  list: protectedProcedure
    .input(
      z
        .object({
          status: z.enum(["Open", "Resolved"]).default("Open"),
          source: z.enum(REPORT_SOURCES).nullish(),
        })
        .default({ status: "Open" }),
    )
    .query(async ({ ctx, input }) => {
      const { db, organizationId, siteIds } = await viewScope(ctx.user);
      const rows = await db
        .select({
          report: appReports,
          personName: people.fullName,
          userName: users.name,
          siteName: sites.name,
        })
        .from(appReports)
        .leftJoin(people, eq(appReports.personId, people.id))
        .leftJoin(users, eq(appReports.userId, users.id))
        .leftJoin(sites, eq(appReports.siteId, sites.id))
        .where(
          and(
            scopeFilter(organizationId, siteIds),
            eq(appReports.status, input.status),
            input.source ? eq(appReports.source, input.source) : undefined,
          ),
        )
        .orderBy(desc(appReports.lastSeenAt))
        .limit(200);
      const counts = await db
        .select({ source: appReports.source, n: sql<number>`count(*)` })
        .from(appReports)
        .where(and(scopeFilter(organizationId, siteIds), eq(appReports.status, "Open")))
        .groupBy(appReports.source);
      return {
        canSeeAll: siteIds === null,
        openCounts: Object.fromEntries(counts.map((row) => [row.source, Number(row.n)])) as Partial<
          Record<(typeof REPORT_SOURCES)[number], number>
        >,
        items: rows.map(({ report, personName, userName, siteName }) => ({
          id: report.id,
          source: report.source,
          category: report.category,
          message: report.message,
          detail: siteIds === null ? report.detail : null,
          screen: report.screen,
          appVersion: report.appVersion,
          platform: report.platform,
          repeatCount: report.repeatCount,
          status: report.status,
          resolution: report.resolution,
          personId: report.personId,
          who: personName ?? userName ?? null,
          siteName: siteName ?? null,
          createdAt: report.createdAt.toISOString(),
          lastSeenAt: report.lastSeenAt.toISOString(),
        })),
      };
    }),

  /** Mark a report as dealt with, with a short note. */
  resolve: protectedProcedure
    .input(z.object({ id: z.string().uuid(), resolution: z.string().trim().max(300).nullish() }))
    .mutation(async ({ ctx, input }) => {
      const { db, organizationId, siteIds } = await viewScope(ctx.user);
      const [report] = await db
        .select({ id: appReports.id, status: appReports.status })
        .from(appReports)
        .where(and(eq(appReports.id, input.id), scopeFilter(organizationId, siteIds)))
        .limit(1);
      if (!report) throw new TRPCError({ code: "NOT_FOUND", message: "Report not found." });
      if (report.status === "Resolved") return { ok: true as const };
      await db
        .update(appReports)
        .set({
          status: "Resolved",
          resolvedBy: ctx.user.id,
          resolvedAt: new Date(),
          resolution: cleanText(input.resolution, 300),
        })
        .where(eq(appReports.id, report.id));
      return { ok: true as const };
    }),
});

/** Open worker requests on these sites, for the inbox. */
export async function openWorkerRequests(db: Db, siteIds: string[], limit: number) {
  if (!siteIds.length) return [];
  return db
    .select({
      id: appReports.id,
      source: appReports.source,
      category: appReports.category,
      personId: appReports.personId,
      name: people.fullName,
      siteId: appReports.siteId,
      siteName: sites.name,
      at: appReports.createdAt,
    })
    .from(appReports)
    .innerJoin(people, eq(appReports.personId, people.id))
    .innerJoin(sites, eq(appReports.siteId, sites.id))
    .where(
      and(
        inArray(appReports.siteId, siteIds),
        eq(appReports.status, "Open"),
        or(eq(appReports.source, "worker"), eq(appReports.source, "pin_reset")),
      ),
    )
    .orderBy(appReports.createdAt)
    .limit(limit);
}
