import { expect, test, type Page } from "@playwright/test";
import { mockTrpc, type Outputs } from "./trpc-mock";

// Daily attendance marking by a supervisor and approval by a project manager.

type Capability = Outputs["jp"]["workspace"]["myCapabilities"][number];
const SITE = "11111111-1111-4111-8111-111111111111";
const ENG_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1";
const ENG_B = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2";

async function setup(page: Page, role: "supervisor" | "project_manager", marked: boolean) {
  const keys =
    role === "supervisor"
      ? ["site.view", "attendance.view", "attendance.mark"]
      : [
          "site.view",
          "attendance.view",
          "attendance.mark",
          "attendance.approve",
          "compensation.view",
        ];
  const calls: { mark: unknown[]; approve: unknown[] } = { mark: [], approve: [] };
  const record = (approved: boolean) => ({
    id: "r1",
    engagementId: ENG_A,
    status: "Full Day" as const,
    regularHours: "8",
    overtimeHours: "2",
    overtimeApprovalStatus: "Pending" as const,
    markedBy: 12,
    markedByName: "Sipun Behera",
    reviewedBy: approved ? 7 : null,
    updatedAt: new Date(),
    approved,
  });
  await mockTrpc(page, {
    "auth.me": () =>
      ({
        id: role === "supervisor" ? 12 : 7,
        name: role === "supervisor" ? "Sipun Behera" : "Ravi Mohanty",
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
      businessRole: role,
      roles: [role],
      canInitializeOrganization: false,
      canManageSites: false,
      canManageAccounts: false,
    }),
    "jp.workspace.mySites": () => [
      {
        id: SITE,
        name: "Balugaon Pump House",
        code: "BALUGAON",
        location: null,
        status: "Active",
        organizationId: "33333333-3333-4333-8333-333333333333",
        projectId: "44444444-4444-4444-8444-444444444444",
        project: "Khurda Rural Water Supply",
        businessRole: role,
      },
    ],
    "jp.workspace.myCapabilities": () => [
      Object.fromEntries([
        ["siteId", SITE],
        ...keys.map((key) => [key, true]),
      ]) as unknown as Capability,
    ],
    "jp.workspace.inbox": () => ({ asOf: new Date().toISOString(), unavailable: [], items: [] }),
    "jp.attendance.roster": () => ({
      siteName: "Balugaon Pump House",
      me: role === "supervisor" ? 12 : 7,
      rows: [
        {
          engagementId: ENG_A,
          name: "Bikash Nayak",
          trade: "Mason",
          engagementType: "Daily wage",
          rateType: null,
          rateMinor: null,
          record: marked ? record(false) : null,
        },
        {
          engagementId: ENG_B,
          name: "Laxmi Sahu",
          trade: "Helper",
          engagementType: "Daily wage",
          rateType: null,
          rateMinor: null,
          record: null,
        },
      ],
    }),
    "jp.attendance.mark": (input) => {
      calls.mark.push(input);
      return { saved: 2, locked: 0 };
    },
    "jp.attendance.approve": (input) => {
      calls.approve.push(input);
      return { approved: 1, skippedOwn: 0 };
    },
    "jp.attendance.labourSummary": () => ({
      siteName: "Balugaon Pump House",
      from: "2026-11-01",
      to: "2026-11-02",
      totals: { approvedMinor: "75000", pendingMinor: "60000", records: 2 },
      workers: [],
    }),
  });
  return calls;
}

test("a supervisor marks attendance but cannot approve it", async ({ page }) => {
  const calls = await setup(page, "supervisor", false);
  await page.goto("/attendance");
  await expect(page.getByText("Bikash Nayak")).toBeVisible();
  await page.getByRole("radio", { name: "Laxmi Sahu Half Day" }).click();
  await expect(page.getByRole("button", { name: /Approve/ })).toHaveCount(0);
  await page.screenshot({ path: "test-results/attendance.png", fullPage: true });
  await page.getByRole("button", { name: "Save attendance (2)" }).click();
  await expect.poll(() => calls.mark.length).toBe(1);
  expect(calls.mark[0]).toMatchObject({
    entries: [
      { engagementId: ENG_A, status: "Full Day", regularHours: "8" },
      { engagementId: ENG_B, status: "Half Day", regularHours: "4" },
    ],
  });
  await expect(page.getByText("Saved 2 workers.")).toBeVisible();
});

test("a project manager approves the day including overtime", async ({ page }) => {
  const calls = await setup(page, "project_manager", true);
  await page.goto("/attendance");
  await expect(page.getByText("Bikash Nayak")).toBeVisible();
  await page.getByRole("button", { name: "Approve with overtime" }).click();
  await expect.poll(() => calls.approve.length).toBe(1);
  expect(calls.approve[0]).toMatchObject({ overtime: "approve" });
  await page.getByRole("radio", { name: "Labour cost" }).click();
  await expect(page.getByText("Approved earnings")).toBeVisible();
});
