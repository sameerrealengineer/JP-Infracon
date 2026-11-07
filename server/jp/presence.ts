import { randomUUID } from "node:crypto";
import { and, desc, eq, gte, inArray, lte } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import {
  auditEvents,
  organizationMemberships,
  people,
  personSiteAssignments,
  presenceTrackingStatus,
  siteAssignments,
  siteGeofences,
  sitePresenceEvents,
  sitePresenceSettings,
  sites,
  users,
  workerAccounts,
} from "../../drizzle/schema";
import { protectedProcedure, router } from "../_core/trpc";
import { getDb } from "../db";
import { assertActiveAccount, getAccessibleSites, getSiteScope } from "./access";
import { dispatchAlert, siteLeadIds } from "./notify";
import { distanceMeters, presencePlausible } from "../../lib/jp/geo";
import {
  DEFAULT_PRESENCE,
  checkPresenceSettings,
  istClock,
  parseDays,
  shouldAlert,
  type PresenceSettings,
} from "../../lib/jp/presence-rules";

function requireDb(db: Awaited<ReturnType<typeof getDb>>) {
  if (!db)
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message: "The business data service is temporarily unavailable.",
    });
  return db;
}

type Db = ReturnType<typeof requireDb>;

/** Staff use their site access; a worker login may report only for sites they work on. */
async function presenceScope(user: Parameters<typeof getSiteScope>[0], siteId: string) {
  try {
    return await getSiteScope(user, siteId, "site.view");
  } catch (cause) {
    const db = requireDb(await getDb());
    const [row] = await db
      .select({
        organizationId: workerAccounts.organizationId,
        siteName: sites.name,
        status: sites.status,
      })
      .from(workerAccounts)
      .innerJoin(
        personSiteAssignments,
        and(
          eq(personSiteAssignments.personId, workerAccounts.personId),
          eq(personSiteAssignments.siteId, siteId),
          eq(personSiteAssignments.status, "Active"),
        ),
      )
      .innerJoin(sites, eq(sites.id, siteId))
      .where(and(eq(workerAccounts.userId, user.id), eq(workerAccounts.status, "Active")))
      .limit(1)
      .catch(() => []);
    if (!row || row.status !== "Active") throw cause;
    return { organizationId: row.organizationId, siteId, siteName: row.siteName };
  }
}

/** A site's presence rules, or the defaults (also when the table is not migrated yet). */
async function settingsFor(db: Db, siteId: string) {
  try {
    const [row] = await db
      .select()
      .from(sitePresenceSettings)
      .where(eq(sitePresenceSettings.siteId, siteId))
      .limit(1);
    if (!row)
      return { settings: DEFAULT_PRESENCE, recipients: null as number[] | null, saved: false };
    let recipients: number[] | null = null;
    try {
      const parsed: unknown = row.recipientUserIds ? JSON.parse(row.recipientUserIds) : null;
      if (Array.isArray(parsed) && parsed.length)
        recipients = parsed.map(Number).filter((id) => Number.isInteger(id) && id > 0);
    } catch {
      recipients = null;
    }
    const settings: PresenceSettings = {
      workStart: row.workStart,
      workEnd: row.workEnd,
      workDays: parseDays(row.workDays),
      alertOnLeave: row.alertOnLeave === "Yes",
      alertOnArrive: row.alertOnArrive === "Yes",
    };
    return { settings, recipients, saved: true };
  } catch {
    return { settings: DEFAULT_PRESENCE, recipients: null as number[] | null, saved: false };
  }
}

/** Chosen recipients still active in the company, else the site leads; never the person moving. */
async function presenceRecipients(
  db: Db,
  organizationId: string,
  siteId: string,
  chosen: number[] | null,
  actorId: number,
) {
  if (!chosen?.length) return siteLeadIds(organizationId, siteId, actorId);
  const active = await db
    .select({ userId: organizationMemberships.userId })
    .from(organizationMemberships)
    .where(
      and(
        eq(organizationMemberships.organizationId, organizationId),
        eq(organizationMemberships.status, "Active"),
        inArray(organizationMemberships.userId, chosen),
      ),
    );
  return [...new Set(active.map((row) => row.userId))].filter((id) => id !== actorId);
}

export const presenceRouter = router({
  /** Site boundaries for the caller's sites, so the phone can watch for arrival and departure. */
  myFences: protectedProcedure.query(async ({ ctx }) => {
    assertActiveAccount(ctx.user);
    const db = requireDb(await getDb());
    const accessible = await getAccessibleSites(ctx.user);
    let active = accessible.filter((site) => site.status === "Active");
    if (!active.length) {
      // A worker login: the sites the worker is assigned to.
      const mine = await db
        .select({ id: sites.id, name: sites.name, status: sites.status })
        .from(workerAccounts)
        .innerJoin(
          personSiteAssignments,
          and(
            eq(personSiteAssignments.personId, workerAccounts.personId),
            eq(personSiteAssignments.status, "Active"),
          ),
        )
        .innerJoin(sites, eq(personSiteAssignments.siteId, sites.id))
        .where(and(eq(workerAccounts.userId, ctx.user.id), eq(workerAccounts.status, "Active")))
        .catch(() => []);
      active = mine.filter((site) => site.status === "Active") as typeof active;
    }
    if (!active.length) return [];
    try {
      const fences = await db
        .select()
        .from(siteGeofences)
        .where(
          inArray(
            siteGeofences.siteId,
            active.map((site) => site.id),
          ),
        );
      return fences.map((fence) => ({
        siteId: fence.siteId,
        siteName: active.find((site) => site.id === fence.siteId)?.name ?? "Site",
        latitude: Number(fence.latitude),
        longitude: Number(fence.longitude),
        radiusM: fence.radiusM,
      }));
    } catch {
      return [];
    }
  }),

  /** Arrival/departure reported by the person's own phone (opt-in). */
  record: protectedProcedure
    .input(
      z.object({
        siteId: z.string().uuid(),
        eventType: z.enum(["Arrived", "Left"]),
        latitude: z.number().min(-90).max(90).optional(),
        longitude: z.number().min(-180).max(180).optional(),
        accuracyM: z.number().min(0).max(100_000).optional(),
        occurredAt: z.coerce.date(),
        clientMutationId: z.string().trim().min(16).max(64),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const scope = await presenceScope(ctx.user, input.siteId);
      const db = requireDb(await getDb());
      const [existing] = await db
        .select({ id: sitePresenceEvents.id })
        .from(sitePresenceEvents)
        .where(eq(sitePresenceEvents.clientMutationId, input.clientMutationId))
        .limit(1);
      if (existing) return { id: existing.id, plausible: true };
      if (
        input.occurredAt.getTime() > Date.now() + 5 * 60_000 ||
        input.occurredAt.getTime() < Date.now() - 2 * 86_400_000
      )
        throw new TRPCError({ code: "BAD_REQUEST", message: "The event time is not plausible." });
      const [fence] = await db
        .select()
        .from(siteGeofences)
        .where(eq(siteGeofences.siteId, scope.siteId))
        .limit(1);
      if (!fence)
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message: "This site has no boundary set.",
        });
      let plausible = true;
      if (input.latitude !== undefined && input.longitude !== undefined) {
        const distance = distanceMeters(
          { latitude: input.latitude, longitude: input.longitude },
          { latitude: Number(fence.latitude), longitude: Number(fence.longitude) },
        );
        plausible = presencePlausible(
          input.eventType,
          distance,
          fence.radiusM,
          input.accuracyM ?? null,
        );
      }
      const id = randomUUID();
      await db.insert(sitePresenceEvents).values({
        id,
        organizationId: scope.organizationId,
        siteId: scope.siteId,
        userId: ctx.user.id,
        eventType: input.eventType,
        latitude: input.latitude?.toFixed(6) ?? null,
        longitude: input.longitude?.toFixed(6) ?? null,
        accuracyM: input.accuracyM ? Math.round(input.accuracyM) : null,
        occurredAt: input.occurredAt,
        clientMutationId: input.clientMutationId,
      });
      // Alert only inside the site's working hours, for the events the site wants, to the
      // chosen people (or the site leads). WhatsApp/SMS/push follow each person's alert rules.
      const rules = await settingsFor(db, scope.siteId);
      const alerted = plausible && shouldAlert(input.eventType, input.occurredAt, rules.settings);
      if (alerted) {
        const at = istClock(input.occurredAt).text;
        void presenceRecipients(
          db,
          scope.organizationId,
          scope.siteId,
          rules.recipients,
          ctx.user.id,
        ).then((recipientUserIds) =>
          dispatchAlert({
            organizationId: scope.organizationId,
            siteId: scope.siteId,
            siteName: scope.siteName,
            kind: `presence.${input.eventType.toLowerCase()}`,
            title: `${ctx.user.name ?? "A team member"} ${input.eventType === "Arrived" ? "arrived at" : "left"} ${scope.siteName} at ${at}`,
            route: `/site-presence?siteId=${scope.siteId}`,
            recipientUserIds,
          }),
        );
      }
      return { id, plausible, alerted };
    }),

  /** The phone says whether it is watching site boundaries, so leaders can see who is not. */
  reportTracking: protectedProcedure
    .input(
      z.object({
        enabled: z.boolean(),
        fenceCount: z.number().int().min(0).max(100),
        platform: z.string().max(20).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      assertActiveAccount(ctx.user);
      const db = requireDb(await getDb());
      const values = {
        enabled: input.enabled ? ("Yes" as const) : ("No" as const),
        fenceCount: input.fenceCount,
        platform: input.platform ?? null,
      };
      try {
        const [existing] = await db
          .select({ userId: presenceTrackingStatus.userId })
          .from(presenceTrackingStatus)
          .where(eq(presenceTrackingStatus.userId, ctx.user.id))
          .limit(1);
        if (existing)
          await db
            .update(presenceTrackingStatus)
            .set({ ...values, updatedAt: new Date() })
            .where(eq(presenceTrackingStatus.userId, ctx.user.id));
        else await db.insert(presenceTrackingStatus).values({ userId: ctx.user.id, ...values });
      } catch {
        // Older database without the table: tracking still works, status is just not shown.
      }
      return { ok: true };
    }),

  /** A site's presence rules and its team: who has tracking on, last arrival or departure. */
  siteSettings: protectedProcedure
    .input(z.object({ siteId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const scope = await getSiteScope(ctx.user, input.siteId, "site.manage");
      const db = requireDb(await getDb());
      const rules = await settingsFor(db, scope.siteId);
      const staff = await db
        .select({
          userId: siteAssignments.userId,
          role: siteAssignments.assignmentRole,
          name: users.name,
        })
        .from(siteAssignments)
        .innerJoin(users, eq(siteAssignments.userId, users.id))
        .where(and(eq(siteAssignments.siteId, scope.siteId), eq(siteAssignments.status, "Active")));
      const workers = await db
        .select({ userId: workerAccounts.userId, name: people.fullName })
        .from(workerAccounts)
        .innerJoin(people, eq(workerAccounts.personId, people.id))
        .innerJoin(
          personSiteAssignments,
          and(
            eq(personSiteAssignments.personId, workerAccounts.personId),
            eq(personSiteAssignments.siteId, scope.siteId),
            eq(personSiteAssignments.status, "Active"),
          ),
        )
        .where(eq(workerAccounts.status, "Active"))
        .catch(() => []);
      const team = [
        ...staff,
        ...workers.map((row) => ({ userId: row.userId, role: "worker", name: row.name })),
      ];
      const leaders = await db
        .select({
          userId: organizationMemberships.userId,
          role: organizationMemberships.businessRole,
          name: users.name,
        })
        .from(organizationMemberships)
        .innerJoin(users, eq(organizationMemberships.userId, users.id))
        .where(
          and(
            eq(organizationMemberships.organizationId, scope.organizationId),
            eq(organizationMemberships.status, "Active"),
            inArray(organizationMemberships.businessRole, [
              "owner",
              "director",
              "admin",
              "project_manager",
            ]),
          ),
        );
      const ids = [...new Set(team.map((row) => row.userId))];
      const [status, events, fence] = await Promise.all([
        ids.length
          ? db
              .select()
              .from(presenceTrackingStatus)
              .where(inArray(presenceTrackingStatus.userId, ids))
              .catch(() => [])
          : [],
        ids.length
          ? db
              .select({
                userId: sitePresenceEvents.userId,
                eventType: sitePresenceEvents.eventType,
                occurredAt: sitePresenceEvents.occurredAt,
              })
              .from(sitePresenceEvents)
              .where(eq(sitePresenceEvents.siteId, scope.siteId))
              .orderBy(desc(sitePresenceEvents.occurredAt))
              .limit(500)
              .catch(() => [])
          : [],
        db
          .select({ radiusM: siteGeofences.radiusM })
          .from(siteGeofences)
          .where(eq(siteGeofences.siteId, scope.siteId))
          .limit(1),
      ]);
      const directory = new Map<number, { name: string | null; role: string }>();
      for (const row of [...leaders, ...staff])
        directory.set(row.userId, { name: row.name, role: row.role });
      return {
        siteName: scope.siteName,
        hasBoundary: fence.length > 0,
        saved: rules.saved,
        settings: rules.settings,
        recipients: rules.recipients,
        choices: [...directory.entries()].map(([userId, row]) => ({ userId, ...row })),
        team: ids.map((userId) => {
          const tracking = status.find((row) => row.userId === userId);
          const last = events.find((row) => row.userId === userId);
          return {
            userId,
            name:
              team.find((row) => row.userId === userId)?.name ??
              directory.get(userId)?.name ??
              null,
            role: team.find((row) => row.userId === userId)?.role ?? "",
            tracking: tracking ? tracking.enabled === "Yes" : null,
            trackingUpdatedAt: tracking?.updatedAt ?? null,
            lastEvent: last ? { eventType: last.eventType, occurredAt: last.occurredAt } : null,
          };
        }),
      };
    }),

  saveSiteSettings: protectedProcedure
    .input(
      z.object({
        siteId: z.string().uuid(),
        workStart: z.string().max(5),
        workEnd: z.string().max(5),
        workDays: z.array(z.number().int().min(0).max(6)).max(7),
        alertOnLeave: z.boolean(),
        alertOnArrive: z.boolean(),
        recipientUserIds: z.array(z.number().int().positive()).max(50),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const scope = await getSiteScope(ctx.user, input.siteId, "site.manage");
      const db = requireDb(await getDb());
      const settings: PresenceSettings = {
        workStart: input.workStart,
        workEnd: input.workEnd,
        workDays: [...new Set(input.workDays)].sort(),
        alertOnLeave: input.alertOnLeave,
        alertOnArrive: input.alertOnArrive,
      };
      const problem = checkPresenceSettings(settings);
      if (problem) throw new TRPCError({ code: "BAD_REQUEST", message: problem });
      const recipients = [...new Set(input.recipientUserIds)];
      if (recipients.length) {
        const members = await db
          .select({ userId: organizationMemberships.userId })
          .from(organizationMemberships)
          .where(
            and(
              eq(organizationMemberships.organizationId, scope.organizationId),
              eq(organizationMemberships.status, "Active"),
              inArray(organizationMemberships.userId, recipients),
            ),
          );
        if (new Set(members.map((row) => row.userId)).size !== recipients.length)
          throw new TRPCError({ code: "BAD_REQUEST", message: "Choose people from your company." });
      }
      const values = {
        organizationId: scope.organizationId,
        workStart: settings.workStart,
        workEnd: settings.workEnd,
        workDays: settings.workDays.join(","),
        alertOnLeave: settings.alertOnLeave ? ("Yes" as const) : ("No" as const),
        alertOnArrive: settings.alertOnArrive ? ("Yes" as const) : ("No" as const),
        recipientUserIds: recipients.length ? JSON.stringify(recipients) : null,
        updatedBy: ctx.user.id,
      };
      await db.transaction(async (tx) => {
        const [existing] = await tx
          .select({ siteId: sitePresenceSettings.siteId })
          .from(sitePresenceSettings)
          .where(eq(sitePresenceSettings.siteId, scope.siteId))
          .for("update");
        if (existing)
          await tx
            .update(sitePresenceSettings)
            .set(values)
            .where(eq(sitePresenceSettings.siteId, scope.siteId));
        else await tx.insert(sitePresenceSettings).values({ siteId: scope.siteId, ...values });
        await tx.insert(auditEvents).values({
          id: randomUUID(),
          organizationId: scope.organizationId,
          siteId: scope.siteId,
          actorUserId: ctx.user.id,
          action: "site.presence_settings",
          entityType: "site",
          entityId: scope.siteId,
          afterSummary: JSON.stringify({ ...settings, recipients }),
        });
      });
      return { ok: true };
    }),

  /** Today's arrivals and departures for a site (site leads). */
  log: protectedProcedure
    .input(z.object({ siteId: z.string().uuid(), date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/) }))
    .query(async ({ ctx, input }) => {
      const scope = await getSiteScope(ctx.user, input.siteId, "attendance.view");
      const db = requireDb(await getDb());
      const from = new Date(`${input.date}T00:00:00+05:30`);
      const to = new Date(from.getTime() + 86_400_000);
      try {
        return await db
          .select({
            id: sitePresenceEvents.id,
            name: users.name,
            eventType: sitePresenceEvents.eventType,
            occurredAt: sitePresenceEvents.occurredAt,
            accuracyM: sitePresenceEvents.accuracyM,
          })
          .from(sitePresenceEvents)
          .innerJoin(users, eq(sitePresenceEvents.userId, users.id))
          .innerJoin(sites, eq(sitePresenceEvents.siteId, sites.id))
          .where(
            and(
              eq(sitePresenceEvents.siteId, scope.siteId),
              gte(sitePresenceEvents.occurredAt, from),
              lte(sitePresenceEvents.occurredAt, to),
            ),
          )
          .orderBy(desc(sitePresenceEvents.occurredAt))
          .limit(300);
      } catch {
        return [];
      }
    }),
});
