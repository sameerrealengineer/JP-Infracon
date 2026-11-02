import { expect, test } from "@playwright/test";
import { mockTrpc } from "./trpc-mock";

// Field users can switch the app to Hindi or Odia, starting from the sign-in screen.

test("the sign-in screen switches to Hindi and Odia and remembers the choice", async ({ page }) => {
  await mockTrpc(page, {
    "auth.me": () => null,
    "auth.bootstrapStatus": () => ({ initialized: true }),
  });
  await page.goto("/");
  await expect(page.getByText("Welcome back")).toBeVisible();

  await page.getByRole("radio", { name: "हिन्दी" }).click();
  await expect(page.getByText("फिर से स्वागत है")).toBeVisible();
  await expect(page.getByRole("button", { name: "साइन इन" })).toBeVisible();
  await page.screenshot({ path: "test-results/login-hindi.png" });

  await page.getByRole("radio", { name: "ଓଡ଼ିଆ" }).click();
  await expect(page.getByText("ପୁଣି ସ୍ୱାଗତ")).toBeVisible();

  await page.reload();
  await expect(page.getByText("ପୁଣି ସ୍ୱାଗତ")).toBeVisible();
});
