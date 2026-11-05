import { randomBytes, randomUUID } from "node:crypto";
import { and, desc, eq, gte, inArray, isNull, or } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import {
  attendanceRecords,
  auditEvents,
  people,
  personSiteAssignments,
  projectDocuments,
  sites,
  siteAssignments,
  userContactPreferences,
  userCredentials,
  users,
  workerAccounts,
  workerEngagements,
  type User,
} from "../../drizzle/schema";
import { protectedProcedure, router } from "../_core/trpc";
import { hashPassword, hashPin } from "../_core/credential-auth";
import { getDb } from "../db";
import { getSiteScope } from "./access";
import { personPosition } from "./advances";
import { normalizeIndianMobile } from "../../lib/jp/notify-policy";
import {
  WORKER_FEATURES,
  checkPin,
  parseFeatures,
  type WorkerFeature,
} from "../../lib/jp/worker-app";

/**
 * Worker (mistri / labour) app. A worker signs in with a mobile number and PIN and has no company
 * membership, so every other procedure refuses them; only these answer, and only with their own
 * money, attendance, the site drawings and the supervisor's number, each as switched on by an
 * authorised person. A supervisor can also show the same view on their own phone to a worker
 * without a smartphone. Staff with workforce.review (managers and leaders) create logins, reset PINs and pick features.
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
function bad(message: string): never {
  throw new TRPCError({ code: "BAD_REQUEST", message });
}

/** The signed-in worker's account and person, or a refusal. */
export async function workerOf(user: User) {
  const db = requireDb(await getDb());
  const [row] = await db
    .select({ account: workerAccounts, person: people })
    .from(workerAccounts)
    .innerJoin(people, eq(workerAccounts.personId, people.id))
    .where(eq(workerAccounts.userId, user.id))
    .limit(1);
  if (!row || row.account.status !== "Active" || row.person.status === "Inactive")
    throw new TRPCError({ code: "FORBIDDEN", message: "This is not an active worker login." });
  return { db, account: row.account, person: row.person };
}

/** Sites the worker is on (active assignment), with project ids for drawings. */
export async function workerSites(db: Db, personId: string) {
  return db
    .select({ id: sites.id, name: sites.name, projectId: sites.projectId, status: sites.status })
    .from(personSiteAssignments)
    .innerJoin(sites, eq(personSiteAssignments.siteId, sites.id))
    .where(
      and(eq(personSiteAssignments.personId, personId), eq(personSiteAssignments.status, "Active")),
    );
}

const ATTENDANCE_DAYS = 45;

/** Everything the worker screen shows, limited to the switched-on features. */
async function bundle(db: Db, personId: string, features: readonly WorkerFeature[]) {
  const [person] = await db
    .select({ id: people.id, name: people.fullName, trade: people.tradeType })
    .from(people)
    .where(eq(people.id, personId))
    .limit(1);
  const mySites = await workerSites(db, personId);
  const siteIds = mySites.map((site) => site.id);
  const has = (feature: WorkerFeature) => features.includes(feature);

  const money = has("money")
    ? await Promise.all(
        mySites.map(async (site) => {
          const { position } = await personPosition(db, site.id, personId);
          return {
            siteId: site.id,
            siteName: site.name,
            dueMinor: position.dueMinor.toString(),
            paidMinor: position.paidMinor.toString(),
            advanceOutstandingMinor: position.advanceOutstandingMinor.toString(),
            lastPaidOn: position.lastPaidOn,
          };
        }),
      )
    : null;

  let attendance:
    | { date: string; siteName: string; status: string; approved: boolean; overtimeHours: string }[]
    | null = null;
  if (has("attendance") && siteIds.length) {
    const since = new Date(Date.now() - ATTENDANCE_DAYS * 86_400_000).toISOString().slice(0, 10);
    const rows = await db
      .select({
        date: attendanceRecords.workDate,
        siteId: attendanceRecords.siteId,
        status: attendanceRecords.attendanceStatus,
        reviewedBy: attendanceRecords.reviewedBy,
        overtime: attendanceRecords.overtimeHours,
      })
      .from(attendanceRecords)
      .innerJoin(workerEngagements, eq(attendanceRecords.workerEngagementId, workerEngagements.id))
      .where(
        and(
          eq(workerEngagements.personId, personId),
          inArray(attendanceRecords.siteId, siteIds),
          gte(attendanceRecords.workDate, since),
        ),
      )
      .orderBy(desc(attendanceRecords.workDate))
      .limit(120);
    attendance = rows.map((row) => ({
      date: String(row.date),
      siteName: mySites.find((site) => site.id === row.siteId)?.name ?? "",
      status: row.status,
      approved: row.reviewedBy !== null,
      overtimeHours: String(row.overtime),
    }));
  }

  let drawings:
    | { id: string; title: string; siteName: string | null; version: number; updatedAt: Date }[]
    | null = null;
  if (has("drawings") && mySites.length) {
    const projectIds = [...new Set(mySites.map((site) => site.projectId))];
    const docs = await db
      .select({
        id: projectDocuments.id,
        title: projectDocuments.title,
        siteId: projectDocuments.siteId,
        projectId: projectDocuments.projectId,
        version: projectDocuments.currentVersion,
        updatedAt: projectDocuments.updatedAt,
      })
      .from(projectDocuments)
      .where(
        and(
          eq(projectDocuments.category, "Drawings"),
          eq(projectDocuments.status, "Active"),
          or(
            inArray(projectDocuments.siteId, siteIds),
            and(isNull(projectDocuments.siteId), inArray(projectDocuments.projectId, projectIds)),
          ),
        ),
      )
      .orderBy(desc(projectDocuments.updatedAt))
      .limit(100);
    drawings = docs.map((doc) => ({
      id: doc.id,
      title: doc.title,
      siteName: doc.siteId ? (mySites.find((site) => site.id === doc.siteId)?.name ?? null) : null,
      version: doc.version,
      updatedAt: doc.updatedAt,
    }));
  }

  let contacts: { name: string | null; role: string; phone: string }[] | null = null;
  if (has("call") && siteIds.length) {
    const leads = await db
      .select({
        name: users.name,
        role: siteAssignments.assignmentRole,
        phone: userContactPreferences.phone,
      })
      .from(siteAssignments)
      .innerJoin(users, eq(siteAssignments.userId, users.id))
      .innerJoin(userContactPreferences, eq(userContactPreferences.userId, users.id))
      .where(
        and(
          inArray(siteAssignments.siteId, siteIds),
          eq(siteAssignments.status, "Active"),
          inArray(siteAssignments.assignmentRole, ["supervisor", "project_manager"]),
        ),
      );
    const seen = new Set<string>();
    contacts = leads
      .filter((row): row is typeof row & { phone: string } => Boolean(row.phone))
      .filter((row) => (seen.has(row.phone) ? false : (seen.add(row.phone), true)))
      .sort((a, b) => (a.role === "supervisor" ? -1 : 1) - (b.role === "supervisor" ? -1 : 1));
  }

  return {
    person: { id: person?.id ?? personId, name: person?.name ?? "", trade: person?.trade ?? null },
    sites: mySites.map((site) => ({ id: site.id, name: site.name })),
    features,
    money,
    attendance,
    drawings,
    contacts,
  };
}

/** A drawing the worker (or the supervisor showing the worker view) may open. */
async function assertDrawingVisible(db: Db, personId: string, documentId: string) {
  const mySites = await workerSites(db, personId);
  const [doc] = await db
    .select({
      siteId: projectDocuments.siteId,
      projectId: projectDocuments.projectId,
      category: projectDocuments.category,
      status: projectDocuments.status,
    })
    .from(projectDocuments)
    .where(eq(projectDocuments.id, documentId))
    .limit(1);
  const visible =
    doc &&
    doc.category === "Drawings" &&
    doc.status === "Active" &&
    mySites.some((site) =>
      doc.siteId ? site.id === doc.siteId : site.projectId === doc.projectId,
    );
  if (!visible)
    throw new TRPCError({ code: "FORBIDDEN", message: "This drawing is not shared with you." });
}

async function openDrawing(db: Db, documentId: string) {
  const { projectDocumentVersions, attachments } = await import("../../drizzle/schema");
  const { storageGetSignedUrl } = await import("../storage");
  const [doc] = await db
    .select({ version: projectDocuments.currentVersion })
    .from(projectDocuments)
    .where(eq(projectDocuments.id, documentId))
    .limit(1);
  const [file] = await db
    .select({ storageKey: attachments.storageKey, contentType: attachments.contentType })
    .from(projectDocumentVersions)
    .innerJoin(attachments, eq(projectDocumentVersions.attachmentId, attachments.id))
    .where(
      and(
        eq(projectDocumentVersions.documentId, documentId),
        eq(projectDocumentVersions.versionNumber, doc?.version ?? 1),
      ),
    )
    .limit(1);
  if (!file) throw new TRPCError({ code: "NOT_FOUND", message: "File not found." });
  try {
    return { url: await storageGetSignedUrl(file.storageKey), contentType: file.contentType };
  } catch {
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message: "File storage is unavailable right now. Try again shortly.",
    });
  }
}

/** The worker's account for staff: person must be on a site the caller manages workforce for. */
async function staffScope(user: User, siteId: string, personId: string, key: string) {
  const scope = await getSiteScope(user, siteId, key);
  const db = requireDb(await getDb());
  const [assigned] = await db
    .select({ id: personSiteAssignments.id, name: people.fullName, orgId: people.organizationId })
    .from(personSiteAssignments)
    .innerJoin(people, eq(personSiteAssignments.personId, people.id))
    .where(
      and(
        eq(personSiteAssignments.siteId, scope.siteId),
        eq(personSiteAssignments.personId, personId),
        eq(personSiteAssignments.status, "Active"),
      ),
    )
    .limit(1);
  if (!assigned || assigned.orgId !== scope.organizationId)
    throw new TRPCError({ code: "NOT_FOUND", message: "This person is not on this site's team." });
  const [account] = await db
    .select()
    .from(workerAccounts)
    .where(eq(workerAccounts.personId, personId))
    .limit(1);
  return { db, scope, personName: assigned.name, account: account ?? null };
}

const featureList = z.array(z.enum(WORKER_FEATURES)).max(WORKER_FEATURES.length);

export const workerRouter = router({
  /** The signed-in worker's own screen. */
  me: protectedProcedure.query(async ({ ctx }) => {
    const { db, account } = await workerOf(ctx.user);
    return bundle(db, account.personId, parseFeatures(account.features));
  }),

  openDrawing: protectedProcedure
    .input(z.object({ documentId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const { db, account } = await workerOf(ctx.user);
      if (!parseFeatures(account.features).includes("drawings"))
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "Drawings are not switched on for you.",
        });
      await assertDrawingVisible(db, account.personId, input.documentId);
      return openDrawing(db, input.documentId);
    }),

  /** Supervisor shows a worker their own screen on the supervisor's phone. */
  viewFor: protectedProcedure
    .input(z.object({ siteId: z.string().uuid(), personId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const { db, account } = await staffScope(
        ctx.user,
        input.siteId,
        input.personId,
        "workforce.view",
      );
      return bundle(
        db,
        input.personId,
        account ? parseFeatures(account.features) : ["money", "attendance", "drawings"],
      );
    }),

  openDrawingFor: protectedProcedure
    .input(
      z.object({
        siteId: z.string().uuid(),
        personId: z.string().uuid(),
        documentId: z.string().uuid(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const { db } = await staffScope(ctx.user, input.siteId, input.personId, "workforce.view");
      await assertDrawingVisible(db, input.personId, input.documentId);
      return openDrawing(db, input.documentId);
    }),

  /** Login status and features for a worker (staff). */
  account: protectedProcedure
    .input(z.object({ siteId: z.string().uuid(), personId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const { account, personName } = await staffScope(
        ctx.user,
        input.siteId,
        input.personId,
        "workforce.view",
      );
      const canManage = await getSiteScope(ctx.user, input.siteId, "workforce.review")
        .then(() => true)
        .catch(() => false);
      return {
        personName,
        canManage,
        account: account
          ? {
              mobile: account.mobile,
              status: account.status,
              features: parseFeatures(account.features),
              locked: Boolean(account.lockedUntil && account.lockedUntil > new Date()),
            }
          : null,
      };
    }),

  /** Create the worker's login or reset the PIN (workforce.review). */
  setLogin: protectedProcedure
    .input(
      z.object({
        siteId: z.string().uuid(),
        personId: z.string().uuid(),
        mobile: z.string().trim().min(10).max(16),
        pin: z.string().trim().max(6),
        features: featureList.optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const { db, scope, personName, account } = await staffScope(
        ctx.user,
        input.siteId,
        input.personId,
        "workforce.review",
      );
      const mobile = normalizeIndianMobile(input.mobile);
      if (!mobile) bad("Enter a 10-digit Indian mobile number.");
      const pinProblem = checkPin(input.pin);
      if (pinProblem) bad(pinProblem);
      const [taken] = await db
        .select({ personId: workerAccounts.personId })
        .from(workerAccounts)
        .where(eq(workerAccounts.mobile, mobile))
        .limit(1);
      if (taken && taken.personId !== input.personId)
        bad("This mobile number already has a worker login.");
      const pinHash = await hashPin(input.pin);
      const features = JSON.stringify(input.features ?? parseFeatures(account?.features));
      await db.transaction(async (tx) => {
        if (account) {
          await tx
            .update(workerAccounts)
            .set({
              mobile,
              pinHash,
              features,
              failedAttempts: 0,
              lockedUntil: null,
              status: "Active",
            })
            .where(eq(workerAccounts.id, account.id));
          await tx
            .update(users)
            .set({ accountStatus: "Active", name: personName })
            .where(eq(users.id, account.userId));
        } else {
          const openId = `worker_${randomUUID().replaceAll("-", "")}`.slice(0, 64);
          await tx.insert(users).values({
            openId,
            name: personName,
            loginMethod: "worker_pin",
            role: "user",
            accountStatus: "Active",
          });
          const [created] = await tx
            .select({ id: users.id })
            .from(users)
            .where(eq(users.openId, openId))
            .limit(1);
          // A credential row is required for app sessions; its password is random and never
          // given out, so this account can only sign in with the PIN.
          await tx.insert(userCredentials).values({
            id: randomUUID(),
            userId: created.id,
            username: `w-${randomUUID().slice(0, 12)}`,
            passwordHash: await hashPassword(randomBytes(32).toString("hex")),
            mustChangePassword: 0,
          });
          await tx.insert(workerAccounts).values({
            id: randomUUID(),
            organizationId: scope.organizationId,
            personId: input.personId,
            userId: created.id,
            mobile,
            pinHash,
            features,
            status: "Active",
            createdBy: ctx.user.id,
          });
        }
        await tx.insert(auditEvents).values({
          id: randomUUID(),
          organizationId: scope.organizationId,
          siteId: scope.siteId,
          actorUserId: ctx.user.id,
          action: account ? "workforce.worker_login_reset" : "workforce.worker_login_create",
          entityType: "person",
          entityId: input.personId,
          afterSummary: JSON.stringify({
            mobile: `******${mobile.slice(-4)}`,
            features: JSON.parse(features),
          }),
        });
      });
      return { ok: true };
    }),

  /** Switch features or turn the login off/on (workforce.review). */
  update: protectedProcedure
    .input(
      z.object({
        siteId: z.string().uuid(),
        personId: z.string().uuid(),
        features: featureList.optional(),
        status: z.enum(["Active", "Disabled"]).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const { db, scope, account } = await staffScope(
        ctx.user,
        input.siteId,
        input.personId,
        "workforce.review",
      );
      if (!account) bad("This worker has no app login yet.");
      await db.transaction(async (tx) => {
        await tx
          .update(workerAccounts)
          .set({
            ...(input.features ? { features: JSON.stringify(input.features) } : {}),
            ...(input.status ? { status: input.status } : {}),
          })
          .where(eq(workerAccounts.id, account.id));
        if (input.status === "Disabled") {
          // Sign the worker out everywhere at once.
          const { authSessions } = await import("../../drizzle/schema");
          await tx
            .update(authSessions)
            .set({ revokedAt: new Date() })
            .where(and(eq(authSessions.userId, account.userId), isNull(authSessions.revokedAt)));
        }
        await tx.insert(auditEvents).values({
          id: randomUUID(),
          organizationId: scope.organizationId,
          siteId: scope.siteId,
          actorUserId: ctx.user.id,
          action: "workforce.worker_login_update",
          entityType: "person",
          entityId: input.personId,
          beforeSummary: JSON.stringify({
            status: account.status,
            features: parseFeatures(account.features),
          }),
          afterSummary: JSON.stringify({
            status: input.status ?? account.status,
            features: input.features,
          }),
        });
      });
      return { ok: true };
    }),
});
