import { randomUUID } from "node:crypto";
import { describe, expect, it, vi } from "vitest";

// The production client seed (server/seed/client-data.ts) run end to end on an empty database
// with only a Super Admin, as it will run on the server after the database reset.
vi.mock("../../server/db", () => import("./server/db"));
vi.mock("../../server/_core/sdk", () => import("./server/sdk"));
vi.mock("../../server/storage", () => import("./server/storage"));

const { setDemoDriver } = await import("./runtime");
const { createNodeDriver } = await import("./testing/node-driver");
const { getDb } = await import("../../server/db");
const { systemBootstrap, userCredentials, users } = await import("../../drizzle/schema");
const { hashPassword } = await import("../../server/_core/credential-auth");
const { seedClientData, SEED_SITE_CODE } = await import("../../server/seed/client-data");
const { callerForUserId } = await import("../../server/seed/caller");

describe("client seed", () => {
  it("puts the client's people, suppliers, site and sample records in through the API", async () => {
    await setDemoDriver(createNodeDriver());
    const db = (await getDb())!;
    await db.insert(systemBootstrap).values({ bootstrapKey: "first_super_admin" });
    await db.insert(users).values({
      openId: "local_test_super",
      name: "Sameer Swain",
      email: null,
      loginMethod: "username_password",
      role: "super_admin",
      accountStatus: "Active",
      lastSignedIn: new Date(),
    });
    const [admin] = await db.select({ id: users.id }).from(users).limit(1);
    await db.insert(userCredentials).values({
      id: randomUUID(),
      userId: admin!.id,
      username: "sameer",
      passwordHash: await hashPassword("not-used-in-this-test"),
      mustChangePassword: 0,
      passwordChangedAt: new Date(),
    });
    const boss = await callerForUserId(admin!.id);
    const result = await seedClientData({ boss, callerFor: callerForUserId });

    expect(result.logins.map((login) => login.username)).toEqual([
      "sipun.gouda",
      "accounts.sample",
    ]);
    const sites = await boss.jp.workspace.mySites();
    expect(sites.find((site) => site.code === SEED_SITE_CODE)?.name).toContain("Kalyan Mandap");
    const found = await boss.jp.people.search({ query: "" });
    const names = JSON.stringify(found.people);
    for (const name of ["Sipun Gouda", "Musha Behera", "Pahalad", "Rabindra Ku Nayak"])
      expect(names).toContain(name);
    const vendors = await boss.jp.finance.listVendors({ siteId: result.siteId });
    const vendorNames = JSON.stringify(vendors);
    expect(vendorNames).toContain("Bhagabati Enterprises");
    expect(vendorNames).toContain("Rajdhani UPVC");
  }, 240_000);
});
