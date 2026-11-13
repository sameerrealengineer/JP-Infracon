import { beforeAll, describe, expect, it, vi } from "vitest";

// Account hierarchy over the demo SQLite database, through the real procedures: a Site
// Engineer manages people below them on their own sites only; edit, reset, suspend and remove
// follow the same rule; a lower role cannot touch a higher one.
vi.mock("../../server/db", () => import("./server/db"));
vi.mock("../../server/_core/sdk", () => import("./server/sdk"));
vi.mock("../../server/storage", () => import("./server/storage"));

const { setDemoDriver } = await import("./runtime");
const { createNodeDriver } = await import("./testing/node-driver");
const { ensureDemoData } = await import("./backend");
const { signIn, callerFor } = await import("./seed");

type Caller = Awaited<ReturnType<typeof signIn>>;
let owner: Caller, supervisor: Caller, engineer: Caller;
let organizationId = "";
let ownSite = "";
let otherSite = "";

async function firstSignIn(username: string, temporaryPassword: string) {
  const guest = await callerFor(null);
  const first = await guest.auth.login({ username, password: temporaryPassword });
  const changed = await (
    await callerFor(first.sessionToken)
  ).auth.changePassword({
    currentPassword: temporaryPassword,
    newPassword: "a-long-new-password-2026",
  });
  return callerFor(changed.sessionToken ?? first.sessionToken);
}

describe("account hierarchy", () => {
  beforeAll(async () => {
    await setDemoDriver(createNodeDriver());
    await ensureDemoData();
    [owner, supervisor] = await Promise.all(["owner", "supervisor"].map(signIn));
    const [company] = await owner.jp.accounts.options();
    organizationId = company!.id;
    const sites = await owner.jp.workspace.mySites();
    ownSite = sites.find((site) => site.code === "PATIA-A")!.id;
    otherSite = sites.find((site) => site.code !== "PATIA-A")!.id;
    const made = await owner.jp.accounts.create({
      organizationId,
      displayName: "Test Site Engineer",
      username: "eng.test",
      businessRole: "site_engineer",
      siteIds: [ownSite],
    });
    engineer = await firstSignIn(made.username, made.temporaryPassword);
  }, 120_000);

  it("offers a Site Engineer only their own sites and the roles below them", async () => {
    const [company] = await engineer.jp.accounts.options();
    expect(company!.wholeCompany).toBe(false);
    expect(company!.sites.map((site) => site.id)).toEqual([ownSite]);
    expect(company!.assignableRoles).toEqual(["supervisor", "accounts", "storekeeper", "auditor"]);
  });

  it("creates people on their own site only, never above themselves", async () => {
    await expect(
      engineer.jp.accounts.create({
        organizationId,
        displayName: "Other Site Person",
        username: "other.site",
        businessRole: "supervisor",
        siteIds: [otherSite],
      }),
    ).rejects.toThrow(/own sites/);
    await expect(
      engineer.jp.accounts.create({
        organizationId,
        displayName: "Too High",
        username: "too.high",
        businessRole: "project_manager",
        siteIds: [ownSite],
      }),
    ).rejects.toThrow();
    const made = await engineer.jp.accounts.create({
      organizationId,
      displayName: "New Supervisor",
      username: "new.sup",
      businessRole: "supervisor",
      siteIds: [ownSite],
    });
    expect(made.temporaryPassword.length).toBeGreaterThanOrEqual(12);
  });

  it("lists only people on their sites, with what they may change", async () => {
    const people = await engineer.jp.accounts.list({ organizationId });
    const fresh = people.find((row) => row.username === "new.sup");
    expect(fresh?.manageable).toBe(true);
    // Everyone listed shares one of the engineer's sites (or is the engineer).
    for (const row of people)
      if (row.username !== "eng.test")
        expect(row.assignedSites.some((site) => site.siteId === ownSite)).toBe(true);
    const higher = people.find((row) => row.businessRole === "project_manager");
    if (higher) expect(higher.manageable).toBe(false);
  });

  it("edits, resets, suspends and removes someone below them", async () => {
    const people = await engineer.jp.accounts.list({ organizationId });
    const target = people.find((row) => row.username === "new.sup")!;
    await engineer.jp.accounts.update({
      organizationId,
      userId: target.id,
      displayName: "Renamed Supervisor",
      businessRole: "storekeeper",
      siteIds: [ownSite],
    });
    const reset = await engineer.jp.accounts.resetPassword({ organizationId, userId: target.id });
    expect(reset.username).toBe("new.sup");
    await engineer.jp.accounts.setStatus({
      organizationId,
      userId: target.id,
      status: "Suspended",
    });
    const removed = await engineer.jp.accounts.remove({
      organizationId,
      userId: target.id,
      reason: "Left the job",
    });
    expect(removed.leftCompany).toBe(true);
    const after = (await owner.jp.accounts.list({ organizationId })).find(
      (row) => row.id === target.id,
    );
    expect(after).toMatchObject({
      name: "Renamed Supervisor",
      businessRole: "storekeeper",
      membershipStatus: "Deactivated",
      accountStatus: "Deactivated",
    });
    // Only a company leader brings someone back.
    await expect(
      engineer.jp.accounts.restore({ organizationId, userId: target.id }),
    ).rejects.toThrow();
    await owner.jp.accounts.restore({ organizationId, userId: target.id });
  });

  it("does not let a Site Supervisor change a Site Engineer", async () => {
    const engineerRow = (await owner.jp.accounts.list({ organizationId })).find(
      (row) => row.username === "eng.test",
    )!;
    await expect(
      supervisor.jp.accounts.setStatus({
        organizationId,
        userId: engineerRow.id,
        status: "Suspended",
      }),
    ).rejects.toThrow();
  });
});
