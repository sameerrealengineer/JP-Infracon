import { expect, test, type Page } from "@playwright/test";

// Real app, real server rules, demo sample data: approve a PO, receive goods, see the stock entry.

async function signIn(page: Page, username: string) {
  await page.context().clearCookies();
  await page.goto("/");
  await page.getByLabel("Username").fill(username);
  await page.getByLabel("Password").fill("JPDemo@12345");
  await page.getByRole("button", { name: /sign in/i }).click();
  await expect(page.getByText(/^Hello, /)).toBeVisible();
}

test.describe.configure({ mode: "serial" });
let poNumber = "";

test("owner sees the PO waiting in the inbox, compares quotes and approves it", async ({
  page,
}) => {
  await signIn(page, "owner");
  await page.goto("/purchase");
  await page.getByRole("radio", { name: "Patia Tower A" }).filter({ visible: true }).click();
  const waiting = page
    .getByRole("button", { name: /Open PO-/ })
    .filter({ hasText: "Submitted" })
    .filter({ visible: true })
    .first();
  await expect(waiting).toBeVisible();
  poNumber = ((await waiting.getAttribute("aria-label")) ?? "").replace("Open ", "");
  await waiting.click();
  await expect(page.getByRole("heading", { name: poNumber })).toBeVisible();
  await page.getByRole("button", { name: "Approve order" }).click();
  await expect(page.getByText("Receive goods").filter({ visible: true })).toBeVisible();
});

test("storekeeper receives part of it and rejects damaged bags with a reason", async ({ page }) => {
  await signIn(page, "store");
  await page.goto("/purchase");
  await page.getByRole("radio", { name: "Patia Tower A" }).filter({ visible: true }).click();
  await page
    .getByRole("button", { name: `Open ${poNumber}` })
    .filter({ visible: true })
    .click();
  await page.getByText("Receive goods").filter({ visible: true }).click();
  await page.getByLabel("Challan no.").fill("DC-9001");
  await page.getByLabel("Accepted (bag)").fill("140");
  await page.getByLabel("Rejected (bag)").fill("10");
  await page.getByRole("button", { name: "Save goods receipt" }).click();
  await expect(page.locator("body")).toContainText("say why material was rejected");
  await page.getByLabel("Why rejected").fill("Bags wet from rain");
  await page.getByRole("button", { name: "Save goods receipt" }).click();
  await expect(page.locator("body")).toContainText("stock entries sent to Inventory for review");
  await expect(page.locator("body")).toContainText("Part received");
  await expect(
    page
      .getByText(/rejected 10 \(Bags wet from rain\)/)
      .filter({ visible: true })
      .first(),
  ).toBeVisible();
});

test("an auditor can read purchase orders but is not offered new ones", async ({ page }) => {
  await signIn(page, "auditor");
  await page.goto("/purchase");
  await page.getByRole("radio", { name: "Patia Tower A" }).filter({ visible: true }).click();
  await expect(page.getByRole("button", { name: /Open PO-/ }).first()).toBeVisible();
  await expect(page.getByRole("button", { name: "New purchase order" })).toHaveCount(0);
});
