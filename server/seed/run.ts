/**
 * Runs the client start data in order, safe to run again (each part runs once):
 * 1. First round (client-data.ts) when the site ASKA-KM1 is not there yet.
 * 2. Lists the first round's example rows as SAMPLE (everything except the real company,
 *    project, site, people, suppliers and the real logins) when nothing is listed yet.
 * 3. Second round (more-data.ts) when the Sheragada project is not there yet: its project and
 *    10 tank sites (real), the example records (listed as SAMPLE as they are made), then Kalyan
 *    Mandap marked Completed (real).
 */
import { randomUUID } from "node:crypto";
import { and, asc, eq, inArray, like } from "drizzle-orm";
import {
  auditEvents,
  organizationMemberships,
  leaveRequests,
  projects,
  sampleRecords,
  warranties,
  siteAssignments,
  sites,
  userCredentials,
  users,
} from "../../drizzle/schema";
import { getDb } from "../db";
import { callerForUserId, userIdByUsername } from "./caller";
import { SEED_SITE_CODE, seedClientData, type SeedResult } from "./client-data";
import {
  SHERAGADA_PROJECT_CODE,
  completeKalyanMandap,
  createSheragada,
  markKalyanMandapCompleted,
  sheragadaWork,
} from "./more-data";
import { addRealPhotos, addSampleMedia, addSampleWarranties } from "./media-data";
import { seedRolesAndRequests } from "./roles-data";
import { newRows, registerSample, rowsCreatedSince, snapshot } from "./sample-registry";

const ROLE_LOGINS = [
  "director.sample",
  "admin.sample",
  "pm.sample",
  "engineer.sample",
  "store.sample",
  "auditor.sample",
];

/** Tables whose every row is real (company structure, people, suppliers, settings). */
const REAL_TABLES = new Set([
  "organizations",
  "projects",
  "sites",
  "people",
  "person_details",
  "person_site_assignments",
  "vendors",
  "organization_settings",
  "user_profiles",
  "user_contact_preferences",
  "site_presence_settings",
  "site_geofences",
  "payroll_settings",
  "alert_rules",
]);

export async function runClientSeed(superAdminUsername: string) {
  const db = await getDb();
  if (!db) throw new Error("The database is not available.");
  const adminId = await userIdByUsername(superAdminUsername);
  if (!adminId) throw new Error(`No account with username "${superAdminUsername}".`);
  const boss = await callerForUserId(adminId);
  const me = await boss.auth.me();
  if (me?.platformRole !== "super_admin")
    throw new Error(`"${superAdminUsername}" is not the Super Admin.`);
  const notes: string[] = [];
  let logins: SeedResult["logins"] = [];

  // 1. First round.
  const [aska] = await db.select().from(sites).where(eq(sites.siteCode, SEED_SITE_CODE)).limit(1);
  if (!aska) {
    logins = (await seedClientData({ boss, callerFor: callerForUserId })).logins;
    notes.push("First round added.");
  }

  // 2. List the first round's example rows.
  const [listed] = await db.select({ id: sampleRecords.id }).from(sampleRecords).limit(1);
  if (!listed) {
    const sampleLogin = await userIdByUsername("accounts.sample");
    const all = await snapshot(db);
    const realUsers = [...(all.get("users") ?? [])].filter(
      (rowId) => Number(rowId) !== sampleLogin,
    );
    const realUserIds = realUsers.map(Number);
    const keep = new Map<string, Set<string>>([["users", new Set(realUsers)]]);
    const idsWhereUser = async (
      table: typeof userCredentials | typeof organizationMemberships | typeof siteAssignments,
    ) =>
      new Set(
        (
          await db
            .select({ id: table.id })
            .from(table)
            .where(inArray(table.userId, realUserIds.length ? realUserIds : [-1]))
        ).map((row: { id: unknown }) => String(row.id)),
      );
    keep.set("user_credentials", await idsWhereUser(userCredentials));
    keep.set("organization_memberships", await idsWhereUser(organizationMemberships));
    keep.set("site_assignments", await idsWhereUser(siteAssignments));
    // Audit rows about real things (their creation) stay.
    const realIds = new Set<string>();
    for (const [table, ids] of all)
      if (REAL_TABLES.has(table)) for (const rowId of ids) realIds.add(rowId);
    for (const ids of keep.values()) for (const rowId of ids) realIds.add(rowId);
    const audit = await db
      .select({ id: auditEvents.id, entityId: auditEvents.entityId })
      .from(auditEvents);
    keep.set(
      "audit_events",
      new Set(
        audit
          .filter((row: { entityId: string | null }) => row.entityId && realIds.has(row.entityId))
          .map((row: { id: string }) => row.id),
      ),
    );
    const rows: { tableName: string; rowId: string }[] = [];
    for (const [tableName, ids] of all) {
      if (REAL_TABLES.has(tableName)) continue;
      const kept = keep.get(tableName);
      for (const rowId of ids) if (!kept?.has(rowId)) rows.push({ tableName, rowId });
    }
    notes.push(`${await registerSample(db, rows)} first-round rows listed as SAMPLE.`);
  }

  // 3. Second round.
  const [sheragada] = await db
    .select({ id: projects.id })
    .from(projects)
    .where(eq(projects.projectCode, SHERAGADA_PROJECT_CODE))
    .limit(1);
  if (!sheragada) {
    const [site] = await db.select().from(sites).where(eq(sites.siteCode, SEED_SITE_CODE)).limit(1);
    const sipunUserId = await userIdByUsername("sipun.gouda");
    const accountsUserId = await userIdByUsername("accounts.sample");
    if (!site || !sipunUserId || !accountsUserId)
      throw new Error("The first round is incomplete (site or logins missing).");
    const ctx = {
      boss,
      sipun: await callerForUserId(sipunUserId),
      acc: await callerForUserId(accountsUserId),
      organizationId: site.organizationId,
      sipunUserId,
      accountsUserId,
      today: new Date().toISOString().slice(0, 10),
    };
    const sheragadaIds = await createSheragada(ctx);
    const found = await boss.jp.people.search({ query: "" });
    const people: Record<string, string> = {};
    for (const person of found.people) people[person.fullName.split(" ")[0]!] = person.id;
    const before = await snapshot(db);
    await completeKalyanMandap(ctx, { projectId: site.projectId, siteId: site.id });
    await sheragadaWork(ctx, { ...sheragadaIds, people });
    const added = newRows(before, await snapshot(db));
    notes.push(`${await registerSample(db, added)} second-round rows listed as SAMPLE.`);
    await markKalyanMandapCompleted(ctx, { projectId: site.projectId, siteId: site.id });
    notes.push("Sheragada project with 10 tank sites added; Kalyan Mandap marked Completed.");
  }
  // 4. Photos, drawings and documents (once: when the Kalyan Mandap site has no cover yet).
  const [kalyan] = await db.select().from(sites).where(eq(sites.siteCode, SEED_SITE_CODE)).limit(1);
  const [water] = await db
    .select({ id: projects.id })
    .from(projects)
    .where(eq(projects.projectCode, SHERAGADA_PROJECT_CODE))
    .limit(1);
  if (kalyan && water && !kalyan.coverAttachmentId) {
    const tanks = await db
      .select({ id: sites.id })
      .from(sites)
      .where(like(sites.siteCode, "SHG-OHT%"))
      .orderBy(asc(sites.siteCode));
    const ids = {
      kalyan: { projectId: kalyan.projectId, siteId: kalyan.id },
      sheragada: { projectId: water.id, siteIds: tanks.map((row: { id: string }) => row.id) },
    };
    // A completed site takes no new records: reopen it for the handover papers, then close it.
    const wasCompleted = kalyan.status === "Completed";
    const setStatus = async (status: "Active" | "Completed", reason: string) => {
      if (status === "Active") {
        await boss.jp.sitesAdmin.setProjectStatus({
          projectId: kalyan.projectId,
          status,
          reason,
          clientMutationId: `seed-${randomUUID()}`,
        });
        await boss.jp.sitesAdmin.setSiteStatus({
          siteId: kalyan.id,
          status,
          reason,
          clientMutationId: `seed-${randomUUID()}`,
        });
      } else {
        await boss.jp.sitesAdmin.setSiteStatus({
          siteId: kalyan.id,
          status,
          reason,
          clientMutationId: `seed-${randomUUID()}`,
        });
        await boss.jp.sitesAdmin.setProjectStatus({
          projectId: kalyan.projectId,
          status,
          reason,
          clientMutationId: `seed-${randomUUID()}`,
        });
      }
    };
    if (wasCompleted) await setStatus("Active", "Reopened to add photos and handover documents.");
    await addRealPhotos(boss, ids);
    const before = await snapshot(db);
    await addSampleMedia(boss, ids);
    const added = newRows(before, await snapshot(db));
    notes.push(`${await registerSample(db, added)} photo and document rows listed as SAMPLE.`);
    if (wasCompleted) await setStatus("Completed", "Work complete and handed over.");
  }
  // 5. Warranty cards (once: when there are none).
  const [anyWarranty] = await db.select({ id: warranties.id }).from(warranties).limit(1);
  if (kalyan && water && !anyWarranty) {
    const tanks = await db
      .select({ id: sites.id })
      .from(sites)
      .where(like(sites.siteCode, "SHG-OHT%"))
      .orderBy(asc(sites.siteCode));
    const ids = {
      kalyan: { projectId: kalyan.projectId, siteId: kalyan.id },
      sheragada: { projectId: water.id, siteIds: tanks.map((row: { id: string }) => row.id) },
    };
    const vendorsBySite: Record<string, { id: string; legalName: string }[]> = {};
    for (const siteId of [kalyan.id, ids.sheragada.siteIds[0]!])
      vendorsBySite[siteId] = (await boss.jp.finance.listVendors({ siteId })).rows;
    const before = await snapshot(db);
    await addSampleWarranties(boss, ids, vendorsBySite, new Date().toISOString().slice(0, 10));
    notes.push(
      `${await registerSample(db, newRows(before, await snapshot(db)))} warranty rows listed as SAMPLE.`,
    );
  }
  // 6. A login for every other role with their work, leave and returns (once).
  const [anyLeave] = await db.select({ id: leaveRequests.id }).from(leaveRequests).limit(1);
  const sipunId = await userIdByUsername("sipun.gouda");
  const accountsId = await userIdByUsername("accounts.sample");
  // An earlier run may have stopped after making the role logins: list its rows too.
  const [earlier] = await db
    .select({ createdAt: users.createdAt })
    .from(users)
    .innerJoin(userCredentials, eq(userCredentials.userId, users.id))
    .where(eq(userCredentials.username, "director.sample"))
    .limit(1);
  const [leaveListed] = anyLeave
    ? await db
        .select({ id: sampleRecords.id })
        .from(sampleRecords)
        .where(
          and(eq(sampleRecords.tableName, "leave_requests"), eq(sampleRecords.rowId, anyLeave.id)),
        )
        .limit(1)
    : [null];
  if (anyLeave && earlier && !leaveListed) {
    // The work is there but was never listed (a run stopped while listing): list it now, and
    // give the role logins fresh temporary passwords, since the old ones were never saved.
    const rows = await rowsCreatedSince(db, new Date(earlier.createdAt));
    notes.push(`${await registerSample(db, rows)} role, leave and return rows listed as SAMPLE.`);
    const [company] = await boss.jp.accounts.options();
    for (const username of ROLE_LOGINS) {
      const userId = await userIdByUsername(username);
      if (!userId || !company) continue;
      const reset = await boss.jp.accounts.resetPassword({ organizationId: company.id, userId });
      logins.push({
        name: username,
        role: username.split(".")[0]!,
        username,
        temporaryPassword: reset.temporaryPassword,
      });
    }
  }
  if (kalyan && water && !anyLeave && sipunId && accountsId) {
    const [earlierRun] = await db
      .select({ createdAt: users.createdAt })
      .from(users)
      .innerJoin(userCredentials, eq(userCredentials.userId, users.id))
      .where(eq(userCredentials.username, "director.sample"))
      .limit(1);
    const before = await snapshot(db);
    const result = await seedRolesAndRequests({
      userIdOf: userIdByUsername,
      db,
      boss,
      sipun: await callerForUserId(sipunId),
      acc: await callerForUserId(accountsId),
      callerFor: callerForUserId,
      today: new Date().toISOString().slice(0, 10),
    });
    logins = [...logins, ...result.logins];
    const added = newRows(before, await snapshot(db));
    if (earlierRun) added.push(...(await rowsCreatedSince(db, new Date(earlierRun.createdAt))));
    notes.push(`${await registerSample(db, added)} role, leave and return rows listed as SAMPLE.`);
  }
  return { notes, logins };
}
