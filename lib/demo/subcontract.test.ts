import { beforeAll, describe, expect, it, vi } from "vitest";

// Subcontract end to end over the demo SQLite database (never the shared MySQL):
// work order → approval (advance payable) → measurement book → check → RA bill → payable →
// close → retention release.
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
let vendorId = "";
let woId = "";
let concrete = "";
let shuttering = "";
let billId = "";

const isoDay = (offset: number) => {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() + offset);
  return date.toISOString().slice(0, 10);
};

describe("subcontract", () => {
  beforeAll(async () => {
    await setDemoDriver(createNodeDriver());
    await ensureDemoData();
    [owner, manager, supervisor, accounts, auditor] = await Promise.all(
      ["owner", "manager", "supervisor", "accounts", "auditor"].map(signIn),
    );
    siteId = (await owner.jp.workspace.mySites()).find((s) => s.code === "PATIA-A")!.id;
    vendorId = (await manager.jp.subcontract.options({ siteId })).find((v) =>
      v.name.startsWith("Jagannath"),
    )!.id;
  }, 120_000);

  it("sample data: RA-01 approved with exact amounts and posted as a payable", async () => {
    const list = await owner.jp.subcontract.list({ siteId });
    const sample = list.find((wo) => wo.title.startsWith("Brickwork"))!;
    expect(sample).toMatchObject({ status: "Approved", toCheck: 1 });
    const detail = await owner.jp.subcontract.detail({ siteId, woId: sample.id });
    const [ra1] = detail.bills;
    // (44.505 − 2.898) cum × ₹1,850 = ₹76,972.95; GST 18%, retention 5%, TDS 1%, advance 20%
    expect(ra1).toMatchObject({
      billNumber: `${sample.woNumber}/RA-01`,
      status: "Approved",
      workValueMinor: "7697295",
      gstMinor: "1385513",
      retentionMinor: "384865",
      tdsMinor: "76973",
      advanceRecoveryMinor: "1539459",
      netPayableMinor: "7081511",
    });
    expect(detail.position.advanceOutstandingMinor).toBe(String(5_000_000 - 1_539_459));
    const invoices = await accounts.jp.finance.listInvoices({ siteId });
    const payable = JSON.stringify(invoices);
    expect(payable).toContain(`${sample.woNumber}/RA-01`);
    expect(payable).toContain(`${sample.woNumber}/ADV`);
    const inbox = await owner.jp.workspace.inbox();
    expect(inbox.items.some((item) => item.kind === "subcontract.check")).toBe(true);
  });

  it("only a Subcontractor-type firm can get a work order; the server values it", async () => {
    const supplier = (await manager.jp.purchase.options({ siteId })).vendors.find(
      (v) => v.vendorType === "Material Supplier",
    )!;
    const base = {
      siteId,
      title: "RCC columns and slab, Block 2",
      startDate: isoDay(-5),
      gstPercent: "18",
      retentionPercent: "5",
      tdsPercent: "2",
      items: [
        {
          itemCode: "C1",
          description: "M25 concrete placing",
          unit: "cum",
          quantity: "40",
          rateRupees: "650",
        },
        {
          itemCode: "C2",
          description: "Shuttering",
          unit: "sqm",
          quantity: "300",
          rateRupees: "120.50",
        },
      ],
    };
    await expect(
      manager.jp.subcontract.create({
        ...base,
        vendorId: supplier.id,
        clientMutationId: mutationId(),
      }),
    ).rejects.toThrow(/Subcontractor/);
    await expect(
      manager.jp.subcontract.create({
        ...base,
        vendorId,
        advanceRupees: "10000",
        clientMutationId: mutationId(),
      }),
    ).rejects.toThrow(/recovers the advance/);
    const created = await manager.jp.subcontract.create({
      ...base,
      vendorId,
      clientMutationId: mutationId(),
    });
    woId = created.id;
    expect(created.woNumber).toMatch(/^WO-PATIA-A-\d{3}$/);
    const detail = await manager.jp.subcontract.detail({ siteId, woId });
    // 40 × 650 = 26,000 + 300 × 120.50 = 36,150 → 62,150
    expect(detail.order.valueMinor).toBe("6215000");
    concrete = detail.items.find((i) => i.itemCode === "C1")!.id;
    shuttering = detail.items.find((i) => i.itemCode === "C2")!.id;
  });

  it("no measuring before approval; maker cannot approve; supervisor cannot approve", async () => {
    await expect(
      supervisor.jp.subcontract.measure({
        siteId,
        woId,
        itemId: concrete,
        measuredOn: isoDay(-1),
        location: "Column C1-C4",
        length: "2",
        clientMutationId: mutationId(),
      }),
    ).rejects.toThrow(/approved work order/);
    await manager.jp.subcontract.transition({
      siteId,
      woId,
      action: "submit",
      clientMutationId: mutationId(),
    });
    await expect(
      manager.jp.subcontract.transition({
        siteId,
        woId,
        action: "approve",
        clientMutationId: mutationId(),
      }),
    ).rejects.toThrow(/different person/);
    await expect(
      supervisor.jp.subcontract.transition({
        siteId,
        woId,
        action: "approve",
        clientMutationId: mutationId(),
      }),
    ).rejects.toThrow(/subcontract.approve/);
    const inbox = await owner.jp.workspace.inbox();
    expect(inbox.items.some((i) => i.kind === "subcontract.review" && i.route.includes(woId))).toBe(
      true,
    );
    await owner.jp.subcontract.transition({
      siteId,
      woId,
      action: "approve",
      clientMutationId: mutationId(),
    });
  });

  it("measurement book: L × B × D, cannot pass the ordered quantity, checker must be someone else", async () => {
    const m1 = await supervisor.jp.subcontract.measure({
      siteId,
      woId,
      itemId: concrete,
      measuredOn: isoDay(-2),
      location: "Columns C1-C12, GF",
      nos: "12",
      length: "0.3",
      breadth: "0.45",
      depth: "3.2",
      clientMutationId: mutationId(),
    });
    // 12 × 0.3 × 0.45 × 3.2 = 5.184 cum
    expect(m1.quantityThousandths).toBe("5184");
    await expect(
      supervisor.jp.subcontract.measure({
        siteId,
        woId,
        itemId: concrete,
        measuredOn: isoDay(-1),
        location: "Slab",
        length: "35",
        clientMutationId: mutationId(),
      }),
    ).rejects.toThrow(/past the work-order quantity/);
    await expect(
      supervisor.jp.subcontract.measure({
        siteId,
        woId,
        itemId: concrete,
        measuredOn: isoDay(2),
        location: "Slab",
        length: "1",
        clientMutationId: mutationId(),
      }),
    ).rejects.toThrow(/future/);
    const m2 = await supervisor.jp.subcontract.measure({
      siteId,
      woId,
      itemId: shuttering,
      measuredOn: isoDay(-1),
      location: "Column sides C1-C12",
      length: "100",
      clientMutationId: mutationId(),
    });
    await expect(
      supervisor.jp.subcontract.checkMeasurement({
        siteId,
        measurementIds: [m1.id],
        action: "check",
        clientMutationId: mutationId(),
      }),
    ).rejects.toThrow(/subcontract.approve/);
    await expect(
      manager.jp.subcontract.checkMeasurement({
        siteId,
        measurementIds: [m2.id],
        action: "reject",
        clientMutationId: mutationId(),
      }),
    ).rejects.toThrow(/why/);
    await manager.jp.subcontract.checkMeasurement({
      siteId,
      measurementIds: [m2.id],
      action: "reject",
      reason: "Measured on drawing, not on site",
      clientMutationId: mutationId(),
    });
    await manager.jp.subcontract.checkMeasurement({
      siteId,
      measurementIds: [m1.id],
      action: "check",
      clientMutationId: mutationId(),
    });
    const detail = await owner.jp.subcontract.detail({ siteId, woId });
    expect(detail.items.find((i) => i.id === shuttering)?.measuredThousandths).toBe("0");
    expect((await accounts.jp.subcontract.detail({ siteId, woId })).can.bill).toBe(true);
    expect((await supervisor.jp.subcontract.detail({ siteId, woId })).can.bill).toBe(false);
  });

  it("RA bill only from checked measurements; approval posts the payable; cancel frees them", async () => {
    const preview = await accounts.jp.subcontract.billPreview({
      siteId,
      woId,
      periodTo: isoDay(0),
    });
    expect(preview.measurementCount).toBe(1);
    // 5.184 × 650 = 3,369.60; GST 606.53; retention 168.48; TDS 2% 67.39 → 3,740.26
    expect(preview.totals).toMatchObject({
      workValueMinor: "336960",
      gstMinor: "60653",
      retentionMinor: "16848",
      tdsMinor: "6739",
      netPayableMinor: "374026",
    });
    await expect(
      accounts.jp.subcontract.createBill({
        siteId,
        woId,
        billDate: isoDay(0),
        periodTo: isoDay(0),
        otherDeductionRupees: "100",
        clientMutationId: mutationId(),
      }),
    ).rejects.toThrow(/other deduction/);
    const first = await accounts.jp.subcontract.createBill({
      siteId,
      woId,
      billDate: isoDay(0),
      periodTo: isoDay(0),
      clientMutationId: mutationId(),
    });
    expect(first.billNumber).toMatch(/\/RA-01$/);
    // Nothing left to bill until it is cancelled.
    await expect(
      accounts.jp.subcontract.createBill({
        siteId,
        woId,
        billDate: isoDay(0),
        periodTo: isoDay(0),
        clientMutationId: mutationId(),
      }),
    ).rejects.toThrow(/no checked measurements/);
    await accounts.jp.subcontract.billTransition({
      siteId,
      billId: first.id,
      action: "cancel",
      reason: "Wrong date",
      clientMutationId: mutationId(),
    });
    const again = await accounts.jp.subcontract.createBill({
      siteId,
      woId,
      billDate: isoDay(0),
      periodTo: isoDay(0),
      clientMutationId: mutationId(),
    });
    billId = again.id;
    expect(again.billNumber).toMatch(/\/RA-02$/);
    await expect(
      accounts.jp.subcontract.billTransition({
        siteId,
        billId,
        action: "approve",
        clientMutationId: mutationId(),
      }),
    ).rejects.toThrow(/subcontract.approve/);
    await owner.jp.subcontract.billTransition({
      siteId,
      billId,
      action: "approve",
      clientMutationId: mutationId(),
    });
    const bill = await accounts.jp.subcontract.billDetail({ siteId, billId });
    expect(bill.bill.status).toBe("Approved");
    expect(bill.invoice).toMatchObject({ status: "Approved", invoiceNumber: again.billNumber });
    const invoice = await accounts.jp.finance.invoiceDetail({
      siteId,
      invoiceId: bill.invoice!.id,
    });
    expect(JSON.stringify(invoice)).toContain("374026");
    // Accounts pays exactly the net payable through supplier payments; more is refused.
    const payable = {
      siteId,
      vendorId,
      paymentDate: isoDay(0),
      paymentMode: "Bank Transfer",
      paidByName: "JP Infracon accounts",
      fundingSourceLabel: "Current account",
      category: "Subcontract",
      purpose: `RA bill ${again.billNumber}`,
      externalReference: "UTR 2026110500077",
    };
    await expect(
      accounts.jp.finance.payments.createPayment({
        ...payable,
        amountRupees: "3740.27",
        allocations: [{ invoiceId: bill.invoice!.id, amountRupees: "3740.27" }],
        clientMutationId: mutationId(),
      }),
    ).rejects.toThrow();
    const payment = await accounts.jp.finance.payments.createPayment({
      ...payable,
      amountRupees: "3740.26",
      allocations: [{ invoiceId: bill.invoice!.id, amountRupees: "3740.26" }],
      clientMutationId: mutationId(),
    });
    await accounts.jp.finance.payments.submitPayment({
      siteId,
      paymentId: payment.id,
      clientMutationId: mutationId(),
    });
    await manager.jp.finance.payments.reviewPayment({
      siteId,
      paymentId: payment.id,
      decision: "Approved",
      reason: "Matches RA bill",
      clientMutationId: mutationId(),
    });
    await owner.jp.finance.payments.postPayment({
      siteId,
      paymentId: payment.id,
      clientMutationId: mutationId(),
    });
    const posted = await owner.jp.finance.payments.paymentDetail({ siteId, paymentId: payment.id });
    expect(posted.payment.status).toBe("Posted");
  });

  it("close, then release retention once; auditor reads only; module off refuses", async () => {
    await expect(
      owner.jp.subcontract.releaseRetention({
        siteId,
        woId,
        reason: "Defects period over",
        clientMutationId: mutationId(),
      }),
    ).rejects.toThrow(/closed/);
    await owner.jp.subcontract.transition({
      siteId,
      woId,
      action: "close",
      reason: "Work complete",
      clientMutationId: mutationId(),
    });
    const released = await owner.jp.subcontract.releaseRetention({
      siteId,
      woId,
      reason: "Defects period over",
      clientMutationId: mutationId(),
    });
    expect(released.amountMinor).toBe("16848");
    await expect(
      owner.jp.subcontract.releaseRetention({
        siteId,
        woId,
        reason: "Again",
        clientMutationId: mutationId(),
      }),
    ).rejects.toThrow(/No retention/);
    expect((await auditor.jp.subcontract.list({ siteId })).length).toBeGreaterThan(0);
    await expect(
      auditor.jp.subcontract.create({
        siteId,
        vendorId,
        title: "Painting",
        startDate: isoDay(0),
        items: [{ description: "Paint", unit: "sqm", quantity: "1", rateRupees: "1" }],
        clientMutationId: mutationId(),
      }),
    ).rejects.toThrow(/subcontract.create/);
    await owner.jp.modules.update({ disabled: ["subcontract"] });
    try {
      await expect(owner.jp.subcontract.list({ siteId })).rejects.toThrow(/turned off/);
    } finally {
      await owner.jp.modules.update({ disabled: [] });
    }
  });
});
