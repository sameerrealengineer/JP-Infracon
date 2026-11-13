import { expect, test, type Page } from "@playwright/test";
import { mockTrpc, type Outputs } from "./trpc-mock";

// The one-time permission screen right after sign-in: every permission listed, one "Allow all"
// asks them, and "Continue" is remembered on this device. Checked at phone, tablet and computer
// widths so the screen stays a readable centred column.

test.use({
  // A fresh browser: the permission screen has not been seen yet.
  storageState: { cookies: [], origins: [] },
  launchOptions: {
    args: ["--use-fake-device-for-media-stream", "--use-fake-ui-for-media-stream"],
  },
});

async function signedIn(page: Page) {
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
    "jp.notifications.webPushKey": () =>
      ({ publicKey: null }) as Outputs["jp"]["notifications"]["webPushKey"],
  });
}

test("asks every permission once after sign-in, then remembers it", async ({ page, context }) => {
  await context.grantPermissions(["microphone", "camera", "geolocation", "notifications"]);
  await context.setGeolocation({ latitude: 20.2961, longitude: 85.8245 });
  await signedIn(page);
  await page.goto("/");

  await expect(page.getByText("ONE-TIME SETUP")).toBeVisible();
  for (const title of ["Notifications", "Microphone", "Camera", "Location"])
    await expect(page.getByText(title, { exact: true })).toBeVisible();

  const allowAll = page.getByRole("button", { name: /Allow all|Check again/ });
  if (await page.getByRole("button", { name: "Allow all" }).isVisible())
    await page.getByRole("button", { name: "Allow all" }).click();
  await expect(allowAll).toBeEnabled();
  // Microphone, camera and location; headless Chromium always refuses notifications.
  await expect(page.getByText("Allowed", { exact: true })).toHaveCount(3);

  await page.getByRole("button", { name: /^Continue/ }).click();
  await expect(page.getByText("ONE-TIME SETUP")).toHaveCount(0);
  expect(
    await page.evaluate(() => window.localStorage.getItem("jp-infracon.permissions-asked.v1")),
  ).toBeTruthy();
});

test("a refused permission shows as blocked with how to turn it on", async ({ page, context }) => {
  // Only location is allowed; this browser reports camera, microphone and notifications refused.
  await context.grantPermissions(["geolocation"]);
  await signedIn(page);
  await page.goto("/");
  await expect(page.getByText("Blocked", { exact: true })).toHaveCount(3);
  await expect(page.getByText("Allowed", { exact: true })).toHaveCount(1);
  await expect(page.getByText(/Some are blocked in this browser/)).toBeVisible();
  await expect(page.getByRole("button", { name: "Continue for now" })).toBeVisible();
});

for (const [name, width, height] of [
  ["small phone", 320, 640],
  ["tablet", 820, 1180],
  ["computer", 1440, 900],
] as const)
  test(`fits a ${name} (${width}px) without spilling sideways`, async ({ page }) => {
    await page.setViewportSize({ width, height });
    await signedIn(page);
    await page.goto("/");
    await expect(page.getByText("ONE-TIME SETUP")).toBeVisible();
    const box = await page.getByText("ONE-TIME SETUP").boundingBox();
    const scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth);
    expect(scrollWidth).toBeLessThanOrEqual(width);
    // On wide screens the column is centred and at most 760px.
    if (width > 800) expect(box!.x).toBeGreaterThan((width - 760) / 2 - 1);
    await page.screenshot({ path: `test-results/permissions-${width}.png`, fullPage: true });
  });
