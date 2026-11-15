import { beforeAll, describe, expect, it, vi } from "vitest";

// Product-grade access over the demo SQLite database, through the real procedures:
// project teams (whole-project scope, also sites added later), approval limits (delegation of
// authority) enforced on approval, the role matrix, my access, access review, sign-out everywhere.
vi.mock("../../server/db", () => import("./server/db"));
vi.mock("../../server/_core/sdk", () => import("./server/sdk"));
vi.mock("../../server/storage", () => import("./server/storage"));

const { setDemoDriver } = await import("./runtime");
const { createNodeDriver } = await import("./testing/node-driver");
const { ensureDemoData } = await import("./backend");
const { signIn, mutationId } = await import("./seed");

type Caller = Awaited<ReturnType<typeof signIn>>;
let owner: Caller, director: Caller, manager: Caller, supervisor: Caller, auditor: Caller;
let organizationId = "";
let siteId = "";
let otherProjectId = "";
let supervisorUserId = 0;

async function submittedPo(totalRupees: string) {
  const options = await manager.jp.purchase.options({ siteId });
  const vendorId = options.vendors[0]!.id;
  const created = await manager.jp.purchase.create({
    siteId,
    vendorId,
    orderDate: "2026-11-02",
    expectedDate: "2026-11-06",
    lines: [
      {
        description: "Sand",
        unitCode: "lot",
        quantity: "1",
        rateRupees: totalRupees,
        gstPercent: "0",
      },
    ],
    quotes: [],
    clientMutationId: mutationId(),
  });
  await manager.jp.purchase.transition({
    siteId,
    poId: created.id,
    action: "submit",
    clientMutationId: mutationId(),
  });
  return created.id;
}

describe("product-grade access", () => {
  beforeAll(async () => {
    await setDemoDriver(createNodeDriver());
    await ensureDemoData();
    [owner, director, manager, supervisor, auditor] = await Promise.all(
      ["owner", "director", "manager", "supervisor", "auditor"].map(signIn),
    );
    const [company] = await owner.jp.accounts.options();
    organizationId = company!.id;
    const all = await owner.jp.workspace.mySites();
    siteId = all.find((site) => site.code === "PATIA-A")!.id;
    const project = await owner.jp.sitesAdmin.createProject({
      organizationId,
      projectCode: "RBAC-P",
      name: "Second project",
      clientMutationId: mutationId(),
    });
    otherProjectId = project.id;
    await owner.jp.sitesAdmin.createSite({
      projectId: otherProjectId,
      siteCode: "RBAC-S1",
      name: "First site of the second project",
      clientMutationId: mutationId(),
    });
    const people = await owner.jp.accounts.list({ organizationId });
    supervisorUserId = people.find((row) => row.username === "supervisor")!.id;
  }, 120_000);

  it("a project assignment opens every site of the project, also one added later; removing ends it", async () => {
    expect(otherProjectId).not.toBe("");
    const before = await supervisor.jp.workspace.mySites();
    expect(before.some((site) => site.projectId === otherProjectId)).toBe(false);
    await expect(supervisor.jp.projectTeam.list({ projectId: otherProjectId })).rejects.toThrow(
      /outside your access/,
    );

    await owner.jp.projectTeam.assign({
      projectId: otherProjectId,
      userId: supervisorUserId,
      role: "supervisor",
    });
    const projectSites = (await owner.jp.workspace.mySites()).filter(
      (site) => site.projectId === otherProjectId,
    );
    const after = await supervisor.jp.workspace.mySites();
    for (const site of projectSites) expect(after.some((row) => row.id === site.id)).toBe(true);

    const added = await owner.jp.sitesAdmin.createSite({
      projectId: otherProjectId,
      siteCode: "LATER-1",
      name: "Site added later",
      clientMutationId: mutationId(),
    });
    expect((await supervisor.jp.workspace.mySites()).some((s) => s.id === added.id)).toBe(true);

    const team = await owner.jp.projectTeam.list({ projectId: otherProjectId });
    expect(team.canManage).toBe(true);
    expect(team.members.some((m) => m.userId === supervisorUserId)).toBe(true);
    // A supervisor cannot change the project team.
    const seen = await supervisor.jp.projectTeam.list({ projectId: otherProjectId });
    expect(seen.canManage).toBe(false);

    await owner.jp.projectTeam.remove({
      projectId: otherProjectId,
      userId: supervisorUserId,
      reason: "Back to own site only",
    });
    const final = await supervisor.jp.workspace.mySites();
    expect(final.some((site) => site.projectId === otherProjectId)).toBe(false);
  });

  it("an approval limit stops an approval above it; the Owner is never limited; no limit means unchanged", async () => {
    await owner.jp.approvalLimits.set({
      organizationId,
      role: "director",
      area: "purchase_order",
      limitRupees: 1000,
    });
    const list = await director.jp.approvalLimits.list({ organizationId });
    expect(list.roles.find((r) => r.role === "director")!.limits.purchase_order).toBe("100000");
    // A director cannot set their own ceiling.
    await expect(
      director.jp.approvalLimits.set({
        organizationId,
        role: "director",
        area: "purchase_order",
        limitRupees: null,
      }),
    ).rejects.toThrow();

    const big = await submittedPo("5000");
    await expect(
      director.jp.purchase.transition({
        siteId,
        poId: big,
        action: "approve",
        clientMutationId: mutationId(),
      }),
    ).rejects.toThrow(/approval limit/);
    await owner.jp.purchase.transition({
      siteId,
      poId: big,
      action: "approve",
      clientMutationId: mutationId(),
    });
    expect((await owner.jp.purchase.detail({ siteId, poId: big })).order.status).toBe("Approved");

    const small = await submittedPo("800");
    await director.jp.purchase.transition({
      siteId,
      poId: small,
      action: "approve",
      clientMutationId: mutationId(),
    });

    await owner.jp.approvalLimits.set({
      organizationId,
      role: "director",
      area: "purchase_order",
      limitRupees: null,
    });
    const again = await submittedPo("5000");
    await director.jp.purchase.transition({
      siteId,
      poId: again,
      action: "approve",
      clientMutationId: mutationId(),
    });
    expect((await owner.jp.purchase.detail({ siteId, poId: again })).order.status).toBe("Approved");
  });

  it("the role matrix comes from the server rules", async () => {
    const matrix = await auditor.jp.accessReview.matrix();
    const actions = matrix.modules.flatMap((module) => module.actions);
    const approve = actions.find((action) => action.key === "purchase.approve")!;
    expect(approve.allowed.owner).toBe(true);
    expect(approve.allowed.auditor).toBe(false);
  });

  it("my access lists my sites and role", async () => {
    const mine = await supervisor.jp.accessReview.mine();
    expect(mine.sites.length).toBeGreaterThan(0);
    expect(mine.sites.every((site) => site.actions > 0)).toBe(true);
    expect(mine.companyRoles.some((row) => row.role === "supervisor")).toBe(true);
  });

  it("access review is for leaders, exports CSV with an audit row", async () => {
    await expect(
      supervisor.jp.accessReview.review({ organizationId, format: "rows" }),
    ).rejects.toThrow();
    const rows = await owner.jp.accessReview.review({ organizationId, format: "rows" });
    expect(rows.rows.some((row) => row.username === "supervisor")).toBe(true);
    const csv = await owner.jp.accessReview.review({ organizationId, format: "csv" });
    expect(csv.csv).toContain("Access review");
    expect(csv.csv).toContain("supervisor");
  });

  it("a leader signs a person out everywhere; a lower role cannot sign out a higher one", async () => {
    const people = await owner.jp.accounts.list({ organizationId });
    const directorId = people.find((row) => row.username === "director")!.id;
    await expect(
      supervisor.jp.accessReview.endSessions({ organizationId, userId: directorId }),
    ).rejects.toThrow();
    const auditorId = people.find((row) => row.username === "auditor")!.id;
    await owner.jp.accessReview.endSessions({ organizationId, userId: auditorId });
    const fresh = await signIn("auditor");
    expect((await fresh.jp.accessReview.mine()).companyRoles.length).toBeGreaterThan(0);
  });
});
