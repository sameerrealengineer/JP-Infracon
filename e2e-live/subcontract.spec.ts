import { expect, test, type Page } from "@playwright/test";

// Real app, real server rules, demo sample data: check measurements, make an RA bill, approve
// it into a payable, record a new measurement, and confirm a read-only role cannot create.

async function signIn(page: Page, username: string) {
  await page.context().clearCookies();
  await page.goto("/");
  await page.getByLabel("Username").fill(username);
  await page.getByLabel("Password").fill("JPDemo@12345");
  await page.getByRole("button", { name: /sign in/i }).click();
  await expect(page.getByText(/^Hello, /)).toBeVisible();
}

async function openSampleOrder(page: Page) {
  await page.goto("/subcontract");
  await page.getByRole("radio", { name: "Patia Tower A" }).filter({ visible: true }).click();
  const order = page
    .getByRole("button", { name: /Open WO-PATIA-A-/ })
    .filter({ hasText: "Brickwork and plaster" })
    .filter({ visible: true })
    .first();
  await expect(order).toBeVisible();
  await order.click();
  await expect(page.getByText("Measurement book").filter({ visible: true })).toBeVisible();
}

test.describe.configure({ mode: "serial" });

test("manager checks the supervisor's measurement and makes RA-02 from it", async ({ page }) => {
  await signIn(page, "manager");
  await openSampleOrder(page);
  await page.getByRole("button", { name: "Check all 1" }).filter({ visible: true }).click();
  await expect(
    page.getByText("1 checked measurements not billed yet").filter({ visible: true }),
  ).toBeVisible();
  await page.getByText("Make RA bill").filter({ visible: true }).click();
  // 48 × 3 = 144 sqm × ₹95 = ₹13,680 of plaster
  await expect(page.getByText("₹13,680.00").filter({ visible: true }).first()).toBeVisible();
  await page
    .getByRole("button", { name: "Make and submit bill" })
    .filter({ visible: true })
    .click();
  await expect(page.getByRole("heading", { name: /\/RA-02$/ })).toBeVisible();
  await expect(page.getByText("Submitted").filter({ visible: true }).first()).toBeVisible();
  await expect(page.getByRole("button", { name: "Approve bill" })).toHaveCount(0);
});

test("owner approves RA-02 and it becomes a payable in Finance", async ({ page }) => {
  await signIn(page, "owner");
  await openSampleOrder(page);
  await page
    .getByRole("button", { name: /Open WO-PATIA-A-\d+\/RA-02/ })
    .filter({ visible: true })
    .click();
  await page.getByRole("button", { name: "Approve bill" }).filter({ visible: true }).click();
  await expect(
    page.getByText(/^Payable WO-PATIA-A-\d+\/RA-02 is in Finance$/).filter({ visible: true }),
  ).toBeVisible();
});

test("supervisor records a measurement; going past the ordered quantity is refused", async ({
  page,
}) => {
  await signIn(page, "supervisor");
  await openSampleOrder(page);
  await page.getByText("Add measurement").filter({ visible: true }).click();
  await page.getByRole("radio", { name: "M2" }).filter({ visible: true }).click();
  await page.getByLabel("Location").filter({ visible: true }).fill("First floor, rooms 5-8");
  await page.getByLabel("L (m)").filter({ visible: true }).fill("2000");
  await page.getByLabel("D/H (m)").filter({ visible: true }).fill("3");
  await page.getByRole("button", { name: "Save measurement" }).filter({ visible: true }).click();
  await expect(page.locator("body")).toContainText("past the work-order quantity");
  await page.getByLabel("L (m)").filter({ visible: true }).fill("40");
  await page.getByRole("button", { name: "Save measurement" }).filter({ visible: true }).click();
  await expect(page.locator("body")).toContainText("Measured 120");
  await expect(page.getByRole("button", { name: /Check all/ })).toHaveCount(0);
});

test("an auditor can read work orders but is not offered new ones", async ({ page }) => {
  await signIn(page, "auditor");
  await page.goto("/subcontract");
  await page.getByRole("radio", { name: "Patia Tower A" }).filter({ visible: true }).click();
  await expect(page.getByRole("button", { name: /Open WO-/ }).first()).toBeVisible();
  await expect(page.getByRole("button", { name: "New work order" })).toHaveCount(0);
});
