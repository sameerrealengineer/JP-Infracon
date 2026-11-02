import { expect, test, type Page } from "@playwright/test";
import { mockTrpc, type Outputs } from "./trpc-mock";

// A module opened for one site (from that site's page or an inbox item) shows that site,
// not whichever site happens to be first in the list.

type Capability = Outputs["jp"]["workspace"]["myCapabilities"][number];
const SITE_A = "11111111-1111-4111-8111-111111111111";
const SITE_B = "22222222-2222-4222-8222-222222222222";
const NAMES: Record<string, string> = {
  [SITE_A]: "Balugaon Pump House",
  [SITE_B]: "Tangi Elevated Reservoir",
};

async function setup(page: Page) {
  const rosterSites: string[] = [];
  const keys = ["site.view", "attendance.view", "attendance.mark"];
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
        name: NAMES[id],
        code: id === SITE_A ? "BALUGAON" : "TANGI",
        location: null,
        status: "Active",
        organizationId: "33333333-3333-4333-8333-333333333333",
        projectId: "44444444-4444-4444-8444-444444444444",
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
    "jp.workspace.inbox": () => ({ asOf: new Date().toISOString(), unavailable: [], items: [] }),
    "jp.attendance.roster": (input) => {
      const siteId = (input as { siteId: string }).siteId;
      rosterSites.push(siteId);
      return {
        siteName: NAMES[siteId],
        me: 12,
        rows: [
          {
            engagementId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1",
            name: siteId === SITE_B ? "Tangi Mason" : "Balugaon Mason",
            trade: "Mason",
            engagementType: "Daily wage",
            rateType: null,
            rateMinor: null,
            record: null,
          },
        ],
      };
    },
  });
  return rosterSites;
}

test("a module opened for the second site shows that site", async ({ page }) => {
  const rosterSites = await setup(page);
  await page.goto(`/attendance?siteId=${SITE_B}`);
  await expect(page.getByText("Tangi Mason")).toBeVisible();
  expect(rosterSites).not.toContain(SITE_A);
});

test("without a site in the link the first site is shown", async ({ page }) => {
  await setup(page);
  await page.goto("/attendance");
  await expect(page.getByText("Balugaon Mason")).toBeVisible();
});

test("an unknown site in the link falls back to a site the person can see", async ({ page }) => {
  await setup(page);
  await page.goto("/attendance?siteId=99999999-9999-4999-8999-999999999999");
  await expect(page.getByText("Balugaon Mason")).toBeVisible();
});
