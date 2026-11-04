import { beforeAll, describe, expect, it, vi } from "vitest";

// Purchase end to end over the demo SQLite database (never the shared MySQL):
// PO with quotes → maker-checker approval → goods receipt → stock inward → bill match.
vi.mock("../../server/db", () => import("./server/db"));
vi.mock("../../server/_core/sdk", () => import("./server/sdk"));
vi.mock("../../server/storage", () => import("./server/storage"));

const { setDemoDriver } = await import("./runtime");
const { createNodeDriver } = await import("./testing/node-driver");
const { ensureDemoData } = await import("./backend");
const { signIn, mutationId } = await import("./seed");

type Caller = Awaited<ReturnType<typeof signIn>>;
let owner: Caller, manager: Caller, supervisor: Caller, accounts: Caller, auditor: Caller;
let siteId = "";
let poId = "";
let vendorId = "";
let cementId = "";

describe("purchase", () => {
  beforeAll(async () => {
    await setDemoDriver(createNodeDriver());
    await ensureDemoData();
    [owner, manager, supervisor, accounts, auditor] = await Promise.all(
      ["owner", "manager", "supervisor", "accounts", "auditor"].map(signIn),
    );
    siteId = (await owner.jp.workspace.mySites()).find((s) => s.code === "PATIA-A")!.id;
    const options = await manager.jp.purchase.options({ siteId });
    vendorId = options.vendors.find((v) => v.name.startsWith("Kalinga Building"))!.id;
    cementId = options.items.find((i) => i.itemCode === "CEM-OPC53")!.id;
  }, 120_000);

  it("manager raises a PO with competing quotes; the server totals it", async () => {
    const created = await manager.jp.purchase.create({
      siteId,
      vendorId,
      orderDate: "2026-11-02",
      expectedDate: "2026-11-06",
      lines: [
        {
          materialItemId: cementId,
          description: "OPC 53 cement",
          unitCode: "bag",
          quantity: "100",
          rateRupees: "410",
          gstPercent: "28",
        },
        {
          description: "Unloading charges",
          unitCode: "lot",
          quantity: "1",
          rateRupees: "1500",
          gstPercent: "0",
        },
      ],
      quotes: [
        { vendorId, vendorName: "Kalinga Building Materials", totalRupees: "54980" },
        { vendorName: "Utkal Cement Traders", totalRupees: "56900", deliveryDays: 3 },
      ],
      clientMutationId: mutationId(),
    });
    poId = created.id;
    expect(created.poNumber).toMatch(/^PO-PATIA-A-\d{3}$/);
    const detail = await owner.jp.purchase.detail({ siteId, poId });
    // 100 × 410 = 41,000 + 28% GST 11,480 + 1,500 = 53,980
    expect(detail.order).toMatchObject({
      status: "Draft",
      subtotalMinor: "4250000",
      gstMinor: "1148000",
      totalMinor: "5398000",
    });
    expect(detail.quotes.find((q) => q.lowest)?.vendorName).toBe("Kalinga Building Materials");
  });

  it("maker submits; maker cannot approve; owner approves; it shows in the approver's inbox", async () => {
    await manager.jp.purchase.transition({
      siteId,
      poId,
      action: "submit",
      clientMutationId: mutationId(),
    });
    await expect(
      manager.jp.purchase.transition({
        siteId,
        poId,
        action: "approve",
        clientMutationId: mutationId(),
      }),
    ).rejects.toThrow(/different person/);
    await expect(
      supervisor.jp.purchase.transition({
        siteId,
        poId,
        action: "approve",
        clientMutationId: mutationId(),
      }),
    ).rejects.toThrow(/purchase.approve/);
    const inbox = await owner.jp.workspace.inbox();
    expect(inbox.items.some((item) => item.kind === "purchase.review")).toBe(true);
    await owner.jp.purchase.transition({
      siteId,
      poId,
      action: "approve",
      clientMutationId: mutationId(),
    });
    expect((await owner.jp.purchase.detail({ siteId, poId })).order.status).toBe("Approved");
  });

  it("supervisor receives part of the order, rejects torn bags with a reason; stock inward is created", async () => {
    const { lines } = await supervisor.jp.purchase.detail({ siteId, poId });
    const cement = lines.find((line) => line.description === "OPC 53 cement")!;
    await expect(
      supervisor.jp.purchase.receive({
        siteId,
        poId,
        receivedOn: "2026-11-03",
        lines: [{ poLineId: cement.id, accepted: "101" }],
        clientMutationId: mutationId(),
      }),
    ).rejects.toThrow(/still due/);
    await expect(
      supervisor.jp.purchase.receive({
        siteId,
        poId,
        receivedOn: "2026-11-03",
        lines: [{ poLineId: cement.id, accepted: "58", rejected: "2" }],
        clientMutationId: mutationId(),
      }),
    ).rejects.toThrow(/why material was rejected/);
    const grn = await supervisor.jp.purchase.receive({
      siteId,
      poId,
      receivedOn: "2026-11-03",
      challanNumber: "DC-4471",
      vehicleNumber: "OD02AB1234",
      lines: [
        { poLineId: cement.id, accepted: "58", rejected: "2", rejectReason: "Two bags torn" },
      ],
      clientMutationId: mutationId(),
    });
    expect(grn.grnNumber).toMatch(/^GRN-PATIA-A-\d{3}$/);
    expect(grn.stockEntries).toBe(1);
    const after = await owner.jp.purchase.detail({ siteId, poId });
    expect(after.receipt).toBe("Part received");
    expect(after.lines.find((l) => l.id === cement.id)?.receivedThousandths).toBe("58000");
    const stock = await owner.jp.inventory.list({ siteId });
    expect(JSON.stringify(stock)).toContain(grn.grnNumber);
  });

  it("a supplier bill is matched against what was received", async () => {
    const bill = await accounts.jp.finance.createInvoice({
      siteId,
      vendorId,
      invoiceNumber: "KBM-PO-TEST-1",
      invoiceDate: "2026-11-03",
      taxRupees: "6658.40",
      chargesRupees: "0",
      items: [
        { description: "OPC 53 cement", quantity: "58", unitCode: "bag", lineTotalRupees: "23780" },
      ],
      action: "Submitted",
      clientMutationId: mutationId(),
    });
    const linkable = await accounts.jp.purchase.linkableBills({ siteId, poId });
    expect(linkable.map((b) => b.invoiceNumber)).toContain("KBM-PO-TEST-1");
    await accounts.jp.purchase.linkBill({ siteId, poId, invoiceId: bill.id });
    const { match } = await owner.jp.purchase.detail({ siteId, poId });
    // 58 × 410 × 1.28 = 30,438.40 received value; billed 23,780 + 6,658.40 = 30,438.40
    expect(match).toMatchObject({
      receivedValueMinor: "3043840",
      billedMinor: "3043840",
      state: "Matches",
    });
  });

  it("auditor reads but cannot order; module off refuses", async () => {
    expect((await auditor.jp.purchase.list({ siteId })).length).toBeGreaterThan(0);
    await expect(
      auditor.jp.purchase.create({
        siteId,
        vendorId,
        orderDate: "2026-11-02",
        lines: [{ description: "Sand", unitCode: "cum", quantity: "1", rateRupees: "1" }],
        clientMutationId: mutationId(),
      }),
    ).rejects.toThrow(/purchase.create/);
    await owner.jp.modules.update({ disabled: ["purchase"] });
    try {
      await expect(owner.jp.purchase.list({ siteId })).rejects.toThrow(/turned off/);
    } finally {
      await owner.jp.modules.update({ disabled: [] });
    }
  });
});
