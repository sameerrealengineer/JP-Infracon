/**
 * Sample data for the offline demo, created through the real server procedures so every record
 * passes the same rules and has its audit trail. Runs once, on an empty demo database.
 */
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { systemBootstrap, userCredentials, users } from "../../drizzle/schema";
import { hashPassword } from "../../server/_core/credential-auth";
import { appRouter } from "../../server/routers";
import { DEMO_ACCOUNTS, DEMO_PASSWORD } from "./config";
import { buildDemoContext } from "./context";
import type { DemoDb } from "./sql/engine";
import { seedBusinessData } from "./seed-business";

export type DemoCaller = ReturnType<typeof appRouter.createCaller>;

export async function callerFor(token: string | null) {
  return appRouter.createCaller(await buildDemoContext(token));
}

export async function signIn(username: string): Promise<DemoCaller> {
  const guest = await callerFor(null);
  const { sessionToken } = await guest.auth.login({ username, password: DEMO_PASSWORD });
  return callerFor(sessionToken);
}

export const mutationId = () => `demo-${randomUUID()}`;

export type DemoWorkspace = {
  organizationId: string;
  projectId: string;
  siteIds: [string, string];
};

export async function seedDemoData(db: DemoDb): Promise<void> {
  const [existing] = await db.select({ id: users.id }).from(users).limit(1);
  if (existing) return;

  const passwordHash = await hashPassword(DEMO_PASSWORD);
  const now = new Date();

  // The Super Admin, as the one time bootstrap would create it.
  const owner = DEMO_ACCOUNTS.find((account) => account.role === "owner")!;
  await db.insert(systemBootstrap).values({ bootstrapKey: "first_super_admin" });
  await db.insert(users).values({
    openId: `demo_${owner.username}`,
    name: owner.displayName,
    email: null,
    loginMethod: "username_password",
    role: "super_admin",
    accountStatus: "Active",
    lastSignedIn: now,
  });
  const [ownerRow] = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.openId, `demo_${owner.username}`))
    .limit(1);
  await db.insert(userCredentials).values({
    id: randomUUID(),
    userId: ownerRow.id,
    username: owner.username,
    passwordHash,
    mustChangePassword: 0,
    passwordChangedAt: now,
  });
  await db
    .update(systemBootstrap)
    .set({ completedAt: now, completedByUserId: ownerRow.id })
    .where(eq(systemBootstrap.bootstrapKey, "first_super_admin"));

  const asOwner = await signIn(owner.username);
  const first = await asOwner.jp.workspace.initializeFirstWorkspace({
    organizationName: "JP Infracon (Demo)",
    organizationCode: "JPDEMO",
    projectName: "Bhubaneswar Housing Phase 1",
    projectCode: "BBSR-H1",
    projectType: "Residential",
    siteName: "Patia Tower A",
    siteCode: "PATIA-A",
    address: "Patia, Bhubaneswar, Odisha",
  });
  const second = await asOwner.jp.sitesAdmin.createSite({
    projectId: first.projectId,
    siteCode: "KGIRI-B",
    name: "Khandagiri Row Houses B",
    address: "Khandagiri, Bhubaneswar",
    district: "Khordha",
    state: "Odisha",
    clientMutationId: mutationId(),
  });
  const workspace: DemoWorkspace = {
    organizationId: first.organizationId,
    projectId: first.projectId,
    siteIds: [first.siteId, second.id],
  };

  // The other demo people, created the way an administrator adds accounts.
  for (const account of DEMO_ACCOUNTS) {
    if (account.role === "owner") continue;
    const organizationWide = account.role === "director";
    const created = await asOwner.jp.accounts.create({
      organizationId: workspace.organizationId,
      displayName: account.displayName,
      username: account.username,
      businessRole: account.role,
      siteIds: organizationWide ? [] : [...workspace.siteIds],
    });
    // Demo accounts skip the temporary password step and share the demo password.
    await db
      .update(userCredentials)
      .set({ passwordHash, mustChangePassword: 0 })
      .where(eq(userCredentials.userId, created.userId));
  }

  await seedBusinessData(workspace);
}
