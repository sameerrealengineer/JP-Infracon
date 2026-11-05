import { expect, test, type Page } from "@playwright/test";

// Real app, real server rules, demo sample data: last month's paid pay run, pay details that
// wait for a different person, accounts dues with a deposit, and who is kept out.

async function signIn(page: Page, username: string) {
  await page.context().clearCookies();
  await page.goto("/");
  await page.getByLabel("Username").fill(username);
  await page.getByLabel("Password").fill("JPDemo@12345");
  await page.getByRole("button", { name: /sign in/i }).click();
  await expect(page.getByText(/^Hello, /)).toBeVisible();
}

async function openPayroll(page: Page) {
  await page.goto("/payroll");
  await page.getByRole("radio", { name: "Patia Tower A" }).filter({ visible: true }).click();
}

test.describe.configure({ mode: "serial" });

test("owner sees last month's paid pay run with the wage sheet", async ({ page }) => {
  await signIn(page, "owner");
  await openPayroll(page);
  const run = page
    .getByRole("button", { name: /Open PR-PATIA-A-\d{6}/ })
    .filter({ visible: true })
    .first();
  await expect(run).toBeVisible();
  await run.click();
  await expect(page.getByText("Wage sheet").filter({ visible: true })).toBeVisible();
  await expect(page.getByText("Paid").filter({ visible: true }).first()).toBeVisible();
  await expect(page.getByText("Anil Mohanty").filter({ visible: true })).toBeVisible();
  // ₹22,000 gross − ₹2,160 PF
  await expect(page.getByText("₹19,840.00").filter({ visible: true }).first()).toBeVisible();
  await expect(page.getByText(/No payroll profile/).filter({ visible: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Approve pay run" })).toHaveCount(0);
});

test("accounts cannot approve their own pay-details request; the manager can", async ({ page }) => {
  await signIn(page, "accounts");
  await openPayroll(page);
  await page.getByRole("radio", { name: "Pay details" }).filter({ visible: true }).click();
  await expect(page.getByText("Waiting for approval").filter({ visible: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Approve pay details" })).toHaveCount(0);

  await signIn(page, "manager");
  await openPayroll(page);
  await page.getByRole("radio", { name: "Pay details" }).filter({ visible: true }).click();
  await page.getByRole("button", { name: "Approve pay details" }).filter({ visible: true }).click();
  await expect(page.getByText("Waiting for approval")).toHaveCount(0);
});

test("accounts records the ESI deposit and the due shows as paid", async ({ page }) => {
  await signIn(page, "accounts");
  await page.goto("/accounts");
  await expect(page.getByText("We owe suppliers").filter({ visible: true })).toBeVisible();
  await page
    .getByRole("button", { name: /^Record deposit for ESI \d{4}-\d{2}$/ })
    .filter({ visible: true })
    .first()
    .click();
  await page.getByLabel("Challan / TRRN number").filter({ visible: true }).fill("ESIC 556677");
  await page.getByRole("button", { name: "Save deposit" }).filter({ visible: true }).click();
  await expect(page.getByText("Deposit recorded.").filter({ visible: true })).toBeVisible();
  await expect(page.getByText(/ESIC 556677/).filter({ visible: true })).toBeVisible();
  // The amount came from the due, so nothing is left to deposit for ESI.
  await expect(page.getByRole("button", { name: /^Record deposit for ESI / })).toHaveCount(0);
});

test("a supervisor has no payroll; an auditor reads accounts without recording", async ({
  page,
}) => {
  await signIn(page, "supervisor");
  await page.goto("/payroll");
  await expect(page.getByText("No site").filter({ visible: true })).toBeVisible();

  await signIn(page, "auditor");
  await page.goto("/accounts");
  await expect(page.getByText("Clients owe us").filter({ visible: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Record a deposit" })).toHaveCount(0);
});
