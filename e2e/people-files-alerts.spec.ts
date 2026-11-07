import { expect, test, type Page } from "@playwright/test";
import { mockTrpc, type Outputs } from "./trpc-mock";

// Assistant file attachments, the people directory and company alert rules.

type Capability = Outputs["jp"]["workspace"]["myCapabilities"][number];
const SITE = "11111111-1111-4111-8111-111111111111";
const PERSON = "55555555-5555-4555-8555-555555555555";

async function setup(page: Page) {
  const asked: { files?: { name: string; base64: string }[]; text: string }[] = [];
  const feedback: unknown[] = [];
  const ruleSaves: { rules: { category: string; role: string; whatsapp: boolean }[] }[] = [];
  await mockTrpc(page, {
    "auth.me": () =>
      ({
        id: 7,
        name: "Ravi Mohanty",
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
      businessRole: "owner",
      roles: ["owner"],
      canInitializeOrganization: false,
      canManageSites: true,
      canManageAccounts: true,
    }),
    "jp.workspace.myCapabilities": () => [
      Object.fromEntries([
        ["siteId", SITE],
        ...["site.view", "workforce.view", "workforce.manage", "compensation.view"].map((key) => [
          key,
          true,
        ]),
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
      asked.push(input as (typeof asked)[number]);
      return { reply: "The sheet lists cement at ₹410 a bag.", action: { type: "none" as const } };
    },
    "jp.people.search": () => ({
      people: [
        {
          id: PERSON,
          fullName: "Ramesh Behera",
          personType: "worker" as const,
          skillCategory: "Skilled" as const,
          tradeType: "Mason",
          status: "Active" as const,
          averageRating: 4.5,
          defaults: 1,
        },
      ],
    }),
    "jp.people.history": () => ({
      person: {
        id: PERSON,
        fullName: "Ramesh Behera",
        personType: "worker" as const,
        skillCategory: "Skilled" as const,
        tradeType: "Mason",
        status: "Active" as const,
        kycStatus: null,
        phone: "+919876543210",
        createdAt: new Date("2026-09-01T00:00:00Z"),
      },
      contact: {
        addressLine: "Plot 12",
        city: "Bhubaneswar",
        district: "Khurda",
        pincode: "751024",
        alternatePhone: null,
        notes: null,
        vendorId: null,
      },
      canEdit: [SITE],
      sites: [
        {
          siteId: SITE,
          siteName: "Pakalapoli Site",
          rates: [
            {
              engagementType: "Daily wage",
              rateType: "daily" as const,
              rateMinor: "85000",
              effectiveFrom: "2026-10-01",
              effectiveTo: null,
              status: "Active" as const,
            },
          ],
          work: {
            siteId: SITE,
            daysPresent: 22,
            daysAbsent: 2,
            firstDate: "2026-10-01",
            lastDate: "2026-11-02",
            regularHundredths: "17600",
            overtimeHundredths: "0",
            estimatedEarningsMinor: "1870000",
            rowsWithoutRate: 0,
          },
        },
      ],
      feedback: [
        {
          id: "f1",
          siteId: SITE,
          kind: "Default" as const,
          rating: null,
          note: "Left the site for two days without notice",
          createdAt: new Date("2026-10-20T10:00:00Z"),
          recordedByName: "Demo Supervisor",
          siteName: "Pakalapoli Site",
        },
      ],
      feedbackSummary: {
        averageRating: 4.5,
        ratedCount: 2,
        counts: { Quality: 2, Default: 1, Safety: 0, Praise: 0, "Payment dispute": 0 },
      },
      firm: null,
    }),
    "jp.people.addFeedback": (input) => {
      feedback.push(input);
      return { id: "f2" };
    },
    "jp.notifications.preferences": () => ({
      phone: "+919876543210",
      whatsappOptIn: true,
      smsOptIn: false,
      pushOptIn: true,
      channels: { whatsapp: "openwa", sms: null, push: "expo" as const },
    }),
    "jp.notifications.myMutes": () => ({
      categories: [{ key: "reports", title: "Daily reports", detail: "Submitted" }],
      muted: [],
    }),
    "jp.notifications.alertRules": () => ({
      canManage: true,
      categories: [{ key: "reports", title: "Daily reports", detail: "Submitted" }],
      roles: ["supervisor"],
      rules: [
        {
          category: "reports" as const,
          role: "supervisor" as const,
          push: true,
          whatsapp: true,
          sms: true,
          detail: "full" as const,
        },
      ],
    }),
    "jp.notifications.saveAlertRules": (input) => {
      ruleSaves.push(input as (typeof ruleSaves)[number]);
      return { saved: 1 };
    },
    "jp.notifications.recentDeliveries": () => ({ rows: [] }),
    "jp.presence.myFences": () => [],
  });
  return { asked, feedback, ruleSaves };
}

test("a file attached to the assistant is sent with the question", async ({ page }) => {
  const { asked } = await setup(page);
  await page.goto("/assistant");
  await page.getByRole("button", { name: "Attach a file" }).click();
  const chooser = page.waitForEvent("filechooser");
  await page.getByText("PDF, drawing, Word, Excel").click();
  await (
    await chooser
  ).setFiles({
    name: "rates.csv",
    mimeType: "text/csv",
    buffer: Buffer.from("item,rate\ncement,410"),
  });
  await expect(page.getByText(/rates\.csv/).first()).toBeVisible();
  await page.getByLabel("Message to assistant").fill("What is the cement rate?");
  await page.getByRole("button", { name: "Send" }).click();
  await expect(page.getByText("The sheet lists cement at ₹410 a bag.")).toBeVisible();
  expect(asked[0].files?.[0].name).toBe("rates.csv");
  expect(Buffer.from(asked[0].files![0].base64, "base64").toString()).toContain("cement,410");
});

test("people directory opens a profile with work, pay and defaults", async ({ page }) => {
  const { feedback } = await setup(page);
  await page.goto("/people");
  await page.getByRole("button", { name: "Open Ramesh Behera" }).click();
  await expect(page.getByText("Estimated earnings ₹18,700.00")).toBeVisible();
  await expect(page.getByText("Left the site for two days without notice")).toBeVisible();
  await expect(page.getByText("Plot 12, Bhubaneswar, Khurda, 751024")).toBeVisible();
  await page.getByText("Add", { exact: true }).click();
  await page.getByRole("radio", { name: "5 stars" }).click();
  await page.getByLabel("What happened").fill("Very neat plaster on level 2");
  await page.getByRole("button", { name: "Save entry" }).click();
  await expect.poll(() => feedback.length).toBe(1);
  expect(feedback[0]).toMatchObject({ kind: "Quality", rating: 5, siteId: SITE });
});

test("an admin turns off WhatsApp for a role in company alert rules", async ({ page }) => {
  const { ruleSaves } = await setup(page);
  await page.goto("/alert-settings");
  await page.getByRole("button", { name: /Daily reports/ }).click();
  await page.getByRole("switch", { name: "Daily reports, Supervisor: whatsapp" }).click();
  await page.getByRole("button", { name: "Save company rules" }).click();
  await expect.poll(() => ruleSaves.length).toBe(1);
  expect(ruleSaves[0].rules[0]).toMatchObject({ role: "supervisor", whatsapp: false });
});
