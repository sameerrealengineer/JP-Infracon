import { createHash, randomInt, randomUUID, timingSafeEqual } from "node:crypto";
import { and, eq, isNull, like } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import {
  auditEvents,
  authSessions,
  organizationMemberships,
  userContactPreferences,
  userCredentials,
  users,
} from "../../drizzle/schema";
import { normalizeIndianMobile } from "../../lib/jp/notify-policy";
import { hashPassword, validatePassword } from "../_core/credential-auth";
import { getDb } from "../db";
import { sendWhatsAppText } from "./notify";
import { allowHit } from "./reports";

/**
 * Staff (username + password) forgot their username or password: a 6-digit code on WhatsApp to
 * the mobile saved in their profile, the usernames on that number, and a new password set with
 * the code. Same answer for every number, so nobody learns which numbers have an account.
 * Codes live in memory for 10 minutes (5 tries); a restart clears them.
 */
const codes = new Map<string, { hash: string; expiresAt: number; tries: number }>();
const codeHash = (mobile: string, code: string) =>
  createHash("sha256").update(`staff:${mobile}:${code}`).digest("hex");

const ANSWER = {
  ok: true as const,
  message: "If this number is saved on an account, your username and a code were sent on WhatsApp.",
};

function bad(message: string): never {
  throw new TRPCError({ code: "BAD_REQUEST", message });
}

function tooMany(): never {
  throw new TRPCError({
    code: "TOO_MANY_REQUESTS",
    message: "Too many tries. Wait a minute and try again.",
  });
}

async function requireDb() {
  const db = await getDb();
  if (!db)
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message: "The business data service is temporarily unavailable.",
    });
  return db;
}

/** Active staff accounts (with a username) whose saved mobile is this number. */
async function accountsOnMobile(mobile: string) {
  const db = await requireDb();
  const lastTen = mobile.slice(-10);
  const rows = await db
    .select({
      userId: users.id,
      name: users.name,
      username: userCredentials.username,
      phone: userContactPreferences.phone,
      status: users.accountStatus,
    })
    .from(userContactPreferences)
    .innerJoin(users, eq(userContactPreferences.userId, users.id))
    .innerJoin(userCredentials, eq(userCredentials.userId, users.id))
    .where(like(userContactPreferences.phone, `%${lastTen}`));
  return rows.filter(
    (row) => row.status === "Active" && normalizeIndianMobile(row.phone) === mobile,
  );
}

export async function requestStaffReset(mobileInput: string, clientKey: string) {
  const mobile = normalizeIndianMobile(mobileInput);
  if (!mobile) bad("Enter a 10-digit Indian mobile number.");
  if (!allowHit(`staff-reset-ip:${clientKey}`, 10) || !allowHit(`staff-reset:${mobile}`, 3))
    tooMany();
  const accounts = await accountsOnMobile(mobile!);
  if (!accounts.length) return ANSWER;
  const code = String(randomInt(100000, 1000000));
  const names = accounts.map((row) => row.username).join(", ");
  const sent = await sendWhatsAppText(
    mobile!,
    `JP Infracon: your username is ${names}. Your code to set a new password is ${code}. It works for 10 minutes. Do not share it with anyone.`,
  ).catch(() => false);
  if (sent)
    codes.set(mobile!, {
      hash: codeHash(mobile!, code),
      expiresAt: Date.now() + 10 * 60_000,
      tries: 0,
    });
  return ANSWER;
}

export async function resetStaffPasswordWithCode(
  input: { mobile: string; code: string; username: string; password: string },
  clientKey: string,
) {
  const mobile = normalizeIndianMobile(input.mobile);
  if (!mobile) bad("Enter a 10-digit Indian mobile number.");
  if (!allowHit(`staff-code-ip:${clientKey}`, 20)) tooMany();
  if (!validatePassword(input.password)) bad("Use a password of at least 12 characters.");
  const wrong = () => bad("The code is wrong or has expired. Ask for a new one.");
  const entry = codes.get(mobile!);
  if (!entry || entry.expiresAt < Date.now() || entry.tries >= 5) {
    codes.delete(mobile!);
    wrong();
  }
  entry!.tries += 1;
  const expected = Buffer.from(entry!.hash, "hex");
  const given = Buffer.from(codeHash(mobile!, input.code.trim()), "hex");
  if (!timingSafeEqual(expected, given)) wrong();
  const username = input.username.trim().toLowerCase();
  const account = (await accountsOnMobile(mobile!)).find(
    (row) => row.username.toLowerCase() === username,
  );
  if (!account) bad("This username is not saved with this mobile number.");
  codes.delete(mobile!);
  const db = await requireDb();
  const passwordHash = await hashPassword(input.password);
  const now = new Date();
  const memberships = await db
    .select({ organizationId: organizationMemberships.organizationId })
    .from(organizationMemberships)
    .where(eq(organizationMemberships.userId, account!.userId));
  await db.transaction(async (tx) => {
    await tx
      .update(userCredentials)
      .set({ passwordHash, mustChangePassword: 0, passwordChangedAt: now })
      .where(eq(userCredentials.userId, account!.userId));
    await tx
      .update(authSessions)
      .set({ revokedAt: now })
      .where(and(eq(authSessions.userId, account!.userId), isNull(authSessions.revokedAt)));
    const orgs = [...new Set(memberships.map((row) => row.organizationId))];
    for (const organizationId of orgs)
      await tx.insert(auditEvents).values({
        id: randomUUID(),
        organizationId,
        actorUserId: account!.userId,
        action: "account.password_reset_by_code",
        entityType: "user_account",
        entityId: String(account!.userId),
      });
  });
  void sendWhatsAppText(
    mobile!,
    "JP Infracon: your password was changed just now. If this was not you, tell your administrator at once.",
  ).catch(() => false);
  return {
    ok: true as const,
    username: account!.username,
    message: "New password set. Sign in with it now.",
  };
}

/** For tests: the stored code entries (never exposed through the API). */
export function _staffCodesForTest() {
  return codes;
}
