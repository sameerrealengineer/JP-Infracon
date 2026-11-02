import { expect, test } from "@playwright/test";
import { mockTrpc, type Outputs } from "./trpc-mock";

// Sign-up with an administrator's invite code, and time-limited delegation of authority.

const ORG = "33333333-3333-4333-8333-333333333333";
const SITE = "11111111-1111-4111-8111-111111111111";

test("a new engineer creates their own login with an invite code", async ({ page }) => {
  const calls: unknown[] = [];
  await mockTrpc(page, {
    "auth.me": () => null,
    "auth.bootstrapStatus": () => ({ initialized: true }),
    "auth.registerWithInvite": (input) => {
      calls.push(input);
      throw new Error("This invite code is not valid, has expired, or was already used.");
    },
  });
  await page.goto("/");
  await page.getByRole("button", { name: "Have an invite code? Create account" }).click();
  await expect(page.getByText("Create your account")).toBeVisible();
  await page.getByLabel("Invite code").fill("abcde-fgh23");
  await page.getByLabel("Choose username").fill("sipun.behera");
  await page.getByLabel("Choose password").fill("very-strong-pass-123");
  await page.getByLabel("Confirm password").fill("very-strong-pass-123");
  await page.screenshot({ path: "test-results/invite-signup.png" });
  await page.getByRole("button", { name: "Create account" }).click();
  await expect.poll(() => calls.length).toBe(1);
  expect(calls[0]).toMatchObject({ code: "abcde-fgh23", username: "sipun.behera" });
  await expect(page.getByText(/not valid, has expired/)).toBeVisible();
});

test("a director delegates site authority with self-approval for two days", async ({ page }) => {
  const created: unknown[] = [];
  await mockTrpc(page, {
    "auth.me": () =>
      ({
        id: 7,
        name: "Jeetendra Kumar Panda",
        email: null,
        loginMethod: "password",
        accountStatus: "Active",
        platformOwner: false,
        platformRole: "user",
        mustChangePassword: false,
        lastSignedIn: new Date(),
      }) as Outputs["auth"]["me"],
    "jp.workspace.inbox": () => ({ asOf: new Date().toISOString(), unavailable: [], items: [] }),
    "jp.sitesAdmin.overview": () => [{ id: ORG, name: "JP Infracon", code: "JPI", projects: [] }],
    "jp.delegation.list": () => [],
    "jp.delegation.candidates": () => [
      {
        userId: 12,
        name: "Sipun Behera",
        roles: ["supervisor"],
        sites: [{ id: SITE, name: "Balugaon Pump House" }],
        projects: [{ id: "44444444-4444-4444-8444-444444444444", name: "Khurda RWSS" }],
      },
    ],
    "jp.delegation.create": (input) => {
      created.push(input);
      return { id: "99999999-9999-4999-8999-999999999999" };
    },
  });
  await page.goto("/delegation");
  await page.getByRole("button", { name: "Delegate authority" }).first().click();
  await page.getByRole("radio", { name: "Sipun Behera" }).click();
  await page.getByRole("radio", { name: "2 days" }).click();
  await page.getByLabel("Reason (recorded)").fill("Travelling to Delhi");
  await page.screenshot({ path: "test-results/delegation.png" });
  await page.getByRole("button", { name: "Delegate for 2 days" }).click();
  await expect.poll(() => created.length).toBe(1);
  expect(created[0]).toMatchObject({
    organizationId: ORG,
    userId: 12,
    scopeType: "site",
    scopeId: SITE,
    bundles: ["site_operations", "self_approval"],
    duration: "2d",
  });
});
