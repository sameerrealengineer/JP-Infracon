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
const { SEED_SITE_CODE } = await import("../../server/seed/client-data");
const { runClientSeed } = await import("../../server/seed/run");
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
    const first = await runClientSeed("sameer");
    expect(first.logins.map((login) => login.username)).toEqual(["sipun.gouda", "accounts.sample"]);
    // Running again adds nothing.
    expect((await runClientSeed("sameer")).notes).toEqual([]);

    const sites = await boss.jp.workspace.mySites();
    expect(sites.find((site) => site.code === SEED_SITE_CODE)?.status).toBe("Completed");
    expect(sites.filter((site) => site.code.startsWith("SHG-OHT"))).toHaveLength(10);
    const names = JSON.stringify((await boss.jp.people.search({ query: "" })).people);
    for (const name of ["Sipun Gouda", "Musha Behera", "Pahalad", "Rabindra Ku Nayak"])
      expect(names).toContain(name);
    const aska = sites.find((site) => site.code === SEED_SITE_CODE)!;
    const tasks = await boss.jp.tasks.list({ siteId: aska.id });
    expect(tasks.every((task) => task.status === "Completed")).toBe(true);

    // Kalyan Mandap: the whole BOQ billed and every bill fully received.
    const contract = await boss.jp.billing.contract.get({ projectId: aska.projectId });
    expect(contract.items.every((row) => BigInt(row.balanceThousandths) === 0n)).toBe(true);
    const bills = await boss.jp.billing.bills.list({ projectId: aska.projectId });
    expect(bills.length).toBeGreaterThanOrEqual(3);
    expect(bills.every((bill) => bill.receivedMinor === bill.netReceivableMinor)).toBe(true);

    // One step removes every SAMPLE record; real people, suppliers, sites and logins stay.
    const organizationId = aska.organizationId;
    const before = await boss.jp.sampleData.status({ organizationId });
    expect(before.total).toBeGreaterThan(300);
    const removed = await boss.jp.sampleData.remove({
      organizationId,
      confirm: "REMOVE SAMPLE DATA",
    });
    expect(removed.kept).toBe(0);
    expect((await boss.jp.sampleData.status({ organizationId })).total).toBe(0);
    expect(await boss.jp.tasks.list({ siteId: aska.id })).toEqual([]);
    const after = JSON.stringify((await boss.jp.people.search({ query: "" })).people);
    for (const name of ["Sipun Gouda", "Musha Behera", "Pahalad", "Rabindra Ku Nayak"])
      expect(after).toContain(name);
    const vendors = JSON.stringify(await boss.jp.finance.listVendors({ siteId: aska.id }));
    for (const name of ["Bhagabati Enterprises", "Rajdhani UPVC", "Pahalad Mason Works"])
      expect(vendors).toContain(name);
    expect((await boss.jp.workspace.mySites()).length).toBe(11);
    const accounts = await boss.jp.accounts.list({ organizationId });
    expect(accounts.map((row) => row.username).sort()).toEqual(["sameer", "sipun.gouda"]);
  }, 600_000);
});
