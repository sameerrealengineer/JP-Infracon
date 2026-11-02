import { expect, test, type Page } from "@playwright/test";
import { mockTrpc, type Outputs } from "./trpc-mock";

// Browsing, smart search and upload of project documents.

type Capability = Outputs["jp"]["workspace"]["myCapabilities"][number];
const SITE = "11111111-1111-4111-8111-111111111111";
const PROJECT = "44444444-4444-4444-8444-444444444444";
const DOC = "77777777-7777-4777-8777-777777777777";

const row = {
  id: DOC,
  projectId: PROJECT,
  projectName: "Khurda Rural Water Supply",
  siteId: SITE,
  siteName: "Balugaon Pump House",
  category: "Bills and invoices",
  title: "Cement bill October",
  description: null,
  tags: "cement",
  currentVersion: 2,
  status: "Active" as const,
  aiDocumentType: "Tax invoice",
  aiSummary: "Invoice for 120 bags of OPC 53 cement.",
  indexStatus: "Indexed" as const,
  createdBy: 7,
  creatorName: "Ravi Mohanty",
  updatedAt: new Date("2026-11-01T10:00:00.000Z"),
};

async function setup(page: Page) {
  const uploads: unknown[] = [];
  const searches: unknown[] = [];
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
      businessRole: "project_manager",
      roles: ["project_manager"],
      canInitializeOrganization: false,
      canManageSites: false,
      canManageAccounts: false,
    }),
    "jp.workspace.myCapabilities": () => [
      Object.fromEntries([
        ["siteId", SITE],
        ...["site.view", "document.view", "document.upload", "document.manage"].map((key) => [
          key,
          true,
        ]),
      ]) as unknown as Capability,
    ],
    "jp.workspace.inbox": () => ({ asOf: new Date().toISOString(), unavailable: [], items: [] }),
    "jp.documents.options": () => ({
      categories: [],
      projects: [{ id: PROJECT, name: "Khurda Rural Water Supply" }],
      sites: [
        {
          id: SITE,
          name: "Balugaon Pump House",
          projectId: PROJECT,
          canUpload: true,
          canManage: true,
        },
      ],
    }),
    "jp.documents.list": () => [row],
    "jp.documents.search": (input) => {
      searches.push(input);
      return {
        mode: "meaning" as const,
        results: [
          { ...row, score: 0.82, excerpt: "…Tax invoice INV-2026-0042 for OPC 53 cement…" },
        ],
      };
    },
    "jp.documents.detail": () => ({
      document: {
        ...row,
        organizationId: "33333333-3333-4333-8333-333333333333",
        clientMutationId: "x".repeat(20),
        createdAt: new Date("2026-10-30T10:00:00.000Z"),
        aiFields: { documentNumber: "INV-2026-0042", gstin: "21ABCDE1234F1Z5" },
      },
      versions: [
        {
          versionNumber: 2,
          note: "Corrected GST",
          createdAt: new Date("2026-11-01T10:00:00.000Z"),
          uploaderName: "Ravi Mohanty",
          fileName: "bill-v2.pdf",
          contentType: "application/pdf",
          sizeBytes: 120_000,
        },
        {
          versionNumber: 1,
          note: null,
          createdAt: new Date("2026-10-30T10:00:00.000Z"),
          uploaderName: "Ravi Mohanty",
          fileName: "bill.pdf",
          contentType: "application/pdf",
          sizeBytes: 118_000,
        },
      ],
      canManage: true,
      canReplace: true,
    }),
    "jp.documents.upload": (input) => {
      uploads.push(input);
      return { id: DOC, versionNumber: 1 };
    },
  });
  return { uploads, searches };
}

test("smart search finds a bill by its invoice number and opens it", async ({ page }) => {
  const { searches } = await setup(page);
  await page.goto("/documents");
  await expect(page.getByText("Cement bill October").first()).toBeVisible();
  await page.getByRole("textbox", { name: "Search documents" }).fill("cement bill INV-2026-0042");
  await page.getByText("Search", { exact: true }).click();
  await expect(page.getByText("Matched by meaning and by exact words")).toBeVisible();
  await expect(page.getByText(/INV-2026-0042 for OPC 53 cement/)).toBeVisible();
  expect(searches[0]).toMatchObject({ query: "cement bill INV-2026-0042", projectId: PROJECT });
  await page.screenshot({ path: "test-results/documents-search.png", fullPage: true });

  await page.getByRole("button", { name: "Open Cement bill October" }).click();
  await expect(page.getByText("Read by AI")).toBeVisible();
  await expect(page.getByText("21ABCDE1234F1Z5")).toBeVisible();
  await expect(page.getByText("Version 2", { exact: true }).first()).toBeVisible();
  await expect(page.getByText("Corrected GST")).toBeVisible();
  await page.screenshot({ path: "test-results/document-detail.png", fullPage: true });
});

test("a document is uploaded with its category and place", async ({ page }) => {
  const { uploads } = await setup(page);
  await page.goto("/documents");
  await page.getByText("Upload", { exact: true }).click();
  const chooser = page.waitForEvent("filechooser");
  await page.getByText("Choose file (PDF, photo, Word, Excel, CSV)").click();
  await (
    await chooser
  ).setFiles({
    name: "structural_drawing_block-A.pdf",
    mimeType: "application/pdf",
    buffer: Buffer.from("%PDF-1.7 test"),
  });
  await expect(page.getByRole("textbox", { name: "Title" })).toHaveValue(
    "structural drawing block A",
  );
  await page.getByText("Drawings", { exact: true }).last().click();
  await page.getByText("Balugaon Pump House", { exact: true }).last().click();
  await page.getByText("Upload", { exact: true }).last().click();
  await expect.poll(() => uploads.length).toBe(1);
  expect(uploads[0]).toMatchObject({
    projectId: PROJECT,
    siteId: SITE,
    category: "Drawings",
    title: "structural drawing block A",
    fileName: "structural_drawing_block-A.pdf",
  });
  expect(Buffer.from((uploads[0] as { base64: string }).base64, "base64").toString()).toBe(
    "%PDF-1.7 test",
  );
});
