import { expect, test, type Page } from "@playwright/test";
import { mockTrpc, type Outputs } from "./trpc-mock";

// A supervisor writes a DPR with a work line that continues yesterday's cumulative quantity.

type Capability = Outputs["jp"]["workspace"]["myCapabilities"][number];
const SITE = "11111111-1111-4111-8111-111111111111";
const TASK = "55555555-5555-4555-8555-555555555555";

async function setup(page: Page) {
  const created: unknown[] = [];
  const filled: unknown[] = [];
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
        businessRole: "supervisor",
      },
    ],
    "jp.workspace.myCapabilities": () => [
      Object.fromEntries([
        ["siteId", SITE],
        ...["site.view", "dpr.view", "dpr.create", "dpr.submit"].map((key) => [key, true]),
      ]) as unknown as Capability,
    ],
    "jp.workspace.inbox": () => ({ asOf: new Date().toISOString(), unavailable: [], items: [] }),
    "jp.reports.progressContext": () => ({
      tasks: [
        {
          id: TASK,
          taskCode: "T-001",
          title: "Internal plaster",
          locationLabel: "First floor",
          status: "In Progress" as const,
        },
      ],
      lastLines: [
        {
          taskId: TASK,
          description: "Internal plaster",
          locationLabel: "First floor",
          unitCode: "sqft",
          plannedQuantity: "1000.000",
          cumulativeQuantity: "400.000",
          reportDate: "2026-11-02",
        },
      ],
    }),
    "jp.reports.createDraft": (input) => {
      created.push(input);
      return { id: "66666666-6666-4666-8666-666666666666" } as never;
    },
    "jp.reports.list": () => [],
    "jp.ai.status": () => ({ billScan: false, voice: false, formFill: true }),
    "jp.ai.fillReport": (input) => {
      filled.push(input);
      return {
        title: "Plaster, first floor",
        weatherCode: "Rain" as const,
        overallStatus: "Delayed" as const,
        remarks: "Rain stopped work for two hours.",
        nextDayPlan: "",
        items: [
          {
            taskId: TASK,
            description: "Internal plaster",
            locationLabel: "",
            unitCode: "sqft",
            completedQuantityToday: "150",
            cumulativeQuantity: "",
            plannedQuantity: "",
            remarks: "",
          },
        ],
        warnings: [],
      };
    },
  });
  return Object.assign(created, { filled });
}

test("a work line continues from the last report and is saved with its quantities", async ({
  page,
}) => {
  const created = await setup(page);
  await page.goto(`/report-editor?siteId=${SITE}`);
  await expect(page.getByText("Daily progress report")).toBeVisible();

  await page.getByRole("textbox", { name: "Title" }).fill("Plaster, first floor");
  await page.getByText("Rain", { exact: true }).click();
  await page.getByText("Add work line").click();
  await page.getByText("T-001 · Internal plaster").click();
  await expect(page.getByText("Last report: 400")).toBeVisible();

  await page.getByRole("textbox", { name: "Done today" }).fill("150");
  await expect(page.getByRole("textbox", { name: "Done so far" })).toHaveValue("550");
  await expect(page.getByText("About 55.00% of the planned total (estimate)")).toBeVisible();
  await page.screenshot({ path: "test-results/dpr-editor.png", fullPage: true });

  await page.getByText("Save draft").click();
  await expect.poll(() => created.length).toBe(1);
  expect(created[0]).toMatchObject({
    siteId: SITE,
    reportKind: "DPR",
    title: "Plaster, first floor",
    weatherCode: "Rain",
    items: [
      {
        taskId: TASK,
        description: "Internal plaster",
        locationLabel: "First floor",
        unitCode: "sqft",
        plannedQuantity: "1000",
        completedQuantityToday: "150",
        cumulativeQuantity: "550",
      },
    ],
  });
});

test("a line beyond the planned total is stopped before saving", async ({ page }) => {
  const created = await setup(page);
  await page.goto(`/report-editor?siteId=${SITE}`);
  await page.getByRole("textbox", { name: "Title" }).fill("Plaster");
  await page.getByText("Add work line").click();
  await page.getByText("T-001 · Internal plaster").click();
  await page.getByRole("textbox", { name: "Done today" }).fill("700");
  await expect(page.getByText(/more than the planned quantity/).first()).toBeVisible();
  await page.getByText("Save draft").click();
  await page.waitForTimeout(300);
  expect(created).toHaveLength(0);
});

test("AI fills the report from a spoken summary and the person reviews it", async ({ page }) => {
  const created = await setup(page);
  await page.goto(`/report-editor?siteId=${SITE}`);
  await page
    .getByRole("textbox", { name: "Describe today's work in your own words" })
    .fill("aaj first floor pe 150 sqft plaster hua, baarish se 2 ghante kaam ruka");
  await page.getByText("Fill the form with AI").click();
  await expect(
    page.getByText("AI filled the form. Check every field before saving."),
  ).toBeVisible();
  expect(created.filled[0]).toMatchObject({ siteId: SITE, reportKind: "DPR" });
  await expect(page.getByRole("textbox", { name: "Title" })).toHaveValue("Plaster, first floor");
  await expect(page.getByRole("textbox", { name: "Done so far" })).toHaveValue("550");
  await expect(page.getByRole("textbox", { name: "Planned total" })).toHaveValue("1000");
  expect(created).toHaveLength(0);

  await page.getByText("Save draft").click();
  await expect.poll(() => created.length).toBe(1);
  expect(created[0]).toMatchObject({
    weatherCode: "Rain",
    overallStatus: "Delayed",
    remarks: "Rain stopped work for two hours.",
    items: [{ taskId: TASK, completedQuantityToday: "150", cumulativeQuantity: "550" }],
  });
});
