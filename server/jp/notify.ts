import { randomUUID } from "node:crypto";
import { and, desc, eq, inArray, ne } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import {
  alertRules,
  auditEvents,
  notificationDeliveries,
  userAlertMutes,
  organizationMemberships,
  pushDevices,
  siteAssignments,
  userContactPreferences,
  users,
} from "../../drizzle/schema";
import { protectedProcedure, router } from "../_core/trpc";
import { getDb } from "../db";
import {
  alertText,
  expoPushRequest,
  isExpoPushToken,
  normalizeIndianMobile,
  smsRequest,
  whatsappMediaRequest,
  whatsappRequest,
  type HttpRequest,
  type WhatsAppMedia,
  type SmsConfig,
  type WhatsAppConfig,
} from "../../lib/jp/notify-policy";
import {
  ALERT_CATEGORIES,
  ALERT_CATEGORY_KEYS,
  ALERT_ROLES,
  alertCategoryOf,
  cleanRules,
  decideChannels,
  ruleFor,
  type AlertRole,
  type AlertRule,
} from "../../lib/jp/alert-rules";
import { disabledModulesFor } from "./module-settings";

/** Gateway settings come only from server environment variables; nothing is configured in the app. */
export function whatsappConfig(env = process.env): WhatsAppConfig | null {
  const provider = env.WHATSAPP_PROVIDER?.trim().toLowerCase();
  if (provider === "openwa" && env.OPENWA_URL && env.OPENWA_API_KEY && env.OPENWA_SESSION)
    return {
      provider,
      baseUrl: env.OPENWA_URL,
      apiKey: env.OPENWA_API_KEY,
      session: env.OPENWA_SESSION.trim(),
    };
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
  /** Optional photo, video or document sent on WhatsApp after the text. */
  media?: WhatsAppMedia | null;
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
    const [devices, prefs, rules, mutes, roles, disabledModules] = await Promise.all([
      db
        .select({ userId: pushDevices.userId, token: pushDevices.expoPushToken })
        .from(pushDevices)
        .where(and(inArray(pushDevices.userId, userIds), eq(pushDevices.status, "Active"))),
      db
        .select()
        .from(userContactPreferences)
        .where(inArray(userContactPreferences.userId, userIds)),
      companyRules(event.organizationId),
      db
        .select({ userId: userAlertMutes.userId, category: userAlertMutes.category })
        .from(userAlertMutes)
        .where(inArray(userAlertMutes.userId, userIds))
        .catch(() => []),
      recipientRoles(event.organizationId, event.siteId ?? null, userIds),
      disabledModulesFor(event.organizationId),
    ]);
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

    // Company rules, personal mutes and opt-ins decide each person's channels.
    const decisions = new Map(
      userIds.map((userId) => {
        const pref = prefs.find((row) => row.userId === userId);
        return [
          userId,
          decideChannels({
            kind: event.kind,
            role: roles.get(userId) ?? null,
            rules,
            mutedCategories: mutes
              .filter((row) => row.userId === userId)
              .map((row) => row.category),
            disabledModules,
            optIn: {
              push: pref?.pushOptIn !== "No",
              whatsapp: pref?.whatsappOptIn === "Yes",
              sms: pref?.smsOptIn === "Yes",
            },
            urgent: Boolean(event.urgent),
          }),
        ] as const;
      }),
    );
    for (const [userId, decision] of decisions)
      if (decision.skipped) await log(userId, "push", "Skipped", decision.skipped);

    const pushTargets = devices.filter(
      (device) => decisions.get(device.userId)?.push && isExpoPushToken(device.token),
    );
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

    const fullText = alertText({
      title: event.title,
      siteName: event.siteName,
      detail: event.detail,
    });
    const shortText = alertText({ title: event.title, siteName: event.siteName, detail: null });
    const wa = whatsappConfig();
    const sms = smsConfig();
    for (const pref of prefs) {
      const decision = decisions.get(pref.userId);
      const phone = normalizeIndianMobile(pref.phone);
      if (!phone || !decision) continue;
      const text = decision.detail === "full" ? fullText : shortText;
      if (decision.whatsapp && wa) {
        const result = await send(whatsappRequest(wa, phone, text));
        await log(pref.userId, "whatsapp", result.ok ? "Sent" : "Failed", result.detail);
        if (result.ok && event.media && decision.detail === "full") {
          const media = await send(whatsappMediaRequest(wa, phone, event.media));
          await log(pref.userId, "whatsapp", media.ok ? "Sent" : "Failed", `media ${media.detail}`);
        }
      }
      // SMS costs money per message, so it is kept for urgent alerts (decideChannels).
      if (decision.sms && sms) {
        const result = await send(smsRequest(sms, phone, text));
        await log(pref.userId, "sms", result.ok ? "Sent" : "Failed", result.detail);
      }
    }
  } catch {
    console.error("[JP] Alert dispatch failed");
  }
}

/** Saved company alert rules; none (or no table yet) means every channel stays on. */
async function companyRules(organizationId: string): Promise<AlertRule[]> {
  const db = await getDb();
  if (!db) return [];
  const rows = await db
    .select()
    .from(alertRules)
    .where(eq(alertRules.organizationId, organizationId))
    .catch(() => []);
  return cleanRules(
    rows.map((row) => ({
      category: row.category as AlertRule["category"],
      role: row.role as AlertRole,
      push: row.push === "Yes",
      whatsapp: row.whatsapp === "Yes",
      sms: row.sms === "Yes",
      detail: row.detail,
    })),
  );
}

/** Each recipient's role for this alert: leader role first, else their role on the site. */
async function recipientRoles(organizationId: string, siteId: string | null, userIds: number[]) {
  const db = await getDb();
  const roles = new Map<number, AlertRole>();
  if (!db || !userIds.length) return roles;
  const [memberships, assignments] = await Promise.all([
    db
      .select({
        userId: organizationMemberships.userId,
        role: organizationMemberships.businessRole,
      })
      .from(organizationMemberships)
      .where(
        and(
          eq(organizationMemberships.organizationId, organizationId),
          eq(organizationMemberships.status, "Active"),
          inArray(organizationMemberships.userId, userIds),
        ),
      ),
    siteId
      ? db
          .select({ userId: siteAssignments.userId, role: siteAssignments.assignmentRole })
          .from(siteAssignments)
          .where(
            and(
              eq(siteAssignments.siteId, siteId),
              eq(siteAssignments.status, "Active"),
              inArray(siteAssignments.userId, userIds),
            ),
          )
      : Promise.resolve([] as { userId: number; role: string }[]),
  ]);
  const leaders = ["owner", "director", "admin"];
  for (const userId of userIds) {
    const leader = memberships.find((row) => row.userId === userId && leaders.includes(row.role));
    const onSite = assignments.find((row) => row.userId === userId);
    const any = memberships.find((row) => row.userId === userId);
    const role = (leader ?? onSite ?? any)?.role;
    if (role && ALERT_ROLES.includes(role as AlertRole)) roles.set(userId, role as AlertRole);
  }
  return roles;
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

/** The caller's company membership, preferring a leader role. */
async function leaderMembership(
  db: NonNullable<Awaited<ReturnType<typeof getDb>>>,
  userId: number,
) {
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
  const leaders = ["owner", "director", "admin"];
  const row = rows.find((r) => leaders.includes(r.role)) ?? rows[0];
  return row ? { organizationId: row.organizationId, leader: leaders.includes(row.role) } : null;
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

  /** Company alert rules for every category and role (defaults filled in). */
  alertRules: protectedProcedure.query(async ({ ctx }) => {
    const db = requireDb(await getDb());
    const membership = await leaderMembership(db, ctx.user.id);
    if (!membership) return { canManage: false, categories: [], roles: [], rules: [] };
    const saved = await companyRules(membership.organizationId);
    return {
      canManage: membership.leader,
      categories: ALERT_CATEGORIES.map(({ key, title, detail }) => ({ key, title, detail })),
      roles: [...ALERT_ROLES],
      rules: ALERT_CATEGORY_KEYS.flatMap((category) =>
        ALERT_ROLES.map((role) => ruleFor(saved, category, role)),
      ),
    };
  }),

  /** Replaces the company's alert rules (owner, director or admin). */
  saveAlertRules: protectedProcedure
    .input(
      z.object({
        rules: z
          .array(
            z.object({
              category: z.string(),
              role: z.string(),
              push: z.boolean(),
              whatsapp: z.boolean(),
              sms: z.boolean(),
              detail: z.enum(["full", "title"]),
            }),
          )
          .max(ALERT_CATEGORY_KEYS.length * ALERT_ROLES.length),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const db = requireDb(await getDb());
      const membership = await leaderMembership(db, ctx.user.id);
      if (!membership?.leader)
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "Only the owner, a director or an admin can change company alert rules.",
        });
      const rules = cleanRules(input.rules as Partial<AlertRule>[]);
      const yes = (value: boolean) => (value ? ("Yes" as const) : ("No" as const));
      await db.transaction(async (tx) => {
        await tx.delete(alertRules).where(eq(alertRules.organizationId, membership.organizationId));
        if (rules.length)
          await tx.insert(alertRules).values(
            rules.map((rule) => ({
              organizationId: membership.organizationId,
              category: rule.category,
              role: rule.role,
              push: yes(rule.push),
              whatsapp: yes(rule.whatsapp),
              sms: yes(rule.sms),
              detail: rule.detail,
              updatedBy: ctx.user.id,
            })),
          );
        await tx.insert(auditEvents).values({
          id: randomUUID(),
          organizationId: membership.organizationId,
          actorUserId: ctx.user.id,
          action: "settings.alert_rules_changed",
          entityType: "organization",
          entityId: membership.organizationId,
          afterSummary: JSON.stringify(
            rules
              .filter((rule) => !rule.push || !rule.whatsapp || !rule.sms || rule.detail !== "full")
              .map((rule) => `${rule.category}/${rule.role}`)
              .slice(0, 60),
          ),
        });
      });
      return { saved: rules.length };
    }),

  /** Categories the caller muted for themselves. */
  myMutes: protectedProcedure.query(async ({ ctx }) => {
    const db = requireDb(await getDb());
    const rows = await db
      .select({ category: userAlertMutes.category })
      .from(userAlertMutes)
      .where(eq(userAlertMutes.userId, ctx.user.id))
      .catch(() => []);
    return {
      categories: ALERT_CATEGORIES.map(({ key, title, detail }) => ({ key, title, detail })),
      muted: rows
        .map((row) => row.category)
        .filter((key) => ALERT_CATEGORY_KEYS.includes(key as never)),
    };
  }),

  setMutes: protectedProcedure
    .input(z.object({ muted: z.array(z.string()).max(ALERT_CATEGORY_KEYS.length) }))
    .mutation(async ({ ctx, input }) => {
      const db = requireDb(await getDb());
      const muted = ALERT_CATEGORY_KEYS.filter((key) => input.muted.includes(key));
      await db.transaction(async (tx) => {
        await tx.delete(userAlertMutes).where(eq(userAlertMutes.userId, ctx.user.id));
        if (muted.length)
          await tx
            .insert(userAlertMutes)
            .values(muted.map((category) => ({ userId: ctx.user.id, category })));
      });
      return { muted };
    }),

  /** The company's last alert deliveries (leaders only): what was sent, failed or skipped. */
  recentDeliveries: protectedProcedure.query(async ({ ctx }) => {
    const db = requireDb(await getDb());
    const membership = await leaderMembership(db, ctx.user.id);
    if (!membership?.leader) return { rows: [] };
    const rows = await db
      .select({
        id: notificationDeliveries.id,
        channel: notificationDeliveries.channel,
        status: notificationDeliveries.status,
        detail: notificationDeliveries.detail,
        eventKind: notificationDeliveries.eventKind,
        createdAt: notificationDeliveries.createdAt,
        userName: users.name,
      })
      .from(notificationDeliveries)
      .leftJoin(users, eq(notificationDeliveries.userId, users.id))
      .where(eq(notificationDeliveries.organizationId, membership.organizationId))
      .orderBy(desc(notificationDeliveries.createdAt))
      .limit(60)
      .catch(() => []);
    return {
      rows: rows.map((row) => ({ ...row, category: alertCategoryOf(row.eventKind) })),
    };
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
