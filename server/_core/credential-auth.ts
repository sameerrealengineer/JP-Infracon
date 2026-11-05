import {
  createHash,
  randomBytes,
  randomUUID,
  scrypt as nodeScrypt,
  scryptSync,
  timingSafeEqual,
} from "node:crypto";
import { and, eq, gt, isNull, sql } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import {
  auditEvents,
  authSessions,
  loginAttempts,
  organizationMemberships,
  registrationInvites,
  siteAssignments,
  sites,
  systemBootstrap,
  userCredentials,
  users,
  workerAccounts,
  type User,
} from "../../drizzle/schema";
import { normalizeIndianMobile } from "../../lib/jp/notify-policy";
import { afterWrongPin } from "../../lib/jp/worker-app";
import { isWellFormedInviteCode, normalizeInviteCode } from "../../lib/jp/invite-code";
import { effectiveNow } from "../../lib/jp/effective-time";
import { getDb } from "../db";
import { ENV } from "./env";
import { sdk } from "./sdk";

const scrypt = (
  password: string,
  salt: Buffer,
  keyLength: number,
  options: { N: number; r: number; p: number; maxmem: number },
) =>
  new Promise<Buffer>((resolve, reject) => {
    nodeScrypt(password, salt, keyLength, options, (error, derivedKey) => {
      if (error) reject(error);
      else resolve(derivedKey as Buffer);
    });
  });
const SCRYPT_N = 1 << 15;
const SCRYPT_R = 8;
const SCRYPT_P = 1;
const SCRYPT_BYTES = 64;
const SCRYPT_MAXMEM = 64 * 1024 * 1024;
const SESSION_LIFETIME_MS = 30 * 24 * 60 * 60 * 1000;
const LOGIN_WINDOW_MS = 15 * 60 * 1000;
const LOGIN_LOCK_MS = 15 * 60 * 1000;
const MAX_FAILED_LOGINS = 10;
const BOOTSTRAP_KEY = "first_super_admin";
const INVALID_LOGIN_MESSAGE =
  "Username or password is incorrect, or sign-in is temporarily unavailable.";

const dummySalt = Buffer.alloc(16, 0x5a);
const dummyDigest = scryptSync("not-a-real-user-password", dummySalt, SCRYPT_BYTES, {
  N: SCRYPT_N,
  r: SCRYPT_R,
  p: SCRYPT_P,
  maxmem: SCRYPT_MAXMEM,
});
const DUMMY_PASSWORD_HASH = `scrypt$${SCRYPT_N}$${SCRYPT_R}$${SCRYPT_P}$${dummySalt.toString("hex")}$${dummyDigest.toString("hex")}`;

export function normalizeUsername(value: string): string {
  return value.trim().toLowerCase();
}

export function isValidUsername(value: string): boolean {
  const normalized = normalizeUsername(value);
  return (
    normalized.length >= 3 && normalized.length <= 32 && /^[a-z0-9][a-z0-9._-]*$/.test(normalized)
  );
}

export function validatePassword(value: string): boolean {
  return value.length >= 12 && value.length <= 128 && !/^\s+$/.test(value);
}

export function normalizeBootstrapSecret(value: string): string {
  return value.trim();
}

export async function hashPassword(password: string): Promise<string> {
  if (!validatePassword(password)) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "Use a password between 12 and 128 characters.",
    });
  }
  return scryptHash(password);
}

/** A worker's 6-digit PIN, hashed the same way (the lock after wrong PINs guards guessing). */
export async function hashPin(pin: string): Promise<string> {
  if (!/^\d{6}$/.test(pin))
    throw new TRPCError({ code: "BAD_REQUEST", message: "The PIN must be 6 digits." });
  return scryptHash(pin);
}

async function scryptHash(password: string): Promise<string> {
  const salt = randomBytes(16);
  const digest = (await scrypt(password, salt, SCRYPT_BYTES, {
    N: SCRYPT_N,
    r: SCRYPT_R,
    p: SCRYPT_P,
    maxmem: SCRYPT_MAXMEM,
  })) as Buffer;
  return `scrypt$${SCRYPT_N}$${SCRYPT_R}$${SCRYPT_P}$${salt.toString("hex")}$${digest.toString("hex")}`;
}

export async function verifyPassword(password: string, encoded: string): Promise<boolean> {
  try {
    const [scheme, nText, rText, pText, saltHex, digestHex] = encoded.split("$");
    if (scheme !== "scrypt" || !nText || !rText || !pText || !saltHex || !digestHex) return false;
    const n = Number(nText);
    const r = Number(rText);
    const p = Number(pText);
    if (
      n !== SCRYPT_N ||
      r !== SCRYPT_R ||
      p !== SCRYPT_P ||
      !/^[a-f0-9]{32}$/.test(saltHex) ||
      !/^[a-f0-9]{128}$/.test(digestHex)
    )
      return false;
    const expected = Buffer.from(digestHex, "hex");
    const actual = (await scrypt(password, Buffer.from(saltHex, "hex"), expected.length, {
      N: SCRYPT_N,
      r: SCRYPT_R,
      p: SCRYPT_P,
      maxmem: SCRYPT_MAXMEM,
    })) as Buffer;
    return timingSafeEqual(actual, expected);
  } catch {
    return false;
  }
}

function safeEqual(left: string, right: string): boolean {
  const a = Buffer.from(left, "utf8");
  const b = Buffer.from(right, "utf8");
  return a.length === b.length && timingSafeEqual(a, b);
}

function throttleKey(username: string): string {
  return createHash("sha256").update(normalizeUsername(username)).digest("hex");
}

async function isLoginBlocked(identifierHash: string): Promise<boolean> {
  const db = await getDb();
  if (!db) return true;
  const [row] = await db
    .select({ lockedUntil: loginAttempts.lockedUntil })
    .from(loginAttempts)
    .where(eq(loginAttempts.identifierHash, identifierHash))
    .limit(1);
  return Boolean(row?.lockedUntil && row.lockedUntil.getTime() > Date.now());
}

async function recordFailedLogin(identifierHash: string): Promise<void> {
  const db = await getDb();
  if (!db) return;
  const now = new Date();
  const windowStart = new Date(now.getTime() - LOGIN_WINDOW_MS);
  const lockedUntil = new Date(now.getTime() + LOGIN_LOCK_MS);
  await db
    .insert(loginAttempts)
    .values({ identifierHash, failedAttempts: 1, windowStartedAt: now })
    .onDuplicateKeyUpdate({
      set: {
        failedAttempts: sql`IF(${loginAttempts.windowStartedAt} < ${windowStart}, 1, ${loginAttempts.failedAttempts} + 1)`,
        windowStartedAt: sql`IF(${loginAttempts.windowStartedAt} < ${windowStart}, ${now}, ${loginAttempts.windowStartedAt})`,
        lockedUntil: sql`CASE WHEN ${loginAttempts.windowStartedAt} < ${windowStart} THEN NULL WHEN ${loginAttempts.failedAttempts} + 1 >= ${MAX_FAILED_LOGINS} THEN ${lockedUntil} ELSE ${loginAttempts.lockedUntil} END`,
      },
    });
}

async function clearFailedLogin(identifierHash: string): Promise<void> {
  const db = await getDb();
  if (!db) return;
  await db.delete(loginAttempts).where(eq(loginAttempts.identifierHash, identifierHash));
}

function publicUser(user: User, mustChangePassword: boolean) {
  return {
    id: user.id,
    openId: user.openId,
    name: user.name,
    email: user.email,
    loginMethod: "username_password",
    accountStatus: user.accountStatus,
    platformRole: user.role,
    mustChangePassword,
    lastSignedIn: new Date().toISOString(),
  };
}

async function issueSession(user: User, mustChangePassword = false) {
  const db = await getDb();
  if (!db)
    throw new TRPCError({
      code: "SERVICE_UNAVAILABLE",
      message: "Sign-in is temporarily unavailable.",
    });
  const sessionId = randomUUID();
  const now = new Date();
  const expiresAt = new Date(now.getTime() + SESSION_LIFETIME_MS);
  await db
    .insert(authSessions)
    .values({ id: sessionId, userId: user.id, createdAt: now, expiresAt });
  await db.update(users).set({ lastSignedIn: now }).where(eq(users.id, user.id));
  const sessionToken = await sdk.createSessionToken(user.openId, {
    name: user.name ?? "",
    expiresInMs: SESSION_LIFETIME_MS,
    sessionId,
  });
  return { sessionToken, user: publicUser({ ...user, lastSignedIn: now }, mustChangePassword) };
}

export async function passwordLogin(usernameInput: string, password: string) {
  const username = normalizeUsername(usernameInput);
  const identifierHash = throttleKey(username);
  if (
    !isValidUsername(username) ||
    !password ||
    password.length > 128 ||
    (await isLoginBlocked(identifierHash))
  ) {
    if (password && password.length <= 128) await verifyPassword(password, DUMMY_PASSWORD_HASH);
    throw new TRPCError({ code: "UNAUTHORIZED", message: INVALID_LOGIN_MESSAGE });
  }
  const db = await getDb();
  if (!db)
    throw new TRPCError({
      code: "SERVICE_UNAVAILABLE",
      message: "Sign-in is temporarily unavailable.",
    });
  const [record] = await db
    .select({ user: users, credential: userCredentials })
    .from(userCredentials)
    .innerJoin(users, eq(userCredentials.userId, users.id))
    .where(eq(userCredentials.username, username))
    .limit(1);
  const candidateHash = record?.credential.passwordHash ?? DUMMY_PASSWORD_HASH;
  const passwordMatches = await verifyPassword(password, candidateHash);
  if (!record || !passwordMatches || record.user.accountStatus !== "Active") {
    await recordFailedLogin(identifierHash);
    throw new TRPCError({ code: "UNAUTHORIZED", message: INVALID_LOGIN_MESSAGE });
  }
  await clearFailedLogin(identifierHash);
  return issueSession(record.user, record.credential.mustChangePassword === 1);
}

const INVALID_PIN_MESSAGE =
  "Mobile number or PIN is wrong, or this login is locked for a while. Ask your supervisor.";

/**
 * Worker (mistri / labour) sign-in with a mobile number and 6-digit PIN. Five wrong PINs lock the
 * login for 30 minutes; unknown numbers are throttled too and get the same answer, so the
 * response never tells which numbers have an account.
 */
export async function workerPinLogin(mobileInput: string, pin: string) {
  const mobile = normalizeIndianMobile(mobileInput);
  const identifierHash = throttleKey(`worker:${mobile ?? mobileInput}`);
  if (!mobile || !/^\d{6}$/.test(pin) || (await isLoginBlocked(identifierHash))) {
    await verifyPassword(pin || "000000", DUMMY_PASSWORD_HASH);
    throw new TRPCError({ code: "UNAUTHORIZED", message: INVALID_PIN_MESSAGE });
  }
  const db = await getDb();
  if (!db)
    throw new TRPCError({
      code: "SERVICE_UNAVAILABLE",
      message: "Sign-in is temporarily unavailable.",
    });
  const [record] = await db
    .select({ user: users, account: workerAccounts })
    .from(workerAccounts)
    .innerJoin(users, eq(workerAccounts.userId, users.id))
    .where(eq(workerAccounts.mobile, mobile))
    .limit(1);
  const now = new Date();
  const locked = Boolean(record?.account.lockedUntil && record.account.lockedUntil > now);
  const matches = await verifyPassword(pin, record?.account.pinHash ?? DUMMY_PASSWORD_HASH);
  if (
    !record ||
    locked ||
    !matches ||
    record.account.status !== "Active" ||
    record.user.accountStatus !== "Active"
  ) {
    await recordFailedLogin(identifierHash);
    if (record && !locked && !matches)
      await db
        .update(workerAccounts)
        .set(afterWrongPin(record.account.failedAttempts, now))
        .where(eq(workerAccounts.id, record.account.id));
    throw new TRPCError({ code: "UNAUTHORIZED", message: INVALID_PIN_MESSAGE });
  }
  await clearFailedLogin(identifierHash);
  await db
    .update(workerAccounts)
    .set({ failedAttempts: 0, lockedUntil: null })
    .where(eq(workerAccounts.id, record.account.id));
  return issueSession(record.user, false);
}

export async function bootstrapStatus(): Promise<{ initialized: boolean }> {
  const db = await getDb();
  if (!db)
    throw new TRPCError({
      code: "SERVICE_UNAVAILABLE",
      message: "Account setup is temporarily unavailable.",
    });
  const [state] = await db
    .select({ completedAt: systemBootstrap.completedAt })
    .from(systemBootstrap)
    .where(eq(systemBootstrap.bootstrapKey, BOOTSTRAP_KEY))
    .limit(1);
  if (!state)
    throw new TRPCError({
      code: "SERVICE_UNAVAILABLE",
      message: "Account setup is temporarily unavailable.",
    });
  if (state.completedAt) return { initialized: true };
  const [existing] = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.role, "super_admin"))
    .limit(1);
  return { initialized: Boolean(existing) };
}

export async function bootstrapFirstSuperAdmin(input: {
  bootstrapSecret: string;
  username: string;
  displayName: string;
  password: string;
}) {
  const bootstrapThrottleKey = throttleKey("first_super_admin_bootstrap");
  const suppliedBootstrapSecret = normalizeBootstrapSecret(input.bootstrapSecret);
  const configuredBootstrapSecret = normalizeBootstrapSecret(ENV.superAdminBootstrapSecret);
  const bootstrapBlocked = await isLoginBlocked(bootstrapThrottleKey);
  if (
    bootstrapBlocked ||
    !configuredBootstrapSecret ||
    !safeEqual(suppliedBootstrapSecret, configuredBootstrapSecret)
  ) {
    if (!bootstrapBlocked) await recordFailedLogin(bootstrapThrottleKey);
    throw new TRPCError({
      code: "UNAUTHORIZED",
      message: "Super Admin setup is unavailable or the setup key is invalid.",
    });
  }
  await clearFailedLogin(bootstrapThrottleKey);
  const username = normalizeUsername(input.username);
  if (!isValidUsername(username))
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "Username must be 3–32 characters using letters, numbers, dot, dash, or underscore.",
    });
  const displayName = input.displayName.trim();
  if (displayName.length < 2 || displayName.length > 120)
    throw new TRPCError({ code: "BAD_REQUEST", message: "Enter a valid account display name." });
  const passwordHash = await hashPassword(input.password);
  const db = await getDb();
  if (!db)
    throw new TRPCError({
      code: "SERVICE_UNAVAILABLE",
      message: "Account setup is temporarily unavailable.",
    });
  let user: User | undefined;
  try {
    await db.transaction(async (tx) => {
      const [state] = await tx
        .select()
        .from(systemBootstrap)
        .where(eq(systemBootstrap.bootstrapKey, BOOTSTRAP_KEY))
        .limit(1)
        .for("update");
      if (!state || state.completedAt)
        throw new TRPCError({
          code: "CONFLICT",
          message: "First Super Admin setup has already been completed.",
        });
      const existing = await tx
        .select({ id: users.id })
        .from(users)
        .where(eq(users.role, "super_admin"))
        .limit(1);
      if (existing.length)
        throw new TRPCError({
          code: "CONFLICT",
          message: "First Super Admin setup has already been completed.",
        });
      const openId = `local_${randomUUID().replaceAll("-", "")}`;
      await tx.insert(users).values({
        openId,
        name: displayName,
        email: null,
        loginMethod: "username_password",
        role: "super_admin",
        accountStatus: "Active",
        lastSignedIn: new Date(),
      });
      [user] = await tx.select().from(users).where(eq(users.openId, openId)).limit(1);
      if (!user)
        throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Account setup failed." });
      await tx.insert(userCredentials).values({
        id: randomUUID(),
        userId: user.id,
        username,
        passwordHash,
        mustChangePassword: 0,
        passwordChangedAt: new Date(),
      });
      await tx
        .update(systemBootstrap)
        .set({ completedAt: new Date(), completedByUserId: user.id })
        .where(eq(systemBootstrap.bootstrapKey, BOOTSTRAP_KEY));
    });
  } catch (error) {
    if (error instanceof TRPCError) throw error;
    if (String(error).toLowerCase().includes("duplicate"))
      throw new TRPCError({ code: "CONFLICT", message: "That username is already in use." });
    console.error("[Auth] First Super Admin bootstrap failed");
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: "Account setup failed. Retry only after confirming the account was not created.",
    });
  }
  if (!user)
    throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Account setup failed." });
  return issueSession(user, false);
}

export async function changeOwnPassword(
  userId: number,
  currentPassword: string,
  newPassword: string,
) {
  const db = await getDb();
  if (!db)
    throw new TRPCError({
      code: "SERVICE_UNAVAILABLE",
      message: "Password service is temporarily unavailable.",
    });
  const [credential] = await db
    .select()
    .from(userCredentials)
    .where(eq(userCredentials.userId, userId))
    .limit(1);
  if (!credential || !(await verifyPassword(currentPassword, credential.passwordHash))) {
    throw new TRPCError({ code: "UNAUTHORIZED", message: "Current password is incorrect." });
  }
  const passwordHash = await hashPassword(newPassword);
  const changedAt = new Date();
  await db.transaction(async (tx) => {
    await tx
      .update(userCredentials)
      .set({ passwordHash, mustChangePassword: 0, passwordChangedAt: changedAt })
      .where(eq(userCredentials.userId, userId));
    await tx
      .update(authSessions)
      .set({ revokedAt: changedAt })
      .where(and(eq(authSessions.userId, userId), isNull(authSessions.revokedAt)));
  });
  const [user] = await db.select().from(users).where(eq(users.id, userId)).limit(1);
  if (!user || user.accountStatus !== "Active")
    throw new TRPCError({ code: "FORBIDDEN", message: "This account is not active." });
  return issueSession(user, false);
}

export function generateTemporaryPassword(): string {
  return randomBytes(18).toString("base64url");
}

export async function revokeSession(sessionId: string, userId?: number): Promise<void> {
  const db = await getDb();
  if (!db) return;
  await db
    .update(authSessions)
    .set({ revokedAt: new Date() })
    .where(
      and(
        eq(authSessions.id, sessionId),
        userId === undefined ? undefined : eq(authSessions.userId, userId),
        isNull(authSessions.revokedAt),
        gt(authSessions.expiresAt, new Date()),
      ),
    );
}

export const credentialSessionLifetimeMs = SESSION_LIFETIME_MS;

/**
 * Creates a login from an administrator-issued invite code. The code is single-use, expires,
 * fixes the organisation, role and site, and failed attempts are throttled per client address.
 */
export async function registerWithInvite(input: {
  code: string;
  username: string;
  password: string;
  clientKey: string;
}) {
  const throttle = throttleKey(`invite_redeem:${input.clientKey}`);
  const code = normalizeInviteCode(input.code);
  const blocked = await isLoginBlocked(throttle);
  if (blocked || !isWellFormedInviteCode(code)) {
    if (!blocked) await recordFailedLogin(throttle);
    throw new TRPCError({ code: "UNAUTHORIZED", message: INVALID_INVITE_MESSAGE });
  }
  const username = normalizeUsername(input.username);
  if (!isValidUsername(username))
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "Username must be 3–32 characters using letters, numbers, dot, dash, or underscore.",
    });
  if (!validatePassword(input.password))
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "Use a password of at least 12 characters.",
    });
  const db = await getDb();
  if (!db)
    throw new TRPCError({
      code: "SERVICE_UNAVAILABLE",
      message: "Sign-up is temporarily unavailable.",
    });
  const codeHash = createHash("sha256").update(code).digest("hex");
  const passwordHash = await hashPassword(input.password);
  let user: User | undefined;
  try {
    await db.transaction(async (tx) => {
      const [invite] = await tx
        .select()
        .from(registrationInvites)
        .where(eq(registrationInvites.codeHash, codeHash))
        .limit(1)
        .for("update");
      if (!invite || invite.status !== "Active" || invite.expiresAt.getTime() < Date.now())
        throw new TRPCError({ code: "UNAUTHORIZED", message: INVALID_INVITE_MESSAGE });
      if (invite.siteId) {
        const [site] = await tx
          .select({ status: sites.status })
          .from(sites)
          .where(eq(sites.id, invite.siteId))
          .limit(1);
        if (site?.status !== "Active")
          throw new TRPCError({
            code: "PRECONDITION_FAILED",
            message: "The invited site is not active.",
          });
      }
      const openId = `local_${randomUUID().replaceAll("-", "")}`;
      const now = effectiveNow();
      await tx.insert(users).values({
        openId,
        name: invite.inviteeName,
        email: null,
        loginMethod: "username_password",
        role: "user",
        accountStatus: "Active",
        lastSignedIn: now,
      });
      [user] = await tx.select().from(users).where(eq(users.openId, openId)).limit(1);
      if (!user) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Sign-up failed." });
      await tx.insert(userCredentials).values({
        id: randomUUID(),
        userId: user.id,
        username,
        passwordHash,
        mustChangePassword: 0,
        passwordChangedAt: now,
      });
      await tx.insert(organizationMemberships).values({
        id: randomUUID(),
        organizationId: invite.organizationId,
        userId: user.id,
        businessRole: invite.businessRole,
        status: "Active",
        createdBy: invite.createdBy,
      });
      if (invite.siteId)
        await tx.insert(siteAssignments).values({
          id: randomUUID(),
          siteId: invite.siteId,
          userId: user.id,
          assignmentRole: invite.businessRole,
          effectiveFrom: now,
          status: "Active",
          assignedBy: invite.createdBy,
        });
      await tx
        .update(registrationInvites)
        .set({ status: "Used", usedBy: user.id, usedAt: now })
        .where(eq(registrationInvites.id, invite.id));
      await tx.insert(auditEvents).values({
        id: randomUUID(),
        organizationId: invite.organizationId,
        siteId: invite.siteId,
        actorUserId: user.id,
        action: "account.registered_with_invite",
        entityType: "user_account",
        entityId: String(user.id),
        afterSummary: JSON.stringify({
          username,
          businessRole: invite.businessRole,
          inviteId: invite.id,
        }),
      });
    });
  } catch (error) {
    if (error instanceof TRPCError) {
      if (error.code === "UNAUTHORIZED") await recordFailedLogin(throttle);
      throw error;
    }
    if (String(error).toLowerCase().includes("duplicate"))
      throw new TRPCError({ code: "CONFLICT", message: "That username is already in use." });
    console.error("[Auth] Invite sign-up failed");
    throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Sign-up failed. Try again." });
  }
  await clearFailedLogin(throttle);
  return issueSession(user!, false);
}

const INVALID_INVITE_MESSAGE = "This invite code is not valid, has expired, or was already used.";
