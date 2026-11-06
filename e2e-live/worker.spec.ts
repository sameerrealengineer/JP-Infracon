import { expect, test, type Page } from "@playwright/test";

// Real app, real server rules, demo data: the mistri app (mobile + PIN), the khaata with an
// advance to approve, per-user access, and site GPS alert settings.

async function signIn(page: Page, username: string) {
  await page.context().clearCookies();
  await page.goto("/");
  await page.getByLabel("Username").fill(username);
  await page.getByLabel("Password").fill("JPDemo@12345");
  await page.getByRole("button", { name: /sign in/i }).click();
  await expect(page.getByText(/^Hello, /)).toBeVisible();
}

test.describe.configure({ mode: "serial" });

test("a mistri signs in with mobile and PIN and sees money, attendance and drawings", async ({
  page,
}) => {
  await page.context().clearCookies();
  await page.goto("/");
  await page.getByRole("button", { name: /Mistri \/ worker login/ }).click();
  await page.getByLabel("Mobile number").fill("9876500001");
  for (const digit of "482913")
    await page.getByRole("button", { name: digit, exact: true }).click();
  await expect(page.getByText("🙏 Ramesh Behera")).toBeVisible();
  await expect(page.getByText("Still to get").first()).toBeVisible();
  await page.getByRole("button", { name: "My attendance" }).click();
  await expect(page.getByText("✓").first()).toBeVisible();
  await page.getByRole("button", { name: "Drawings" }).click();
  await expect(page.getByText("Block 1 ground floor plan (GF-01)")).toBeVisible();
  // Staff screens show the worker screen instead.
  await page.goto("/finance");
  await expect(page.getByText("🙏 Ramesh Behera").filter({ visible: true }).first()).toBeVisible();
  await page
    .getByRole("button", { name: /Sign out/ })
    .filter({ visible: true })
    .first()
    .click();
  await expect(page.getByLabel("Username")).toBeVisible();
});

test("a wrong PIN is refused", async ({ page }) => {
  await page.context().clearCookies();
  await page.goto("/");
  await page.getByRole("button", { name: /Mistri \/ worker login/ }).click();
  await page.getByLabel("Mobile number").fill("9876500001");
  for (const digit of "135790")
    await page.getByRole("button", { name: digit, exact: true }).click();
  await expect(page.getByText(/PIN is wrong/)).toBeVisible();
});

test("the manager approves the supervisor's advance in the khaata", async ({ page }) => {
  await signIn(page, "manager");
  await page.goto("/payroll?tab=khaata");
  await page.getByRole("radio", { name: "Patia Tower A" }).filter({ visible: true }).click();
  await page.getByRole("radio", { name: "Khaata" }).filter({ visible: true }).click();
  await expect(
    page.getByText(/Ramesh Behera · Advance ₹2,000.00/).filter({ visible: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Approve" }).filter({ visible: true }).first().click();
  await expect(page.getByText(/Ramesh Behera · Advance/)).toHaveCount(0);
  await page
    .getByRole("button", { name: "Open khaata of Ramesh Behera" })
    .filter({ visible: true })
    .click();
  await expect(
    page.getByText("Advance to recover").filter({ visible: true }).first(),
  ).toBeVisible();
  await expect(page.getByText("₹2,000.00").filter({ visible: true }).first()).toBeVisible();
});

test("the owner switches a module off for one user and back", async ({ page }) => {
  await signIn(page, "owner");
  await page.goto("/users");
  await page.getByRole("button", { name: "Access for Demo Project Manager" }).first().click();
  await expect(page.getByText("Payroll").filter({ visible: true }).first()).toBeVisible();
  const payroll = page
    .locator("div")
    .filter({ has: page.getByRole("button", { name: "Show Payroll" }) })
    .last();
  await payroll.getByRole("radio", { name: "Off" }).click();
  await expect(payroll.getByText(/^0\/\d+ on$/)).toBeVisible();
  await payroll.getByRole("radio", { name: "As role" }).click();
  await expect(payroll.getByText(/^[1-9]\d*\/\d+ on$/)).toBeVisible();
});

test("the owner sets a site's GPS alert hours", async ({ page }) => {
  await signIn(page, "owner");
  await page.goto("/sites");
  await page.getByText("Patia Tower A").filter({ visible: true }).first().click();
  await page
    .getByRole("button", { name: /GPS alerts: working hours/ })
    .filter({ visible: true })
    .click();
  await expect(page.getByText("Working days").filter({ visible: true })).toBeVisible();
  await page.getByLabel("Work ends").filter({ visible: true }).fill("17:30");
  await page
    .getByRole("button", { name: "Save GPS alert settings" })
    .filter({ visible: true })
    .click();
  await expect(page.getByText("Saved.").filter({ visible: true })).toBeVisible();
  await expect(page.getByText("Site team tracking").filter({ visible: true })).toBeVisible();
});

test("a mistri who forgot the PIN tells the supervisor; the manager sets a new PIN", async ({
  page,
}) => {
  await page.context().clearCookies();
  await page.goto("/");
  await page.getByRole("button", { name: /Mistri \/ worker login/ }).click();
  // Without a number the app asks for it first.
  await page.getByRole("button", { name: "Forgot PIN" }).click();
  await expect(page.getByText("First write your mobile number above.")).toBeVisible();
  await page.getByLabel("Mobile number").fill("9876500001");
  await page.getByRole("button", { name: "Forgot PIN" }).click();
  await expect(page.getByText(/your supervisor has been told/)).toBeVisible();

  await signIn(page, "manager");
  await page.goto("/app-reports");
  await expect(page.getByText("Ramesh Behera").filter({ visible: true }).first()).toBeVisible();
  await expect(page.getByText("Forgot PIN").filter({ visible: true }).first()).toBeVisible();
  await page
    .getByRole("button", { name: "Set a new PIN" })
    .filter({ visible: true })
    .first()
    .click();
  await expect(page.getByText("Ramesh Behera").filter({ visible: true }).first()).toBeVisible();
  await expect(
    page
      .getByRole("button", { name: /Reset PIN/ })
      .filter({ visible: true })
      .first(),
  ).toBeVisible();
});

test("the worker screen has a read-aloud button and, when switched on, problem tiles", async ({
  page,
}) => {
  await page.context().clearCookies();
  await page.goto("/");
  await page.getByRole("button", { name: /Mistri \/ worker login/ }).click();
  await page.getByLabel("Mobile number").fill("9876500001");
  for (const digit of "482913")
    await page.getByRole("button", { name: digit, exact: true }).click();
  await expect(page.getByText("🙏 Ramesh Behera")).toBeVisible();
  await expect(page.getByRole("button", { name: "Read aloud" })).toBeVisible();
});

test("staff report a problem and the owner sees it in App problems", async ({ page }) => {
  await signIn(page, "store");
  await page.goto("/report-problem");
  await page
    .getByLabel(/What happened\?/)
    .filter({ visible: true })
    .fill("Stock card shows the wrong unit for cement");
  await page.getByRole("button", { name: "Send" }).filter({ visible: true }).click();
  await expect(page.getByText(/Sent\. Thank you/).filter({ visible: true })).toBeVisible();

  await signIn(page, "owner");
  await page.goto("/app-reports");
  await page
    .getByRole("radio", { name: /^Staff report/ })
    .filter({ visible: true })
    .click();
  await expect(
    page.getByText("Stock card shows the wrong unit for cement").filter({ visible: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Mark done" }).filter({ visible: true }).first().click();
  await page.getByLabel("What was done (optional)").filter({ visible: true }).fill("Unit fixed");
  await page.getByRole("button", { name: "Mark done" }).filter({ visible: true }).first().click();
  await expect(
    page.getByText("Stock card shows the wrong unit for cement").filter({ visible: true }),
  ).toHaveCount(0);
});
