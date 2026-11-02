import { expect, test, type Page } from "@playwright/test";
import { mockTrpc, type Outputs } from "./trpc-mock";

// Covers the screen selection refactor (commit c168278) on the Finance screen:
// paging must stay on the page you chose while it loads, and changing site resets it.

type Site = Outputs["jp"]["workspace"]["mySites"][number];
type Capability = Outputs["jp"]["workspace"]["myCapabilities"][number];
type InvoicePage = Outputs["jp"]["finance"]["listInvoices"];

const SITE_A = "11111111-1111-4111-8111-111111111111";
const SITE_B = "22222222-2222-4222-8222-222222222222";
const PAGE_SIZE = 25;

const me: Outputs["auth"]["me"] = {
  id: 7,
  name: "Accounts Reviewer",
  email: null,
  loginMethod: "password",
  accountStatus: "Active",
  platformOwner: false,
  platformRole: "user",
  mustChangePassword: false,
  lastSignedIn: new Date("2026-11-01T08:30:00.000Z"),
};

function site(id: string, name: string): Site {
  return {
    id,
    name,
    code: name.toUpperCase().replace(/\W/g, ""),
    location: null,
    status: "Active",
    organizationId: "33333333-3333-4333-8333-333333333333",
    projectId: "44444444-4444-4444-8444-444444444444",
    project: "Ring Road Package",
    businessRole: "accounts",
  };
}

// Only the permissions this screen reads; anything missing is treated as not granted.
function invoiceViewer(siteId: string) {
  return { siteId, "finance.invoice.view": true } as unknown as Capability;
}

function invoicePage(prefix: string, total: number, offset: number): InvoicePage {
  const count = Math.max(0, Math.min(PAGE_SIZE, total - offset));
  const rows = Array.from({ length: count }, (_, index) => {
    const number = offset + index + 1;
    return {
      id: `${prefix}-${number}`,
      vendorId: "55555555-5555-4555-8555-555555555555",
      vendorName: "Odisha Cement Traders",
      vendorType: "Material Supplier",
      invoiceNumber: `${prefix}-INV-${String(number).padStart(3, "0")}`,
      invoiceDate: "2026-10-20",
      dueDate: null,
      currency: "INR",
      subtotalMinor: "100000",
      taxMinor: "18000",
      chargesMinor: "0",
      totalMinor: "118000",
      purchaseReference: null,
      receiptReference: null,
      status: "Draft",
      createdBy: 9,
      submittedBy: null,
      submittedAt: null,
      reviewedBy: null,
      reviewedAt: null,
      reviewReason: null,
      createdAt: new Date("2026-10-20T10:00:00.000Z"),
      updatedAt: new Date("2026-10-20T10:00:00.000Z"),
    };
  });
  return { rows, total, limit: PAGE_SIZE, offset } as unknown as InvoicePage;
}

async function openFinance(
  page: Page,
  options: {
    sites: Site[];
    capabilities: Capability[];
    totals: Record<string, number>;
    slowPages?: boolean;
  },
) {
  await mockTrpc(page, {
    "auth.me": () => me,
    "jp.workspace.mySites": () => options.sites,
    "jp.workspace.myCapabilities": () => options.capabilities,
    "jp.finance.listInvoices": async (input) => {
      const { siteId, offset } = input as { siteId: string; offset: number };
      // A short delay on later pages leaves the screen in its loading state long enough to observe.
      if (options.slowPages && offset > 0) await new Promise((done) => setTimeout(done, 1500));
      const prefix = siteId === SITE_B ? "B" : "A";
      return invoicePage(prefix, options.totals[siteId] ?? 0, offset);
    },
  });
  await page.goto("/finance");
}

test.describe("Finance invoice paging", () => {
  test("Next page stays on page 2 while it loads, then shows that page's invoices", async ({
    page,
  }) => {
    await openFinance(page, {
      sites: [site(SITE_A, "Cuttack Yard")],
      capabilities: [invoiceViewer(SITE_A)],
      totals: { [SITE_A]: 30 },
      slowPages: true,
    });
    await expect(page.getByText("A-INV-001")).toBeVisible();
    await expect(page.getByText("Page 1 of 2")).toBeVisible();

    await page.getByRole("button", { name: "Next page" }).click();

    await expect(page.getByText("A-INV-026")).toBeVisible();
    await expect(page.getByText("Page 2 of 2")).toBeVisible();
    await expect(page.getByText("A-INV-001")).toHaveCount(0);
  });

  test("Previous page goes back to the first page", async ({ page }) => {
    await openFinance(page, {
      sites: [site(SITE_A, "Cuttack Yard")],
      capabilities: [invoiceViewer(SITE_A)],
      totals: { [SITE_A]: 30 },
    });
    await page.getByRole("button", { name: "Next page" }).click();
    await expect(page.getByText("A-INV-026")).toBeVisible();

    await page.getByRole("button", { name: "Previous page" }).click();

    await expect(page.getByText("A-INV-001")).toBeVisible();
    await expect(page.getByText("Page 1 of 2")).toBeVisible();
  });

  test("Switching site starts the invoice list again at page 1", async ({ page }) => {
    await openFinance(page, {
      sites: [site(SITE_A, "Cuttack Yard"), site(SITE_B, "Puri Bridge")],
      capabilities: [invoiceViewer(SITE_A), invoiceViewer(SITE_B)],
      totals: { [SITE_A]: 30, [SITE_B]: 60 },
    });
    await page.getByRole("button", { name: "Next page" }).click();
    await expect(page.getByText("A-INV-026")).toBeVisible();

    await page.getByRole("button", { name: /Puri Bridge/ }).click();

    await expect(page.getByText("B-INV-001")).toBeVisible();
    await expect(page.getByText("Page 1 of 3")).toBeVisible();
  });

  test("An account with no finance view grant sees the no access state and no invoices", async ({
    page,
  }) => {
    await openFinance(page, {
      sites: [site(SITE_A, "Cuttack Yard")],
      capabilities: [{ siteId: SITE_A } as unknown as Capability],
      totals: { [SITE_A]: 30 },
    });

    await expect(page.getByText("No commercial-view access")).toBeVisible();
    await expect(page.getByText("A-INV-001")).toHaveCount(0);
  });
});
