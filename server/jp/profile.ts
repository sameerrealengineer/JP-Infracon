import { randomUUID } from "node:crypto";
import { and, eq, inArray } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import {
  auditEvents,
  organizationMemberships,
  organizations,
  userContactPreferences,
  userProfiles,
  users,
} from "../../drizzle/schema";
import { protectedProcedure, router } from "../_core/trpc";
import { getDb } from "../db";
import { storageGetSignedUrl, storagePut } from "../storage";
import { getAccessibleSites } from "./access";
import { sniffContentType } from "../../lib/jp/attachment-policy";
import {
  MAX_PROFILE_PHOTO_BYTES,
  cleanProfile,
  formatAddress,
  profileCompleteness,
} from "../../lib/jp/profile-policy";

/**
 * A person's own profile: name, mobile, work details, address and photo. Everyone can keep
 * their own; colleagues see the name, role, designation and photo through `team`.
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

const ROLE_RANK = [
  "owner",
  "director",
  "admin",
  "project_manager",
  "accounts",
  "supervisor",
  "storekeeper",
  "auditor",
];

async function primaryMembership(db: Db, userId: number) {
  const rows = await db
    .select({
      organizationId: organizationMemberships.organizationId,
      businessRole: organizationMemberships.businessRole,
      organizationName: organizations.name,
    })
    .from(organizationMemberships)
    .innerJoin(organizations, eq(organizationMemberships.organizationId, organizations.id))
    .where(
      and(eq(organizationMemberships.userId, userId), eq(organizationMemberships.status, "Active")),
    )
    .limit(20);
  return (
    rows.sort((a, b) => ROLE_RANK.indexOf(a.businessRole) - ROLE_RANK.indexOf(b.businessRole))[0] ??
    null
  );
}

async function photoUrl(key: string | null | undefined) {
  if (!key) return null;
  try {
    return await storageGetSignedUrl(key);
  } catch {
    return null;
  }
}

async function audit(db: Db, userId: number, action: string, after: unknown) {
  const membership = await primaryMembership(db, userId);
  if (!membership) return;
  await db
    .insert(auditEvents)
    .values({
      id: randomUUID(),
      organizationId: membership.organizationId,
      actorUserId: userId,
      action,
      entityType: "user_profile",
      entityId: String(userId),
      afterSummary: JSON.stringify(after),
    })
    .catch(() => undefined);
}

const text = (max: number) =>
  z
    .string()
    .max(max * 2)
    .default("");

export const profileRouter = router({
  /** The signed-in person's profile, with a short-lived photo link. */
  me: protectedProcedure.query(async ({ ctx }) => {
    const db = requireDb(await getDb());
    const [[user], [profile], [contact], membership, sites] = await Promise.all([
      db
        .select({
          id: users.id,
          name: users.name,
          email: users.email,
          lastSignedIn: users.lastSignedIn,
          createdAt: users.createdAt,
        })
        .from(users)
        .where(eq(users.id, ctx.user.id))
        .limit(1),
      db.select().from(userProfiles).where(eq(userProfiles.userId, ctx.user.id)).limit(1),
      db
        .select({ phone: userContactPreferences.phone })
        .from(userContactPreferences)
        .where(eq(userContactPreferences.userId, ctx.user.id))
        .limit(1),
      primaryMembership(db, ctx.user.id),
      getAccessibleSites(ctx.user).catch(() => []),
    ]);
    const details = {
      designation: profile?.designation ?? null,
      department: profile?.department ?? null,
      addressLine: profile?.addressLine ?? null,
      city: profile?.city ?? null,
      district: profile?.district ?? null,
      state: profile?.state ?? null,
      pincode: profile?.pincode ?? null,
      emergencyContact: profile?.emergencyContact ?? null,
    };
    return {
      id: ctx.user.id,
      name: user?.name ?? "",
      email: user?.email ?? null,
      phone: contact?.phone ?? null,
      ...details,
      address: formatAddress(details),
      role: membership?.businessRole ?? null,
      organizationName: membership?.organizationName ?? null,
      siteNames: sites.map((site) => site.name),
      memberSince: user?.createdAt ?? null,
      lastSignedIn: user?.lastSignedIn ?? null,
      photoUrl: await photoUrl(profile?.photoStorageKey),
      completeness: profileCompleteness({
        ...details,
        phone: contact?.phone ?? null,
        hasPhoto: Boolean(profile?.photoStorageKey),
      }),
    };
  }),

  update: protectedProcedure
    .input(
      z.object({
        name: z.string().max(320),
        phone: text(20),
        designation: text(120),
        department: text(120),
        addressLine: text(300),
        city: text(120),
        district: text(120),
        state: text(120),
        pincode: text(10),
        emergencyContact: text(160),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const clean = cleanProfile(input);
      if ("field" in clean) throw new TRPCError({ code: "BAD_REQUEST", message: clean.message });
      const db = requireDb(await getDb());
      const { name, phone, ...details } = clean;
      await db.transaction(async (tx) => {
        await tx.update(users).set({ name }).where(eq(users.id, ctx.user.id));
        await tx
          .insert(userProfiles)
          .values({ userId: ctx.user.id, ...details })
          .onDuplicateKeyUpdate({ set: details });
        // The mobile lives with the alert settings; clearing it also turns WhatsApp/SMS off.
        await tx
          .insert(userContactPreferences)
          .values({ userId: ctx.user.id, phone })
          .onDuplicateKeyUpdate({
            set: phone ? { phone } : { phone: null, whatsappOptIn: "No", smsOptIn: "No" },
          });
      });
      await audit(db, ctx.user.id, "profile.updated", {
        fields: Object.keys(details).filter((key) => details[key as keyof typeof details] !== null),
      });
      return { ok: true };
    }),

  /** A JPEG/PNG/WebP photo (the app shrinks it first). Replaces any earlier photo. */
  setPhoto: protectedProcedure
    .input(
      z.object({
        base64: z
          .string()
          .min(8)
          .max(Math.ceil((MAX_PROFILE_PHOTO_BYTES * 4) / 3) + 16),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const bytes = Buffer.from(input.base64, "base64");
      const contentType = sniffContentType(bytes);
      if (!contentType?.startsWith("image/") || bytes.length > MAX_PROFILE_PHOTO_BYTES)
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Choose a JPEG, PNG or WebP photo under 5 MB.",
        });
      const db = requireDb(await getDb());
      let key: string;
      try {
        key = (await storagePut(`profiles/${ctx.user.id}/${randomUUID()}`, bytes, contentType)).key;
      } catch {
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message: "File storage is unavailable right now. Try again shortly.",
        });
      }
      await db
        .insert(userProfiles)
        .values({ userId: ctx.user.id, photoStorageKey: key, photoContentType: contentType })
        .onDuplicateKeyUpdate({ set: { photoStorageKey: key, photoContentType: contentType } });
      await audit(db, ctx.user.id, "profile.photo_changed", { contentType });
      return { photoUrl: await photoUrl(key) };
    }),

  removePhoto: protectedProcedure.mutation(async ({ ctx }) => {
    const db = requireDb(await getDb());
    await db
      .update(userProfiles)
      .set({ photoStorageKey: null, photoContentType: null })
      .where(eq(userProfiles.userId, ctx.user.id));
    await audit(db, ctx.user.id, "profile.photo_removed", {});
    return { ok: true };
  }),

  /** Colleagues in the person's organisation: name, role, designation and photo only. */
  team: protectedProcedure.query(async ({ ctx }) => {
    const db = requireDb(await getDb());
    const membership = await primaryMembership(db, ctx.user.id);
    if (!membership) return [];
    const rows = await db
      .select({
        userId: organizationMemberships.userId,
        role: organizationMemberships.businessRole,
        name: users.name,
      })
      .from(organizationMemberships)
      .innerJoin(users, eq(organizationMemberships.userId, users.id))
      .where(
        and(
          eq(organizationMemberships.organizationId, membership.organizationId),
          eq(organizationMemberships.status, "Active"),
        ),
      )
      .limit(500);
    if (rows.length === 0) return [];
    const profiles = await db
      .select({
        userId: userProfiles.userId,
        designation: userProfiles.designation,
        photoStorageKey: userProfiles.photoStorageKey,
      })
      .from(userProfiles)
      .where(
        inArray(
          userProfiles.userId,
          rows.map((row) => row.userId),
        ),
      );
    const byUser = new Map(profiles.map((row) => [row.userId, row]));
    return Promise.all(
      rows.map(async (row) => ({
        userId: row.userId,
        name: row.name ?? "—",
        role: row.role,
        designation: byUser.get(row.userId)?.designation ?? null,
        photoUrl: await photoUrl(byUser.get(row.userId)?.photoStorageKey),
      })),
    );
  }),
});
