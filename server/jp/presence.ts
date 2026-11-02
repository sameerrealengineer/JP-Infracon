import { randomUUID } from "node:crypto";
import { and, desc, eq, gte, inArray, lte } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { siteGeofences, sitePresenceEvents, sites, users } from "../../drizzle/schema";
import { protectedProcedure, router } from "../_core/trpc";
import { getDb } from "../db";
import { assertActiveAccount, getAccessibleSites, getSiteScope } from "./access";
import { dispatchAlert, siteLeadIds } from "./notify";
import { distanceMeters, presencePlausible } from "../../lib/jp/geo";

function requireDb(db: Awaited<ReturnType<typeof getDb>>) {
  if (!db)
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message: "The business data service is temporarily unavailable.",
    });
  return db;
}

export const presenceRouter = router({
  /** Site boundaries for the caller's sites, so the phone can watch for arrival and departure. */
  myFences: protectedProcedure.query(async ({ ctx }) => {
    assertActiveAccount(ctx.user);
    const db = requireDb(await getDb());
    const accessible = await getAccessibleSites(ctx.user);
    const active = accessible.filter((site) => site.status === "Active");
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
      const scope = await getSiteScope(ctx.user, input.siteId, "site.view");
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
      if (plausible)
        void siteLeadIds(scope.organizationId, scope.siteId, ctx.user.id).then((recipientUserIds) =>
          dispatchAlert({
            organizationId: scope.organizationId,
            siteId: scope.siteId,
            siteName: scope.siteName,
            kind: `presence.${input.eventType.toLowerCase()}`,
            title: `${ctx.user.name ?? "A team member"} ${input.eventType === "Arrived" ? "arrived at" : "left"} the site`,
            route: `/site/${scope.siteId}`,
            recipientUserIds,
          }),
        );
      return { id, plausible };
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
