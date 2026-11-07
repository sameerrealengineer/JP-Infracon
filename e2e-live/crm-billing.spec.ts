import { expect, test, type Page } from "@playwright/test";

// Real app, real server rules, demo sample data. Runs in order: each step builds on the last.

async function signIn(page: Page, username: string) {
  await page.context().clearCookies();
  await page.goto("/");
  await page.getByLabel("Username").fill(username);
  await page.getByLabel("Password").fill("JPDemo@12345");
  await page.getByRole("button", { name: /sign in/i }).click();
  await expect(page.getByText(/^Hello, /)).toBeVisible();
}

test.describe.configure({ mode: "serial" });

/** The bill made in the accounts step, opened again by number in the next step. */
let billNumber = "";

test("manager records a new enquiry with a follow-up, and it shows in the pipeline", async ({
  page,
}) => {
  await signIn(page, "manager");
  await page.goto("/crm");
  await expect(page.getByText("Patia Tower A civil works")).toBeVisible();
  await page.getByRole("button", { name: "New enquiry" }).click();
  await page.getByLabel("What is the work?").fill("Community hall, Jatni");
  await page.getByLabel("Contact name").fill("Sarpanch, Jatni");
  await page.getByLabel("Mobile").fill("9437000999");
  await page.getByLabel("Estimated value (₹)").fill("2500000");
  await page.getByLabel("Next follow-up (YYYY-MM-DD)").fill("2026-01-05");
  await page.getByRole("button", { name: "Save enquiry" }).click();
  await expect(page.getByRole("heading", { name: "Community hall, Jatni" })).toBeVisible();
  await page.getByLabel("What happened").fill("Called the sarpanch, site visit fixed");
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(page.getByText("Called the sarpanch, site visit fixed")).toBeVisible();
});

test("accounts sees receivables from real approved bills and makes an RA bill", async ({
  page,
}) => {
  await signIn(page, "accounts");
  await page.goto("/billing");
  await expect(page.getByText("RECEIVABLES")).toBeVisible();
  await expect(page.getByText("Bhubaneswar Development Authority").first()).toBeVisible();
  await page.getByText("New RA bill").click();
  await expect(page.getByText("Quantity done this bill")).toBeVisible();
  // Brickwork: contract 420 cum, nothing billed yet.
  const qty = page.getByLabel("Qty (cum)");
  await qty.nth(3).fill("500");
  await expect(page.getByText("More than the contract balance.")).toBeVisible();
  await qty.nth(3).fill("100");
  // 100 × 6,200 = 6,20,000 work; GST 1,11,600; retention 31,000; TDS 12,400 → 6,88,200
  await expect(page.getByText("₹6,88,200.00")).toBeVisible();
  await page.getByRole("button", { name: "Save draft bill" }).click();
  const heading = page.getByRole("heading", { name: /^RA-/ });
  await expect(heading).toBeVisible();
  billNumber = (await heading.textContent())?.trim() ?? "";
  await expect(page.locator("body")).toContainText("Net receivable₹6,88,200.00");
  await page.getByRole("button", { name: "Submit for approval" }).click();
  await expect(page.getByText(/Waiting for approval/)).toBeVisible();
});

test("director approves the bill; accounts records a part payment and the balance drops", async ({
  page,
}) => {
  await signIn(page, "director");
  await page.goto("/billing");
  await page
    .getByRole("button", { name: `Open ${billNumber}` })
    .filter({ visible: true })
    .click();
  await expect(page.getByRole("heading", { name: billNumber })).toBeVisible();
  await page.getByRole("button", { name: "Approve bill" }).click();
  await expect(page.getByText("Money received").filter({ visible: true })).toBeVisible();

  await signIn(page, "accounts");
  await page.goto("/billing");
  await page
    .getByRole("button", { name: `Open ${billNumber}` })
    .filter({ visible: true })
    .click();
  await page.getByLabel("Amount ₹").fill("200000");
  await page.getByRole("button", { name: "Record receipt" }).click();
  await expect(page.locator("body")).toContainText("Outstanding₹4,88,200.00");
  await expect(page.locator("body")).toContainText("Part paid");
});

test("a supervisor is not offered CRM or billing, and the server refuses it", async ({ page }) => {
  await signIn(page, "supervisor");
  await expect(page.getByRole("button", { name: "Clients & leads" })).toHaveCount(0);
  await page.goto("/billing");
  await expect(page.getByText(/billing.view/)).toBeVisible();
});
