import { expect, test, type Page } from "@playwright/test";
import { mockTrpc, type Outputs } from "./trpc-mock";

// Home: modules appear only when the server's capabilities allow them, every tile opens its
// screen, and a site with a cover photo shows it on its card.

type Capability = Outputs["jp"]["workspace"]["myCapabilities"][number];
const SITE_A = "11111111-1111-4111-8111-111111111111";
const SITE_B = "22222222-2222-4222-8222-222222222222";
const ORG = "33333333-3333-4333-8333-333333333333";
const PROJECT = "44444444-4444-4444-8444-444444444444";
const PHOTO =
  "data:image/svg+xml;base64," +
  Buffer.from(
    '<svg xmlns="http://www.w3.org/2000/svg" width="40" height="30"><rect width="40" height="30" fill="#c87533"/></svg>',
  ).toString("base64");

async function setup(page: Page, keys: string[]) {
  await mockTrpc(page, {
    "auth.me": () =>
      ({
        id: 12,
        name: "Sipun Behera",
        email: null,
        loginMethod: "password",
        accountStatus: "Active",
        platformOwner: false,
        platformRole: "user",
        mustChangePassword: false,
        lastSignedIn: new Date(),
      }) as Outputs["auth"]["me"],
    "jp.workspace.onboardingState": () => ({
      hasOrganizationMembership: true,
      businessRole: "supervisor",
      roles: ["supervisor"],
      canInitializeOrganization: false,
      canManageSites: false,
      canManageAccounts: false,
    }),
    "jp.workspace.mySites": () =>
      [SITE_A, SITE_B].map((id) => ({
        id,
        name: id === SITE_A ? "Balugaon Pump House" : "Tangi Elevated Reservoir",
        code: id === SITE_A ? "BALUGAON" : "TANGI",
        location: "Khurda",
        status: "Active",
        organizationId: ORG,
        projectId: PROJECT,
        project: "Khurda Rural Water Supply",
        businessRole: "supervisor",
      })),
    "jp.workspace.myCapabilities": () =>
      [SITE_A, SITE_B].map(
        (id) =>
          Object.fromEntries([
            ["siteId", id],
            ...keys.map((key) => [key, true]),
          ]) as unknown as Capability,
      ),
    "jp.workspace.inbox": () => ({
      asOf: new Date().toISOString(),
      unavailable: [],
      items: [
        {
          id: "report-review-1",
          kind: "report.review",
          title: "DPR awaiting your review",
          detail: "Pump house slab · 2026-11-03",
          siteId: SITE_A,
          siteName: "Balugaon Pump House",
          occurredAt: new Date().toISOString(),
          route: "/(tabs)/reports",
          severity: "normal",
        },
      ],
    }),
    "jp.workspace.dashboard": () => ({
      siteCount: 2,
      reportsNeedingReview: 1,
      reportsReturned: 0,
      pendingMaterialRequests: 0,
      asOf: new Date().toISOString(),
    }),
    "jp.places.cards": () => ({
      today: "2026-11-03",
      projects: [],
      sites: [
        {
          siteId: SITE_A,
          projectId: PROJECT,
          coverUrl: PHOTO,
          progress: {
            actualTenths: 420,
            expectedTenths: 500,
            total: 8,
            completed: 3,
            inProgress: 2,
            overdue: 1,
            blocked: 0,
            health: "behind",
          },
        },
        {
          siteId: SITE_B,
          projectId: PROJECT,
          coverUrl: null,
          progress: {
            actualTenths: null,
            expectedTenths: null,
            total: 0,
            completed: 0,
            inProgress: 0,
            overdue: 0,
            blocked: 0,
            health: null,
          },
        },
      ],
    }),
    "jp.delegation.mine": () => [],
    "jp.assistant.status": () => ({ available: true, voice: true, speech: true }),
  });
}

test("shows only permitted modules, with badges and site photos", async ({ page }) => {
  await setup(page, ["site.view", "dpr.view", "dpr.create", "dpr.review", "attendance.mark"]);
  await page.goto("/");
  await expect(page.getByText("Balugaon Pump House").first()).toBeVisible();
  await expect(page.getByRole("button", { name: "Daily report" }).first()).toBeVisible();
  await expect(page.getByRole("button", { name: "Attendance" }).first()).toBeVisible();
  // Not permitted (or turned off for the company): not offered at all.
  await expect(page.getByRole("button", { name: "Finance" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Stock" })).toHaveCount(0);
  await expect(page.getByRole("img", { name: "Photo of Balugaon Pump House" })).toBeVisible();
  await expect(page.getByText("1 overdue")).toBeVisible();
  await expect(page.getByText("No schedule progress yet")).toBeVisible();
  await page.screenshot({ path: "test-results/home-screen.png", fullPage: true });
});

test("a module tile opens its screen and a site card opens the site", async ({ page }) => {
  await setup(page, ["site.view", "dpr.view", "dpr.create", "attendance.mark"]);
  await page.goto("/");
  await page.getByRole("button", { name: "Attendance" }).first().click();
  await expect(page).toHaveURL(/\/attendance/);
  await page.goto("/");
  await page.getByRole("button", { name: "Open Tangi Elevated Reservoir" }).click();
  await expect(page).toHaveURL(new RegExp(`/site/${SITE_B}`));
});
