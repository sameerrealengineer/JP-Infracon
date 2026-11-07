import { expect, test, type Page } from "@playwright/test";
import { mockTrpc, type Outputs } from "./trpc-mock";

// Safety/quality issue reporting, detail actions by role, and CSV export.

type Site = Outputs["jp"]["workspace"]["mySites"][number];
type Capability = Outputs["jp"]["workspace"]["myCapabilities"][number];
type IssueDetail = Outputs["jp"]["issues"]["detail"];

const ORG = "33333333-3333-4333-8333-333333333333";
const SITE = "11111111-1111-4111-8111-111111111111";
const ISSUE = "77777777-7777-4777-8777-777777777777";

const site: Site = {
  id: SITE,
  name: "Balugaon Pump House",
  code: "BALUGAON",
  location: "Khurda, Odisha",
  status: "Active",
  organizationId: ORG,
  projectId: "44444444-4444-4444-8444-444444444444",
  project: "Khurda Rural Water Supply",
  businessRole: "supervisor",
  organizationRole: "supervisor",
};

function caps(keys: string[]) {
  return Object.fromEntries([
    ["siteId", SITE],
    ...keys.map((key) => [key, true]),
  ]) as unknown as Capability;
}

function detail(
  manage: boolean,
  close: boolean,
  status: IssueDetail["issue"]["status"],
): IssueDetail {
  return {
    issue: {
      id: ISSUE,
      organizationId: ORG,
      siteId: SITE,
      issueCode: "BALUGAON-261102-001",
      category: "Safety Hazard",
      severity: "Critical",
      title: "Trench edge not barricaded",
      description: "1.8 m deep trench at chainage 2+350 has no edge protection.",
      locationLabel: "Chainage 2+350",
      immediateAction: "Area cordoned with tape",
      stopWork: "Yes",
      observedAt: new Date("2026-11-02T04:30:00.000Z"),
      status,
      ownerUserId: null,
      ownerNameSnapshot: null,
      targetDate: null,
      correctiveAction: null,
      preventiveAction: null,
      closureNote: null,
      raisedBy: 12,
      resolvedBy: null,
      resolvedAt: null,
      closedBy: null,
      closedAt: null,
      reopenCount: 0,
      recordVersion: 1,
      clientMutationId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      createdAt: new Date("2026-11-02T04:31:00.000Z"),
      updatedAt: new Date("2026-11-02T04:31:00.000Z"),
      siteName: site.name,
      projectName: site.project,
      raisedByName: "Sipun Behera",
      resolvedByName: null,
      closedByName: null,
    },
    events: [
      {
        id: "e1",
        eventType: "Raised",
        fromStatus: null,
        toStatus: "Open",
        note: "Area cordoned with tape",
        actorName: "Sipun Behera",
        createdAt: new Date("2026-11-02T04:31:00.000Z"),
      },
    ],
    permissions: { manage, close, comment: true },
    me: 12,
  };
}

async function setup(page: Page, keys: string[], manage: boolean, close: boolean) {
  const created: unknown[] = [];
  const transitions: unknown[] = [];
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
    "jp.workspace.mySites": () => [site],
    "jp.workspace.myCapabilities": () => [caps(keys)],
    "jp.workspace.inbox": () => ({ asOf: new Date().toISOString(), unavailable: [], items: [] }),
    "jp.issues.list": () => ({
      rows: [
        {
          id: ISSUE,
          siteId: SITE,
          siteName: site.name,
          issueCode: "BALUGAON-261102-001",
          category: "Safety Hazard",
          severity: "Critical",
          title: "Trench edge not barricaded",
          status: "Open",
          stopWork: "Yes",
          ownerName: null,
          targetDate: null,
          observedAt: new Date("2026-11-02T04:30:00.000Z"),
          updatedAt: new Date("2026-11-02T04:31:00.000Z"),
        },
      ],
      total: 1,
      counts: { open: 1, critical: 1, stopWork: 1 },
    }),
    "jp.issues.detail": () => detail(manage, close, "Open"),
    "jp.issues.create": (input) => {
      created.push(input);
      return { id: ISSUE, issueCode: "BALUGAON-261102-002" };
    },
    "jp.issues.transition": (input) => {
      transitions.push(input);
      return { id: ISSUE, status: "In Progress" };
    },
    "jp.attachments.list": () => [],
    "jp.exports.options": () => [
      { kind: "issues", label: "Safety & quality issues", siteIds: [SITE] },
      { kind: "daily_reports", label: "Daily reports (DPR/DLR)", siteIds: [SITE] },
    ],
    "jp.exports.generate": () => ({
      fileName: "jp-infracon-issues-2026-11-02-09-05.csv",
      csv: "﻿# Report,Safety & quality issues\r\n",
      rowCount: 1,
      truncated: false,
      generatedAt: new Date().toISOString(),
    }),
  });
  return { created, transitions };
}

test.describe("Site issues", () => {
  test("a supervisor reports a critical hazard with stop work", async ({ page }) => {
    const { created } = await setup(
      page,
      ["site.view", "issue.view", "issue.create", "issue.manage"],
      true,
      false,
    );
    await page.goto("/issues");
    await expect(page.getByText("Trench edge not barricaded")).toBeVisible();
    await expect(page.getByText("STOP WORK").first()).toBeVisible();
    await page.screenshot({ path: "test-results/issues-list.png", fullPage: true });

    await page.getByRole("button", { name: "Report issue" }).last().click();
    await page.getByRole("radio", { name: "Safety Hazard" }).click();
    await page.getByRole("radio", { name: "Critical" }).click();
    await page.getByLabel("Short title").fill("Live cable near excavator");
    await page.getByLabel("What did you see?").fill("Exposed 11 kV cable 2 m from bucket swing.");
    await page.getByRole("checkbox").click();
    await page.screenshot({ path: "test-results/issue-form.png" });
    await page.getByRole("button", { name: "Report issue" }).last().click();
    await expect.poll(() => created.length).toBe(1);
    expect(created[0]).toMatchObject({
      siteId: SITE,
      category: "Safety Hazard",
      severity: "Critical",
      stopWork: true,
    });
  });

  test("a site worker can start an issue but not verify or close it", async ({ page }) => {
    const { transitions } = await setup(
      page,
      ["site.view", "issue.view", "issue.create", "issue.manage"],
      true,
      false,
    );
    await page.goto(`/issue/${ISSUE}`);
    await expect(page.getByText("1.8 m deep trench")).toBeVisible();
    await expect(page.getByRole("button", { name: "Verify & close" })).toHaveCount(0);
    await page.screenshot({ path: "test-results/issue-detail.png", fullPage: true });
    await page.getByRole("button", { name: "Start work" }).first().click();
    await page.getByRole("button", { name: "Start work" }).last().click();
    await expect.poll(() => transitions.length).toBe(1);
    expect(transitions[0]).toMatchObject({ issueId: ISSUE, action: "start" });
  });

  test("a viewer gets no actions", async ({ page }) => {
    await setup(page, ["site.view", "issue.view"], false, false);
    await page.goto(`/issue/${ISSUE}`);
    await expect(page.getByText("1.8 m deep trench")).toBeVisible();
    await expect(page.getByRole("button", { name: "Start work" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Report issue" })).toHaveCount(0);
  });
});

test("exports list only permitted data and download a CSV", async ({ page }) => {
  await setup(page, ["site.view", "issue.view"], false, false);
  await page.goto("/exports");
  await expect(page.getByRole("radio", { name: "Safety & quality issues" })).toBeVisible();
  await expect(page.getByRole("radio", { name: "Supplier invoices" })).toHaveCount(0);
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "Create CSV" }).click();
  expect((await download).suggestedFilename()).toBe("jp-infracon-issues-2026-11-02-09-05.csv");
  await expect(page.getByText("1 rows")).toBeVisible();
  await page.screenshot({ path: "test-results/exports.png", fullPage: true });
});
