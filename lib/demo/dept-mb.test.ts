import { beforeAll, describe, expect, it, vi } from "vitest";

// Department MB over the demo database: measurements against the contract BOQ, the department
// engineer's signature, and client billing refusing quantities that are not signed.
vi.mock("../../server/db", () => import("./server/db"));
vi.mock("../../server/_core/sdk", () => import("./server/sdk"));
vi.mock("../../server/storage", () => import("./server/storage"));

const { setDemoDriver } = await import("./runtime");
const { createNodeDriver } = await import("./testing/node-driver");
const { ensureDemoData } = await import("./backend");
const { signIn, mutationId } = await import("./seed");

type Caller = Awaited<ReturnType<typeof signIn>>;
let owner: Caller;
let projectId = "";
let itemId = "";
const today = new Date(Date.now() + 330 * 60_000).toISOString().slice(0, 10);

describe("department measurement book", () => {
  beforeAll(async () => {
    await setDemoDriver(createNodeDriver());
    await ensureDemoData();
    owner = await signIn("owner");
    const [company] = await owner.jp.accounts.options();
    const project = await owner.jp.sitesAdmin.createProject({
      organizationId: company!.id,
      projectCode: "MB-TEST",
      name: "OHT repainting (MB test)",
      clientMutationId: mutationId(),
    });
    projectId = project.id;
    await owner.jp.sitesAdmin.createSite({
      projectId,
      siteCode: "MB-OHT1",
      name: "OHT 1",
      clientMutationId: mutationId(),
    });
    const client = await owner.jp.crm.clients.create({
      name: "RWSS Division Berhampur",
      clientType: "Government",
      clientMutationId: mutationId(),
    });
    await owner.jp.billing.contract.save({
      projectId,
      clientId: client.id,
      gstPercent: "18",
      retentionPercent: "5",
      tdsPercent: "2",
    });
    await owner.jp.billing.contract.addItems({
      projectId,
      items: [
        {
          itemCode: "2.1",
          description: "Painting OHT exterior with cement paint",
          unit: "sqm",
          quantity: "1000",
          rateRupees: "120",
        },
      ],
      clientMutationId: mutationId(),
    });
    itemId = (await owner.jp.billing.contract.get({ projectId })).items[0]!.id;
  }, 120_000);

  it("records measurements, signs some, and shows the abstract", async () => {
    const a = await owner.jp.deptMb.record({
      projectId,
      contractItemId: itemId,
      measuredOn: today,
      location: "OHT-1 container",
      nos: "1",
      length: "25.12",
      breadth: "4",
      clientMutationId: mutationId(),
    });
    await owner.jp.deptMb.record({
      projectId,
      contractItemId: itemId,
      measuredOn: today,
      location: "OHT-1 columns",
      nos: "6",
      length: "1.41",
      breadth: "12",
      clientMutationId: mutationId(),
    });
    await expect(
      owner.jp.deptMb.sign({
        ids: [a.id],
        signedByName: "Er. P. Sahu",
        signedByDesignation: "JE",
        signedOn: "2099-01-01",
        mbReference: "MB 214 p.37",
      }),
    ).rejects.toThrow(/future/);
    await owner.jp.deptMb.sign({
      ids: [a.id],
      signedByName: "Er. P. Sahu",
      signedByDesignation: "JE",
      signedOn: today,
      mbReference: "MB 214 p.37",
    });
    const view = await owner.jp.deptMb.list({ projectId });
    const row = view.items[0]!;
    // 25.12 × 4 = 100.48 signed; columns 6 × 1.41 × 12 = 101.52 recorded only.
    expect(row.signedThousandths).toBe("100480");
    expect(row.measuredThousandths).toBe("202000");
    expect(row.toBillThousandths).toBe("100480");
  });

  it("refuses to bill more than the signed quantity, allows up to it", async () => {
    await expect(
      owner.jp.billing.bills.create({
        projectId,
        billDate: today,
        lines: [{ contractItemId: itemId, quantity: "150" }],
        clientMutationId: mutationId(),
      }),
    ).rejects.toThrow(/signed in the department MB/);
    const bill = await owner.jp.billing.bills.create({
      projectId,
      billDate: today,
      lines: [{ contractItemId: itemId, quantity: "100.48" }],
      clientMutationId: mutationId(),
    });
    expect(bill.billNumber).toBeTruthy();
    const after = await owner.jp.deptMb.list({ projectId });
    expect(after.items[0]!.toBillThousandths).toBe("0");
  });
});
