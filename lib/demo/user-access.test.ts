import { beforeAll, describe, expect, it, vi } from "vitest";

// Per-user access over the demo SQLite database: switching a module Off for one person is
// enforced by the server, for the whole company or one site; it goes back to the role default.
vi.mock("../../server/db", () => import("./server/db"));
vi.mock("../../server/_core/sdk", () => import("./server/sdk"));
vi.mock("../../server/storage", () => import("./server/storage"));

const { setDemoDriver } = await import("./runtime");
const { createNodeDriver } = await import("./testing/node-driver");
const { ensureDemoData } = await import("./backend");
const { signIn } = await import("./seed");

type Caller = Awaited<ReturnType<typeof signIn>>;
let owner: Caller, director: Caller, manager: Caller;
let organizationId = "";
let siteA = "";
let siteB = "";
let managerId = 0;
let ownerId = 0;

describe("user access", () => {
  beforeAll(async () => {
    await setDemoDriver(createNodeDriver());
    await ensureDemoData();
    [owner, director, manager] = await Promise.all(["owner", "director", "manager"].map(signIn));
    const [org] = await owner.jp.accounts.options();
    organizationId = org.id;
    const people = await owner.jp.accounts.list({ organizationId });
    managerId = people.find((p) => p.username === "manager")!.id;
    ownerId = people.find((p) => p.username === "owner")!.id;
    const sites = await owner.jp.workspace.mySites();
    siteA = sites.find((s) => s.code === "PATIA-A")!.id;
    siteB = sites.find((s) => s.id !== siteA)!.id;
  }, 120_000);

  it("Off for the whole company is enforced, and As role brings it back", async () => {
    await expect(manager.jp.payroll.runs({ siteId: siteA })).resolves.toBeTruthy();
    const view = await owner.jp.userAccess.get({
      organizationId,
      userId: managerId,
      scopeType: "organization",
      scopeId: organizationId,
    });
    const payroll = view.groups.find((g) => g.key === "payroll")!;
    expect(payroll.permissions.find((p) => p.key === "payroll.view")).toMatchObject({
      roleDefault: true,
      choice: "default",
      effective: true,
    });
    await owner.jp.userAccess.set({
      organizationId,
      userId: managerId,
      scopeType: "organization",
      scopeId: organizationId,
      permissionKeys: payroll.permissions.map((p) => p.key),
      choice: "deny",
      reason: "Payroll is handled by head office",
    });
    await expect(manager.jp.payroll.runs({ siteId: siteA })).rejects.toThrow();
    const caps = await manager.jp.workspace.myCapabilities();
    expect(JSON.stringify(caps)).not.toMatch(/"payroll.view":true/);
    await owner.jp.userAccess.set({
      organizationId,
      userId: managerId,
      scopeType: "organization",
      scopeId: organizationId,
      permissionKeys: payroll.permissions.map((p) => p.key),
      choice: "default",
    });
    await expect(manager.jp.payroll.runs({ siteId: siteA })).resolves.toBeTruthy();
  });

  it("Off for one site leaves the other site alone", async () => {
    await owner.jp.userAccess.set({
      organizationId,
      userId: managerId,
      scopeType: "site",
      scopeId: siteA,
      permissionKeys: ["payroll.view"],
      choice: "deny",
    });
    await expect(manager.jp.payroll.runs({ siteId: siteA })).rejects.toThrow();
    await expect(manager.jp.payroll.runs({ siteId: siteB })).resolves.toBeTruthy();
    const view = await owner.jp.userAccess.get({
      organizationId,
      userId: managerId,
      scopeType: "site",
      scopeId: siteA,
    });
    expect(view.overrides).toBe(1);
    // Company-level permissions are switched for all sites only.
    await expect(
      owner.jp.userAccess.set({
        organizationId,
        userId: managerId,
        scopeType: "site",
        scopeId: siteA,
        permissionKeys: ["crm.view"],
        choice: "deny",
      }),
    ).rejects.toThrow(/whole company/);
  });

  it("nobody changes their own access or someone above them; self-approval is not offered", async () => {
    await expect(
      director.jp.userAccess.get({
        organizationId,
        userId: ownerId,
        scopeType: "organization",
        scopeId: organizationId,
      }),
    ).rejects.toThrow(/your level/);
    const people = await owner.jp.accounts.list({ organizationId });
    const directorId = people.find((p) => p.username === "director")!.id;
    await expect(
      director.jp.userAccess.set({
        organizationId,
        userId: directorId,
        scopeType: "organization",
        scopeId: organizationId,
        permissionKeys: ["payroll.view"],
        choice: "allow",
      }),
    ).rejects.toThrow(/your own access/);
    await expect(
      manager.jp.userAccess.get({
        organizationId,
        userId: directorId,
        scopeType: "organization",
        scopeId: organizationId,
      }),
    ).rejects.toThrow();
    await expect(
      owner.jp.userAccess.set({
        organizationId,
        userId: managerId,
        scopeType: "organization",
        scopeId: organizationId,
        permissionKeys: ["approval.self"],
        choice: "allow",
      }),
    ).rejects.toThrow(/cannot be changed here/);
    const events = await owner.jp.workspace.auditEvents();
    expect(JSON.stringify(events)).toContain("access.set");
  });
});
