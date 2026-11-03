import { expect, test, type Page } from "@playwright/test";
import { mockTrpc, type Outputs } from "./trpc-mock";

// The AI assistant, the profile screen and company module switches.

type Capability = Outputs["jp"]["workspace"]["myCapabilities"][number];
const SITE = "11111111-1111-4111-8111-111111111111";

async function setup(page: Page) {
  const asked: unknown[] = [];
  const updates: unknown[] = [];
  const moduleSaves: unknown[] = [];
  await mockTrpc(page, {
    "auth.me": () =>
      ({
        id: 7,
        name: "Ravi Mohanty",
        email: "ravi@example.com",
        loginMethod: "password",
        accountStatus: "Active",
        platformOwner: false,
        platformRole: "user",
        mustChangePassword: false,
        lastSignedIn: new Date(),
      }) as Outputs["auth"]["me"],
    "jp.workspace.onboardingState": () => ({
      hasOrganizationMembership: true,
      businessRole: "owner",
      roles: ["owner"],
      canInitializeOrganization: false,
      canManageSites: true,
      canManageAccounts: true,
    }),
    "jp.workspace.myCapabilities": () => [
      Object.fromEntries([
        ["siteId", SITE],
        ...["site.view", "dpr.view", "dpr.create"].map((key) => [key, true]),
      ]) as unknown as Capability,
    ],
    "jp.workspace.mySites": () =>
      [
        {
          id: SITE,
          name: "Pakalapoli Site",
          code: "PKL",
          project: "Govt Building",
          projectId: "44444444-4444-4444-8444-444444444444",
          organizationId: "33333333-3333-4333-8333-333333333333",
          status: "Active",
          businessRole: "owner",
          location: null,
        },
      ] as unknown as Outputs["jp"]["workspace"]["mySites"],
    "jp.workspace.inbox": () => ({ asOf: new Date().toISOString(), unavailable: [], items: [] }),
    "jp.assistant.status": () => ({ available: true, voice: false, speech: false }),
    "jp.assistant.ask": (input) => {
      asked.push(input);
      return {
        reply: "Theek hai. Report ka draft khol raha hoon; aap check karke save karein.",
        action: {
          type: "draft_report" as const,
          reportKind: "DPR" as const,
          siteId: SITE,
          text: "120 sqft plaster",
          route: `/report-editor?siteId=${SITE}&kind=DPR&aiText=120%20sqft%20plaster`,
          label: "Open the progress report draft",
        },
      };
    },
    "jp.profile.me": () => ({
      id: 7,
      name: "Ravi Mohanty",
      email: "ravi@example.com",
      phone: "+919876543210",
      designation: "Site Engineer",
      department: null,
      addressLine: "Plot 12",
      city: "Pakalapoli",
      district: "Khurda",
      state: "Odisha",
      pincode: "752055",
      emergencyContact: null,
      address: "Plot 12, Pakalapoli, Khurda, Odisha 752055",
      role: "owner" as const,
      organizationName: "JP Infracon",
      siteNames: ["Pakalapoli Site"],
      memberSince: new Date("2026-11-01T10:00:00.000Z"),
      lastSignedIn: new Date(),
      photoUrl: null,
      completeness: 67,
    }),
    "jp.profile.update": (input) => {
      updates.push(input);
      return { ok: true };
    },
    "jp.notifications.preferences": () => ({
      phone: "+919876543210",
      whatsappOptIn: false,
      smsOptIn: false,
      pushOptIn: true,
      channels: { whatsapp: null, sms: null, push: "expo" as const },
    }),
    "jp.modules.settings": () => ({
      canManage: true,
      companyName: "JP Infracon",
      modules: [
        {
          key: "reports",
          title: "Daily reports (DPR / DLR)",
          detail: "Daily reports",
          enabled: true,
          actionsLast30Days: 42,
        },
        {
          key: "inventory",
          title: "Inventory",
          detail: "Stock",
          enabled: true,
          actionsLast30Days: 0,
        },
      ],
    }),
    "jp.modules.suggest": () => ({
      source: "ai" as const,
      summary: "You do not keep a store yet.",
      turnOn: [],
      turnOff: ["inventory" as const],
      reasons: [{ module: "inventory" as const, reason: "No stock entries in 30 days." }],
    }),
    "jp.modules.update": (input) => {
      moduleSaves.push(input);
      return { disabled: ["inventory" as const] };
    },
  });
  return { asked, updates, moduleSaves };
}

test("the assistant answers and offers a draft that opens the report form", async ({ page }) => {
  const { asked } = await setup(page);
  await page.goto("/assistant");
  await page
    .getByRole("textbox", { name: "Message to assistant" })
    .fill("Aaj 120 sqft plaster hua, report bana do");
  await page.getByRole("button", { name: "Send" }).click();
  await expect(page.getByText(/Report ka draft khol raha hoon/)).toBeVisible();
  expect(asked[0]).toMatchObject({
    text: "Aaj 120 sqft plaster hua, report bana do",
    siteId: SITE,
  });
  await expect(page.getByText("Nothing is saved yet.", { exact: false })).toBeVisible();
  await page.screenshot({ path: "test-results/assistant.png", fullPage: true });
  await page.getByRole("button", { name: /Open the progress report draft/ }).click();
  await expect(page).toHaveURL(/report-editor/);
});

test("the profile shows the person's details and saves edits", async ({ page }) => {
  const { updates } = await setup(page);
  await page.goto("/profile");
  await expect(page.getByText("Plot 12, Pakalapoli, Khurda, Odisha 752055")).toBeVisible();
  await expect(page.getByText("Profile 67% complete")).toBeVisible();
  await page.screenshot({ path: "test-results/profile.png", fullPage: true });
  await page.getByText("Edit details").click();
  await page.getByRole("textbox", { name: "PIN code" }).fill("75205");
  await page.getByText("Save profile").click();
  await expect(page.getByText("PIN code is 6 digits.")).toBeVisible();
  await page.getByRole("textbox", { name: "PIN code" }).fill("752050");
  await page.getByRole("textbox", { name: "Department" }).fill("Civil");
  await page.getByText("Save profile").click();
  await expect.poll(() => updates.length).toBe(1);
  expect(updates[0]).toMatchObject({
    pincode: "752050",
    department: "Civil",
    designation: "Site Engineer",
  });
});

test("an admin applies an AI module suggestion and saves", async ({ page }) => {
  const { moduleSaves } = await setup(page);
  await page.goto("/modules");
  await expect(page.getByText("42 actions in the last 30 days")).toBeVisible();
  await page.getByText("Suggest modules").click();
  await expect(page.getByText("You do not keep a store yet.")).toBeVisible();
  await page.getByText("Use this suggestion").click();
  await expect(page.getByText("Will turn off")).toBeVisible();
  await page.screenshot({ path: "test-results/modules.png", fullPage: true });
  await page.getByText("Save modules").click();
  await expect.poll(() => moduleSaves.length).toBe(1);
  expect(moduleSaves[0]).toMatchObject({ disabled: ["inventory"] });
});
