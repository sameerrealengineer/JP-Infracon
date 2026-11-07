import { expect, test, type Page } from "@playwright/test";
import { mockTrpc, type Outputs } from "./trpc-mock";

// Project budget: budget vs spend, proposing a revision, and approving one.

type Capability = Outputs["jp"]["workspace"]["myCapabilities"][number];
type Overview = Outputs["jp"]["budgets"]["overview"];
const SITE = "11111111-1111-4111-8111-111111111111";
const PROJECT = "44444444-4444-4444-8444-444444444444";
const BUDGET = "88888888-8888-4888-8888-888888888888";

const heads = [
  ["Materials", "200000000", "190000000", "5000000", "ok"],
  ["Labour", "100000000", "120000000", "0", "over"],
  ["Subcontract", "0", "0", "0", "none"],
  ["Equipment and transport", "0", "0", "0", "none"],
  ["Site expenses", "5000000", "1000000", "0", "ok"],
  ["Other", "0", "0", "0", "none"],
] as const;

function overview(withProposal: boolean): Overview {
  const revision = {
    id: BUDGET,
    revisionNumber: 1,
    status: "Approved" as const,
    contractValueMinor: "500000000",
    totalMinor: "305000000",
    reason: null,
    reviewReason: null,
    proposerName: "Ravi Mohanty",
    reviewerName: "Asha Das",
    reviewedAt: new Date("2026-11-01T10:00:00.000Z"),
    createdAt: new Date("2026-10-30T10:00:00.000Z"),
    mine: true,
  };
  const lines = [
    { costHead: "Materials" as const, amountMinor: "200000000", note: null },
    { costHead: "Labour" as const, amountMinor: "100000000", note: null },
    { costHead: "Site expenses" as const, amountMinor: "5000000", note: null },
  ];
  const proposal = {
    ...revision,
    id: "99999999-9999-4999-8999-999999999999",
    revisionNumber: 2,
    status: "Proposed" as const,
    totalMinor: "335000000",
    reason: "Labour rates went up",
    reviewerName: null,
    reviewedAt: null,
    mine: false,
    lines: [lines[0], { ...lines[1], amountMinor: "130000000" }, lines[2]],
  };
  return {
    project: { id: PROJECT, name: "Govt Building", code: "PKL001" },
    current: { ...revision, lines },
    proposed: withProposal ? proposal : null,
    comparison: {
      heads: heads.map(([costHead, budget, actual, pending, state]) => ({
        costHead,
        budgetMinor: budget,
        actualMinor: actual,
        pendingMinor: pending,
        remainingMinor: (BigInt(budget) - BigInt(actual)).toString(),
        usedTenths: budget === "0" ? null : Number((BigInt(actual) * 1000n) / BigInt(budget)),
        state,
      })),
      totals: {
        budgetMinor: "305000000",
        actualMinor: "311000000",
        pendingMinor: "5000000",
        remainingMinor: "-6000000",
        usedTenths: 1019,
        state: "over",
      },
    },
    margins: { plannedMinor: "195000000", toDateMinor: "189000000" },
    sites: [{ id: SITE, name: "Pakalapoli Site", actualMinor: "311000000" }],
    labourMissingRate: 2,
    history: withProposal ? [proposal, revision] : [revision],
    canManage: true,
    canApprove: withProposal,
  };
}

async function setup(page: Page, withProposal: boolean) {
  const proposals: unknown[] = [];
  const reviews: unknown[] = [];
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
      businessRole: "director",
      roles: ["director"],
      canInitializeOrganization: false,
      canManageSites: false,
      canManageAccounts: false,
    }),
    "jp.workspace.myCapabilities": () => [
      Object.fromEntries([
        ["siteId", SITE],
        ...["site.view", "budget.view", "budget.manage", "budget.approve"].map((key) => [
          key,
          true,
        ]),
      ]) as unknown as Capability,
    ],
    "jp.workspace.inbox": () => ({ asOf: new Date().toISOString(), unavailable: [], items: [] }),
    "jp.budgets.options": () => ({
      costHeads: heads.map((row) => row[0]),
      projects: [
        { id: PROJECT, name: "Govt Building", code: "PKL001", canManage: true, canApprove: true },
      ],
    }),
    "jp.budgets.overview": () => overview(withProposal),
    "jp.budgets.propose": (input) => {
      proposals.push(input);
      return { id: BUDGET, revisionNumber: 2 };
    },
    "jp.budgets.review": (input) => {
      reviews.push(input);
      return { id: BUDGET, status: "Approved" as const };
    },
  });
  return { proposals, reviews };
}

test("budget against spend, and proposing a revision with a reason", async ({ page }) => {
  const { proposals } = await setup(page, false);
  await page.goto("/project-budget");
  await expect(page.getByText("Govt Building · PKL001")).toBeVisible();
  await expect(page.getByText("Revision 1 · 101.9% used")).toBeVisible();
  await expect(page.getByText(/Spent ₹12,00,000.00 of ₹10,00,000.00/)).toBeVisible();
  await expect(page.getByText("Over budget")).toHaveCount(2);
  await expect(page.getByText("₹50,00,000.00").first()).toBeVisible();
  await expect(page.getByText(/2 attendance entries have no rate/)).toBeVisible();
  await page.screenshot({ path: "test-results/project-budget.png", fullPage: true });

  await page.getByText("Propose a revision").click();
  await expect(page.getByRole("textbox", { name: "Labour (₹)" })).toHaveValue("1000000");
  await page.getByRole("textbox", { name: "Labour (₹)" }).fill("1300000");
  await expect(page.getByText("₹33,50,000.00")).toBeVisible();
  await page.getByText("Send for approval").click();
  await expect(page.getByText("Give a reason for revising the approved budget.")).toBeVisible();
  await page.getByRole("textbox", { name: "Reason for the revision" }).fill("Labour rates went up");
  await page.getByText("Send for approval").click();
  await expect.poll(() => proposals.length).toBe(1);
  expect(proposals[0]).toMatchObject({
    projectId: PROJECT,
    contractValueMinor: "500000000",
    reason: "Labour rates went up",
    lines: [
      { costHead: "Materials", amountMinor: "200000000" },
      { costHead: "Labour", amountMinor: "130000000" },
      { costHead: "Site expenses", amountMinor: "5000000" },
    ],
  });
});

test("an approver sees what changed and approves the revision", async ({ page }) => {
  const { reviews } = await setup(page, true);
  await page.goto("/project-budget");
  await expect(page.getByText("Revision 2 waiting for approval")).toBeVisible();
  await expect(page.getByText("₹13,00,000.00 (was ₹10,00,000.00)")).toBeVisible();
  await expect(page.getByText("Propose a revision")).toHaveCount(0);
  await page.getByText("Approve budget").click();
  await expect.poll(() => reviews.length).toBe(1);
  expect(reviews[0]).toMatchObject({ decision: "Approve" });
});
