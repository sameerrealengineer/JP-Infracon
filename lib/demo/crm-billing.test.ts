import { beforeAll, describe, expect, it, vi } from "vitest";

// CRM and client billing end to end over the demo SQLite database (never the shared MySQL).
vi.mock("../../server/db", () => import("./server/db"));
vi.mock("../../server/_core/sdk", () => import("./server/sdk"));
vi.mock("../../server/storage", () => import("./server/storage"));

const { setDemoDriver } = await import("./runtime");
const { createNodeDriver } = await import("./testing/node-driver");
const { ensureDemoData } = await import("./backend");
const { signIn, mutationId } = await import("./seed");

type Caller = Awaited<ReturnType<typeof signIn>>;
let owner: Caller, director: Caller, manager: Caller, accounts: Caller;
let supervisor: Caller, auditor: Caller;
let projectId = "";
let clientId = "";
let leadId = "";
let quotationId = "";
let billId = "";

describe("CRM and client billing", () => {
  beforeAll(async () => {
    await setDemoDriver(createNodeDriver());
    await ensureDemoData();
    [owner, director, manager, accounts, supervisor, auditor] = await Promise.all(
      ["owner", "director", "manager", "accounts", "supervisor", "auditor"].map(signIn),
    );
    // Its own project, so the demo sample contract does not get in the way.
    const organizationId = (await owner.jp.workspace.mySites())[0].organizationId;
    projectId = (
      await owner.jp.sitesAdmin.createProject({
        organizationId,
        projectCode: "KSQ-TEST",
        name: "Khurda Staff Quarters",
        clientMutationId: mutationId(),
      })
    ).id;
    const site = await owner.jp.sitesAdmin.createSite({
      projectId,
      siteCode: "KSQ-1",
      name: "Khurda Block 1",
      clientMutationId: mutationId(),
    });
    // Accounts and the project manager work on this project's site.
    for (const [caller, role] of [
      [accounts, "accounts"],
      [manager, "project_manager"],
    ] as const)
      await owner.jp.sitesAdmin.assignMember({
        siteId: site.id,
        userId: (await caller.auth.me())!.id,
        role,
        clientMutationId: mutationId(),
      });
  }, 120_000);

  it("manager adds a client and an enquiry, logs a follow-up and moves the stage", async () => {
    const key = mutationId();
    clientId = (
      await manager.jp.crm.clients.create({
        name: "Odisha Housing Board",
        clientType: "Government",
        phone: "9876501111",
        gstin: "21AAAGO1234A1Z5",
        clientMutationId: key,
      })
    ).id;
    // Same key again: same client, not a duplicate.
    expect(
      (
        await manager.jp.crm.clients.create({
          name: "Odisha Housing Board",
          clientType: "Government",
          clientMutationId: key,
        })
      ).id,
    ).toBe(clientId);
    leadId = (
      await manager.jp.crm.leads.create({
        title: "Staff quarters, Khurda",
        clientId,
        source: "Tender",
        estimatedValueRupees: "4500000",
        nextFollowUpOn: "2026-01-01",
        note: "Tender notice seen in newspaper",
        clientMutationId: mutationId(),
      })
    ).id;
    await manager.jp.crm.leads.addActivity({
      leadId,
      kind: "Site visit",
      note: "Visited the plot with the engineer",
      nextFollowUpOn: "2026-01-02",
      clientMutationId: mutationId(),
    });
    await manager.jp.crm.leads.move({
      leadId,
      stage: "Site visit",
      clientMutationId: mutationId(),
    });
    await expect(
      manager.jp.crm.leads.move({ leadId, stage: "Lost", clientMutationId: mutationId() }),
    ).rejects.toThrow(/why/);
    const { leads, pipeline, due } = await owner.jp.crm.leads.list({});
    expect(leads.find((l) => l.id === leadId)).toMatchObject({
      stage: "Site visit",
      followUpDue: true,
      clientName: "Odisha Housing Board",
    });
    expect(
      BigInt(pipeline.find((p) => p.stage === "Site visit")?.valueMinor ?? "0"),
    ).toBeGreaterThanOrEqual(450000000n);
    expect(due).toBeGreaterThanOrEqual(1);
    const detail = await owner.jp.crm.leads.detail({ leadId });
    expect(detail.activities.map((a) => a.kind)).toEqual(
      expect.arrayContaining(["Site visit", "Note"]),
    );
  });

  it("quotation totals are computed by the server; accepting it wins the enquiry", async () => {
    const created = await manager.jp.crm.quotations.create({
      clientId,
      leadId,
      title: "Civil works, staff quarters",
      quotationDate: "2026-11-01",
      validUntil: "2026-12-01",
      gstPercent: "18",
      lines: [
        {
          itemCode: "1.1",
          description: "PCC M15",
          unit: "cum",
          quantity: "100",
          rateRupees: "5400",
        },
        {
          itemCode: "2.1",
          description: "Brickwork",
          unit: "cum",
          quantity: "250.5",
          rateRupees: "6200.50",
        },
      ],
      clientMutationId: mutationId(),
    });
    quotationId = created.id;
    expect(created.quotationNumber).toMatch(/^QT-2026-\d{4}$/);
    const { quotation } = await owner.jp.crm.quotations.detail({ quotationId });
    // 100 × 5,400 = 5,40,000; 250.5 × 6,200.50 = 15,53,225.25 → subtotal 20,93,225.25
    expect(quotation.subtotalMinor).toBe("209322525");
    expect(quotation.gstMinor).toBe("37678055"); // 18%, rounded to the paisa
    expect(quotation.totalMinor).toBe("247000580");
    await expect(
      manager.jp.crm.quotations.setStatus({
        quotationId,
        status: "Accepted",
        clientMutationId: mutationId(),
      }),
    ).rejects.toThrow(/Draft quotation cannot/);
    await manager.jp.crm.quotations.setStatus({
      quotationId,
      status: "Sent",
      clientMutationId: mutationId(),
    });
    await manager.jp.crm.quotations.setStatus({
      quotationId,
      status: "Accepted",
      clientMutationId: mutationId(),
    });
    expect((await owner.jp.crm.leads.detail({ leadId })).lead.stage).toBe("Won");
  });

  it("the accepted quotation becomes the project contract", async () => {
    await accounts.jp.billing.contract.fromQuotation({
      projectId,
      quotationId,
      retentionPercent: "5",
      tdsPercent: "2",
      clientMutationId: mutationId(),
    });
    const contract = await owner.jp.billing.contract.get({ projectId });
    expect(contract.contract).toMatchObject({
      clientName: "Odisha Housing Board",
      gstBps: 1800,
      retentionBps: 500,
      tdsBps: 200,
    });
    expect(contract.items.map((i) => i.itemCode)).toEqual(["1.1", "2.1"]);
    expect(contract.contractValueMinor).toBe("209322525");
  });

  it("RA bill: refuses more than the contract quantity, computes GST and deductions", async () => {
    const { items } = await owner.jp.billing.contract.get({ projectId });
    const pcc = items.find((i) => i.itemCode === "1.1")!;
    await expect(
      accounts.jp.billing.bills.create({
        projectId,
        billDate: "2026-11-03",
        lines: [{ contractItemId: pcc.id, quantity: "100.001" }],
        clientMutationId: mutationId(),
      }),
    ).rejects.toThrow(/above the contract quantity/);
    const bill = await accounts.jp.billing.bills.create({
      projectId,
      billDate: "2026-11-03",
      periodFrom: "2026-10-01",
      periodTo: "2026-10-31",
      lines: [{ contractItemId: pcc.id, quantity: "40" }],
      otherDeductionRupees: "1000",
      otherDeductionNote: "Water charges",
      clientMutationId: mutationId(),
    });
    billId = bill.id;
    expect(bill.billNumber).toMatch(/^RA-.+-01$/);
    const { bill: saved } = await owner.jp.billing.bills.detail({ billId });
    // 40 × 5,400 = 2,16,000 work; GST 38,880; retention 10,800; TDS 4,320; other 1,000
    expect(saved).toMatchObject({
      status: "Draft",
      workValueMinor: "21600000",
      gstMinor: "3888000",
      retentionMinor: "1080000",
      tdsMinor: "432000",
      otherDeductionMinor: "100000",
      netReceivableMinor: "23876000",
    });
    // Billed so far now counts this draft: 60 left of 100.
    const after = await owner.jp.billing.contract.get({ projectId });
    expect(after.items.find((i) => i.id === pcc.id)?.balanceThousandths).toBe("60000");
  });

  it("maker-checker: the maker submits, a different approver approves", async () => {
    await accounts.jp.billing.bills.transition({
      billId,
      action: "submit",
      clientMutationId: mutationId(),
    });
    await expect(
      accounts.jp.billing.bills.transition({
        billId,
        action: "approve",
        clientMutationId: mutationId(),
      }),
    ).rejects.toThrow(/billing.approve/);
    await director.jp.billing.bills.transition({
      billId,
      action: "approve",
      clientMutationId: mutationId(),
    });
    expect((await owner.jp.billing.bills.detail({ billId })).bill.status).toBe("Approved");
  });

  it("receipts: never more than outstanding; status and receivables are derived", async () => {
    await accounts.jp.billing.receipts.record({
      billId,
      amountRupees: "100000",
      receivedOn: "2026-11-04",
      mode: "Bank transfer",
      reference: "NEFT 1234",
      clientMutationId: mutationId(),
    });
    await expect(
      accounts.jp.billing.receipts.record({
        billId,
        amountRupees: "200000",
        receivedOn: "2026-11-04",
        mode: "Cheque",
        clientMutationId: mutationId(),
      }),
    ).rejects.toThrow(/more than what is outstanding/);
    const detail = await owner.jp.billing.bills.detail({ billId });
    expect(detail.payment).toMatchObject({
      paymentStatus: "Part paid",
      receivedMinor: "10000000",
      outstandingMinor: "13876000",
    });
    const receivables = await owner.jp.billing.receivables();
    expect(
      receivables.clients.find((client) => client.clientName === "Odisha Housing Board"),
    ).toMatchObject({ outstandingMinor: "13876000", retentionMinor: "1080000" });

    // Reversing the receipt puts the money back as outstanding.
    const receiptId = detail.receipts[0].id;
    await accounts.jp.billing.receipts.reverse({
      receiptId,
      reason: "Cheque bounced",
      clientMutationId: mutationId(),
    });
    expect((await owner.jp.billing.bills.detail({ billId })).payment?.paymentStatus).toBe("Unpaid");
  });

  it("roles: supervisor sees nothing; auditor reads but cannot change", async () => {
    await expect(supervisor.jp.crm.leads.list({})).rejects.toThrow(/crm.view/);
    await expect(supervisor.jp.billing.receivables()).rejects.toThrow(/billing.view/);
    expect((await auditor.jp.billing.bills.list({})).length).toBeGreaterThan(0);
    await expect(
      auditor.jp.crm.clients.create({
        name: "X Ltd",
        clientType: "Private company",
        clientMutationId: mutationId(),
      }),
    ).rejects.toThrow(/crm.manage/);
    const caps = await accounts.jp.workspace.myCapabilities();
    expect(caps.some((c) => c["billing.receipt"])).toBe(true);
    expect(caps.some((c) => c["billing.approve"])).toBe(false);
  });

  it("is refused while its module is off, and every change is audited", async () => {
    await owner.jp.modules.update({ disabled: ["billing"] });
    try {
      await expect(owner.jp.billing.receivables()).rejects.toThrow(/turned off/);
      expect((await owner.jp.workspace.myCapabilities()).every((c) => !c["billing.view"])).toBe(
        true,
      );
    } finally {
      await owner.jp.modules.update({ disabled: [] });
    }
    const audit = JSON.stringify(await owner.jp.workspace.auditEvents());
    for (const action of [
      "crm.lead_moved",
      "crm.quotation_created",
      "billing.bill_approve",
      "billing.receipt_reversed",
    ])
      expect(audit).toContain(action);
  });
});
