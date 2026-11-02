import { randomUUID } from "node:crypto";
import { and, eq, inArray, ne } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import {
  notificationDeliveries,
  organizationMemberships,
  pushDevices,
  siteAssignments,
  userContactPreferences,
} from "../../drizzle/schema";
import { protectedProcedure, router } from "../_core/trpc";
import { getDb } from "../db";
import {
  alertText,
  expoPushRequest,
  isExpoPushToken,
  normalizeIndianMobile,
  smsRequest,
  whatsappRequest,
  type HttpRequest,
  type SmsConfig,
  type WhatsAppConfig,
} from "../../lib/jp/notify-policy";

/** Gateway settings come only from server environment variables; nothing is configured in the app. */
export function whatsappConfig(env = process.env): WhatsAppConfig | null {
  const provider = env.WHATSAPP_PROVIDER?.trim().toLowerCase();
  if (provider === "waha" && env.WAHA_URL)
    return {
      provider,
      baseUrl: env.WAHA_URL,
      apiKey: env.WAHA_API_KEY,
      session: env.WAHA_SESSION || "default",
    };
  if (
    provider === "evolution" &&
    env.EVOLUTION_URL &&
    env.EVOLUTION_API_KEY &&
    env.EVOLUTION_INSTANCE
  )
    return {
      provider,
      baseUrl: env.EVOLUTION_URL,
      apiKey: env.EVOLUTION_API_KEY,
      instance: env.EVOLUTION_INSTANCE,
    };
  if (provider === "cloud" && env.WHATSAPP_CLOUD_TOKEN && env.WHATSAPP_CLOUD_PHONE_ID)
    return {
      provider,
      token: env.WHATSAPP_CLOUD_TOKEN,
      phoneNumberId: env.WHATSAPP_CLOUD_PHONE_ID,
    };
  return null;
}

export function smsConfig(env = process.env): SmsConfig | null {
  const provider = env.SMS_PROVIDER?.trim().toLowerCase();
  if (provider === "android-sms-gateway" && env.SMS_GATEWAY_USER && env.SMS_GATEWAY_PASSWORD)
    return {
      provider,
      baseUrl: env.SMS_GATEWAY_URL || "https://api.sms-gate.app/3rdparty/v1",
      username: env.SMS_GATEWAY_USER,
      password: env.SMS_GATEWAY_PASSWORD,
    };
  if (provider === "textbee" && env.TEXTBEE_DEVICE_ID && env.TEXTBEE_API_KEY)
    return {
      provider,
      baseUrl: env.TEXTBEE_URL || "https://api.textbee.dev/api/v1",
      deviceId: env.TEXTBEE_DEVICE_ID,
      apiKey: env.TEXTBEE_API_KEY,
    };
  return null;
}

async function send(request: HttpRequest): Promise<{ ok: boolean; detail: string }> {
  try {
    const response = await fetch(request.url, {
      method: request.method,
      headers: request.headers,
      body: request.body,
      signal: AbortSignal.timeout(10_000),
    });
    await response.body?.cancel().catch(() => undefined);
    return { ok: response.ok, detail: `HTTP ${response.status}` };
  } catch (error) {
    return { ok: false, detail: error instanceof Error ? error.name : "network" };
  }
}

export type AlertEvent = {
  organizationId: string;
  siteId?: string | null;
  siteName?: string | null;
  kind: string;
  /** Shown on the lock screen: keep it generic (no amounts or identity numbers). */
  title: string;
  detail?: string | null;
  route?: string;
  recipientUserIds: number[];
  urgent?: boolean;
};

/**
 * Best-effort delivery over push, WhatsApp and SMS. Never throws: the in-app inbox stays the
 * source of truth, and every attempt is logged without the message body.
 */
export async function dispatchAlert(event: AlertEvent): Promise<void> {
  try {
    const db = await getDb();
    if (!db || !event.recipientUserIds.length) return;
    const userIds = [...new Set(event.recipientUserIds)];
    const devices = await db
      .select({ userId: pushDevices.userId, token: pushDevices.expoPushToken })
      .from(pushDevices)
      .where(and(inArray(pushDevices.userId, userIds), eq(pushDevices.status, "Active")));
    const prefs = await db
      .select()
      .from(userContactPreferences)
      .where(inArray(userContactPreferences.userId, userIds));
    const log = async (
      userId: number,
      channel: "push" | "whatsapp" | "sms",
      status: "Sent" | "Failed" | "Skipped",
      detail: string,
    ) =>
      db
        .insert(notificationDeliveries)
        .values({
          id: randomUUID(),
          organizationId: event.organizationId,
          siteId: event.siteId ?? null,
          userId,
          channel,
          eventKind: event.kind,
          status,
          detail: detail.slice(0, 255),
        })
        .catch(() => undefined);

    const pushTargets = devices.filter((device) => {
      const pref = prefs.find((row) => row.userId === device.userId);
      return pref?.pushOptIn !== "No" && isExpoPushToken(device.token);
    });
    if (pushTargets.length) {
      const result = await send(
        expoPushRequest(
          pushTargets.map((device) => ({
            to: device.token,
            title: "JP Infracon",
            body: event.title,
            data: { route: event.route ?? "/notifications" },
          })),
          process.env.EXPO_ACCESS_TOKEN,
        ),
      );
      for (const userId of new Set(pushTargets.map((device) => device.userId)))
        await log(userId, "push", result.ok ? "Sent" : "Failed", result.detail);
    }

    const text = alertText({ title: event.title, siteName: event.siteName, detail: event.detail });
    const wa = whatsappConfig();
    const sms = smsConfig();
    for (const pref of prefs) {
      const phone = normalizeIndianMobile(pref.phone);
      if (!phone) continue;
      if (pref.whatsappOptIn === "Yes" && wa) {
        const result = await send(whatsappRequest(wa, phone, text));
        await log(pref.userId, "whatsapp", result.ok ? "Sent" : "Failed", result.detail);
      }
      // SMS costs money per message, so it is kept for urgent alerts.
      if (pref.smsOptIn === "Yes" && sms && event.urgent) {
        const result = await send(smsRequest(sms, phone, text));
        await log(pref.userId, "sms", result.ok ? "Sent" : "Failed", result.detail);
      }
    }
  } catch {
    console.error("[JP] Alert dispatch failed");
  }
}

/** Organisation leaders plus the site's project managers and supervisors, minus the actor. */
export async function siteLeadIds(organizationId: string, siteId: string, excludeUserId?: number) {
  const db = await getDb();
  if (!db) return [];
  const leaders = await db
    .select({ userId: organizationMemberships.userId })
    .from(organizationMemberships)
    .where(
      and(
        eq(organizationMemberships.organizationId, organizationId),
        eq(organizationMemberships.status, "Active"),
        inArray(organizationMemberships.businessRole, ["owner", "director", "admin"]),
      ),
    );
  const team = await db
    .select({ userId: siteAssignments.userId })
    .from(siteAssignments)
    .where(
      and(
        eq(siteAssignments.siteId, siteId),
        eq(siteAssignments.status, "Active"),
        inArray(siteAssignments.assignmentRole, ["project_manager", "supervisor"]),
        ...(excludeUserId ? [ne(siteAssignments.userId, excludeUserId)] : []),
      ),
    );
  return [...new Set([...leaders, ...team].map((row) => row.userId))].filter(
    (id) => id !== excludeUserId,
  );
}

function requireDb(db: Awaited<ReturnType<typeof getDb>>) {
  if (!db)
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message: "The business data service is temporarily unavailable.",
    });
  return db;
}

export const notificationsRouter = router({
  registerDevice: protectedProcedure
    .input(
      z.object({ token: z.string().trim().max(255), platform: z.enum(["android", "ios", "web"]) }),
    )
    .mutation(async ({ ctx, input }) => {
      if (!isExpoPushToken(input.token))
        throw new TRPCError({ code: "BAD_REQUEST", message: "Invalid push token." });
      const db = requireDb(await getDb());
      await db
        .insert(pushDevices)
        .values({
          id: randomUUID(),
          userId: ctx.user.id,
          expoPushToken: input.token,
          platform: input.platform,
        })
        .onDuplicateKeyUpdate({
          set: { userId: ctx.user.id, status: "Active", lastSeenAt: new Date() },
        });
      return { ok: true };
    }),

  unregisterDevice: protectedProcedure
    .input(z.object({ token: z.string().trim().max(255) }))
    .mutation(async ({ ctx, input }) => {
      const db = requireDb(await getDb());
      await db
        .update(pushDevices)
        .set({ status: "Disabled" })
        .where(
          and(eq(pushDevices.expoPushToken, input.token), eq(pushDevices.userId, ctx.user.id)),
        );
      return { ok: true };
    }),

  preferences: protectedProcedure.query(async ({ ctx }) => {
    const db = requireDb(await getDb());
    const wa = whatsappConfig();
    const sms = smsConfig();
    let pref: typeof userContactPreferences.$inferSelect | undefined;
    try {
      [pref] = await db
        .select()
        .from(userContactPreferences)
        .where(eq(userContactPreferences.userId, ctx.user.id))
        .limit(1);
    } catch {
      pref = undefined;
    }
    return {
      phone: pref?.phone ?? "",
      whatsappOptIn: pref?.whatsappOptIn === "Yes",
      smsOptIn: pref?.smsOptIn === "Yes",
      pushOptIn: pref?.pushOptIn !== "No",
      channels: {
        whatsapp: wa?.provider ?? null,
        sms: sms?.provider ?? null,
        push: "expo" as const,
      },
    };
  }),

  updatePreferences: protectedProcedure
    .input(
      z.object({
        phone: z.string().trim().max(20),
        whatsappOptIn: z.boolean(),
        smsOptIn: z.boolean(),
        pushOptIn: z.boolean(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const phone = input.phone ? normalizeIndianMobile(input.phone) : null;
      if (input.phone && !phone)
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Enter a valid 10-digit Indian mobile number.",
        });
      if ((input.whatsappOptIn || input.smsOptIn) && !phone)
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Add your mobile number to get WhatsApp or SMS alerts.",
        });
      const db = requireDb(await getDb());
      const values = {
        phone,
        whatsappOptIn: input.whatsappOptIn ? ("Yes" as const) : ("No" as const),
        smsOptIn: input.smsOptIn ? ("Yes" as const) : ("No" as const),
        pushOptIn: input.pushOptIn ? ("Yes" as const) : ("No" as const),
      };
      await db
        .insert(userContactPreferences)
        .values({ userId: ctx.user.id, ...values })
        .onDuplicateKeyUpdate({ set: values });
      return { ok: true, phone };
    }),

  /** Sends a test alert to the caller only, on every channel they enabled. */
  sendTest: protectedProcedure.mutation(async ({ ctx }) => {
    const db = requireDb(await getDb());
    const [membership] = await db
      .select({ organizationId: organizationMemberships.organizationId })
      .from(organizationMemberships)
      .where(
        and(
          eq(organizationMemberships.userId, ctx.user.id),
          eq(organizationMemberships.status, "Active"),
        ),
      )
      .limit(1);
    if (!membership)
      throw new TRPCError({ code: "PRECONDITION_FAILED", message: "Join an organisation first." });
    await dispatchAlert({
      organizationId: membership.organizationId,
      kind: "test",
      title: "Test alert — your notifications are working",
      recipientUserIds: [ctx.user.id],
      urgent: true,
    });
    const recent = await db
      .select({
        channel: notificationDeliveries.channel,
        status: notificationDeliveries.status,
        detail: notificationDeliveries.detail,
      })
      .from(notificationDeliveries)
      .where(
        and(
          eq(notificationDeliveries.userId, ctx.user.id),
          eq(notificationDeliveries.eventKind, "test"),
        ),
      )
      .orderBy(notificationDeliveries.createdAt)
      .limit(20);
    return { results: recent.slice(-3) };
  }),
});
