import { expect, test, type Page } from "@playwright/test";
import { mockTrpc, type Outputs } from "./trpc-mock";

// Role-aware home, site list → site detail, and project/site administration.
// Screenshots go to test-results/ for visual review.

type Site = Outputs["jp"]["workspace"]["mySites"][number];
type Capability = Outputs["jp"]["workspace"]["myCapabilities"][number];

const ORG = "33333333-3333-4333-8333-333333333333";
const PROJECT = "44444444-4444-4444-8444-444444444444";
const SITE_A = "11111111-1111-4111-8111-111111111111";
const SITE_B = "22222222-2222-4222-8222-222222222222";

function me(name: string, platformOwner = false): Outputs["auth"]["me"] {
  return {
    id: 7,
    name,
    email: null,
    loginMethod: "password",
    accountStatus: "Active",
    platformOwner,
    platformRole: platformOwner ? "super_admin" : "user",
    mustChangePassword: false,
    lastSignedIn: new Date("2026-11-01T08:30:00.000Z"),
  } as Outputs["auth"]["me"];
}

function site(
  id: string,
  name: string,
  role: Site["businessRole"],
  status: Site["status"] = "Active",
): Site {
  return {
    id,
    name,
    code: name.toUpperCase().replace(/\W/g, "").slice(0, 8),
    location: "Khurda, Odisha",
    status,
    organizationId: ORG,
    projectId: PROJECT,
    project: "Khurda Rural Water Supply",
    businessRole: role,
    organizationRole: role,
  };
}

function caps(siteId: string, keys: string[]) {
  return Object.fromEntries([
    ["siteId", siteId],
    ...keys.map((key) => [key, true]),
  ]) as unknown as Capability;
}

const adminKeys = [
  "site.view",
  "site.manage",
  "dpr.view",
  "dpr.create",
  "material.request.view",
  "material.request",
  "task.view",
  "inventory.view",
  "finance.invoice.view",
  "audit.view",
];
const supervisorKeys = [
  "site.view",
  "dpr.view",
  "dpr.create",
  "material.request.view",
  "material.request",
  "task.view",
];

const inbox: Outputs["jp"]["workspace"]["inbox"] = {
  unavailable: [],
  asOf: new Date("2026-11-02T09:00:00.000Z").toISOString(),
  items: [
    {
      id: "task-1",
      kind: "task.overdue",
      title: "Task past its planned finish",
      detail: "T-014 · Pipe laying chainage 2+400 · due 2026-10-30",
      siteId: SITE_A,
      siteName: "Balugaon Pump House",
      occurredAt: "2026-10-30T00:00:00.000Z",
      route: "/schedule",
      severity: "high",
    },
    {
      id: "material-1",
      kind: "material.review",
      title: "Material request awaiting decision",
      detail: "OPC cement for thrust blocks",
      siteId: SITE_B,
      siteName: "Tangi Elevated Reservoir",
      occurredAt: "2026-11-01T10:00:00.000Z",
      route: "/(tabs)/requests",
      severity: "normal",
    },
  ],
};

async function signIn(page: Page, role: "admin" | "supervisor") {
  const admin = role === "admin";
  const sites = admin
    ? [
        site(SITE_A, "Balugaon Pump House", "admin"),
        site(SITE_B, "Tangi Elevated Reservoir", "admin", "On Hold"),
      ]
    : [site(SITE_A, "Balugaon Pump House", "supervisor")];
  const created: unknown[] = [];
  await mockTrpc(page, {
    "auth.me": () => me(admin ? "Jeetendra Kumar Panda" : "Sipun Behera", false),
    "jp.workspace.onboardingState": () => ({
      hasOrganizationMembership: true,
      businessRole: admin ? "admin" : "supervisor",
      roles: [admin ? "admin" : "supervisor"],
      canInitializeOrganization: false,
      canManageSites: admin,
      canManageAccounts: admin,
    }),
    "jp.workspace.mySites": () => sites,
    "jp.workspace.myCapabilities": () =>
      sites.map((row) => caps(row.id, admin ? adminKeys : supervisorKeys)),
    "jp.workspace.dashboard": () => ({
      siteCount: sites.length,
      reportsNeedingReview: admin ? 3 : 0,
      reportsReturned: admin ? 0 : 1,
      pendingMaterialRequests: 2,
      asOf: new Date().toISOString(),
    }),
    "jp.workspace.inbox": () => (admin ? inbox : { asOf: inbox.asOf, unavailable: [], items: [] }),
    "jp.sitesAdmin.siteDetail": () => ({
      site: {
        id: SITE_A,
        code: "BALUGAON",
        name: "Balugaon Pump House",
        address: "Near NH-16 overbridge",
        village: "Balugaon",
        district: "Khurda",
        state: "Odisha",
        status: "Active",
        createdAt: new Date("2026-09-01T09:00:00.000Z"),
        updatedAt: new Date("2026-10-28T09:00:00.000Z"),
      },
      project: {
        id: PROJECT,
        code: "RWSS-KHD",
        name: "Khurda Rural Water Supply",
        clientDepartment: "RWSS Odisha",
        projectType: "Pipeline",
        startDate: "2026-08-01",
        targetEndDate: "2027-06-30",
        status: "Active",
      },
      myRole: admin ? "admin" : "supervisor",
      canManage: admin,
      team: [
        {
          assignmentId: "55555555-5555-4555-8555-555555555555",
          userId: 12,
          name: "Sipun Behera",
          role: "supervisor",
          since: new Date("2026-09-02T09:00:00.000Z"),
        },
      ],
      leaders: [{ userId: 7, name: "Jeetendra Kumar Panda", role: "admin" }],
    }),
    "jp.sitesAdmin.overview": () => [
      {
        id: ORG,
        name: "JP Infracon",
        code: "JPI",
        projects: [
          {
            id: PROJECT,
            code: "RWSS-KHD",
            name: "Khurda Rural Water Supply",
            clientDepartment: "RWSS Odisha",
            projectType: "Pipeline",
            startDate: "2026-08-01",
            targetEndDate: "2027-06-30",
            status: "Active",
            sites: sites.map((row) => ({
              id: row.id,
              code: row.code,
              name: row.name,
              status: row.status,
            })),
          },
        ],
      },
    ],
    "jp.sitesAdmin.createProject": (input) => {
      created.push(input);
      return { id: "66666666-6666-4666-8666-666666666666" };
    },
  });
  return { created };
}

test.describe("Role-aware shell and site management", () => {
  test("an admin sees the brief, quick actions and can open a site", async ({ page }) => {
    await signIn(page, "admin");
    await page.goto("/");
    await expect(page.getByText("Hello, Jeetendra")).toBeVisible();
    await expect(page.getByText("2 items need your attention")).toBeVisible();
    await expect(page.getByRole("button", { name: "Projects & sites" })).toBeVisible();
    await page.screenshot({ path: "test-results/home-admin.png", fullPage: true });

    await page.getByRole("button", { name: "Open Balugaon Pump House" }).first().click();
    await expect(page.getByText("Your role here · Contractor / Admin")).toBeVisible();
    await expect(page.getByRole("button", { name: "Edit details" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Remove Sipun Behera from site" })).toBeVisible();
    await page.screenshot({ path: "test-results/site-detail-admin.png", fullPage: true });
  });

  test("a supervisor gets no admin actions", async ({ page }) => {
    await signIn(page, "supervisor");
    await page.goto("/");
    await expect(page.getByText("Hello, Sipun")).toBeVisible();
    await expect(page.getByText("You are all caught up")).toBeVisible();
    await expect(page.getByRole("button", { name: "Daily report" }).first()).toBeVisible();
    await expect(page.getByRole("button", { name: "Projects & sites" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Team accounts" })).toHaveCount(0);
    await page.screenshot({ path: "test-results/home-supervisor.png", fullPage: true });

    await page.goto("/site/" + SITE_A);
    await expect(page.getByText("Sipun Behera")).toBeVisible();
    await expect(page.getByRole("button", { name: "Edit details" })).toHaveCount(0);
  });

  test("an admin creates a project from Projects & sites", async ({ page }) => {
    const { created } = await signIn(page, "admin");
    await page.goto("/projects");
    await expect(page.getByText("RWSS-KHD")).toBeVisible();
    await page.screenshot({ path: "test-results/projects.png", fullPage: true });
    await page.getByRole("button", { name: "New project" }).last().click();
    await page.getByLabel("Project code").fill("nh-16-bbsr");
    await page.getByLabel("Project name").fill("NH-16 Service Road");
    await page.screenshot({ path: "test-results/project-form.png" });
    await page.getByRole("button", { name: "Create project" }).click();
    await expect.poll(() => created.length).toBe(1);
    expect(created[0]).toMatchObject({
      organizationId: ORG,
      projectCode: "nh-16-bbsr",
      name: "NH-16 Service Road",
    });
  });
});
