import { beforeAll, describe, expect, it, vi } from "vitest";

// Quality test register and cement/steel reconciliation over the demo database.
vi.mock("../../server/db", () => import("./server/db"));
vi.mock("../../server/_core/sdk", () => import("./server/sdk"));
vi.mock("../../server/storage", () => import("./server/storage"));

const { setDemoDriver } = await import("./runtime");
const { createNodeDriver } = await import("./testing/node-driver");
const { ensureDemoData } = await import("./backend");
const { signIn, mutationId } = await import("./seed");

type Caller = Awaited<ReturnType<typeof signIn>>;
let owner: Caller, supervisor: Caller;
let siteId = "";
const today = new Date(Date.now() + 330 * 60_000).toISOString().slice(0, 10);
const ago = (n: number) =>
  new Date(Date.parse(`${today}T00:00:00Z`) - n * 86_400_000).toISOString().slice(0, 10);

describe("quality and reconciliation", () => {
  beforeAll(async () => {
    await setDemoDriver(createNodeDriver());
    await ensureDemoData();
    [owner, supervisor] = await Promise.all(["owner", "supervisor"].map(signIn));
    siteId = (await supervisor.jp.workspace.mySites()).find((s) => s.code === "PATIA-A")!.id;
  }, 120_000);

  it("creates a cube set with 7 and 28 day tests; the server judges the result", async () => {
    await supervisor.jp.quality.addCubeSet({
      siteId,
      grade: "M20",
      location: "Slab S2",
      castOn: ago(30),
      slump: "80",
      clientMutationId: mutationId(),
    });
    let list = await supervisor.jp.quality.list({ siteId });
    const seven = list.tests.find(
      (x) => x.testType === "Concrete cube 7-day" && x.location === "Slab S2",
    )!;
    const twentyEight = list.tests.find(
      (x) => x.testType === "Concrete cube 28-day" && x.location === "Slab S2",
    )!;
    expect(seven.dueDate).toBe(ago(23));
    expect(twentyEight.state).toBe("Overdue");
    expect(list.tests.find((x) => x.testType === "Slump" && x.location === "Slab S2")!.pass).toBe(
      "Yes",
    );
    const bad = await supervisor.jp.quality.recordResult({
      siteId,
      id: twentyEight.id,
      results: "24, 24, 16.5",
      labName: "Govt lab Berhampur",
    });
    expect(bad.pass).toBe("No");
    await expect(
      supervisor.jp.quality.recordResult({ siteId, id: twentyEight.id, results: "25" }),
    ).rejects.toThrow(/already/);
    list = await supervisor.jp.quality.list({ siteId });
    expect(list.summary.failed).toBeGreaterThanOrEqual(1);
  });

  it("reconciles cement against measured work once coefficients are set", async () => {
    const [company] = await owner.jp.accounts.options();
    const project = await owner.jp.sitesAdmin.createProject({
      organizationId: company!.id,
      projectCode: "QR-T",
      name: "Reconciliation test",
      clientMutationId: mutationId(),
    });
    await owner.jp.sitesAdmin.createSite({
      projectId: project.id,
      siteCode: "QR-S1",
      name: "QR site",
      clientMutationId: mutationId(),
    });
    const client = await owner.jp.crm.clients.create({
      name: "PWD Aska",
      clientType: "Government",
      clientMutationId: mutationId(),
    });
    await owner.jp.billing.contract.save({
      projectId: project.id,
      clientId: client.id,
      gstPercent: "18",
      retentionPercent: "5",
      tdsPercent: "2",
    });
    await owner.jp.billing.contract.addItems({
      projectId: project.id,
      items: [
        {
          itemCode: "4.1",
          description: "RCC M20",
          unit: "cum",
          quantity: "50",
          rateRupees: "8000",
        },
      ],
      clientMutationId: mutationId(),
    });
    const itemId = (await owner.jp.billing.contract.get({ projectId: project.id })).items[0]!.id;
    await owner.jp.deptMb.record({
      projectId: project.id,
      contractItemId: itemId,
      measuredOn: today,
      location: "Slab",
      nos: "1",
      length: "10",
      breadth: "1",
      clientMutationId: mutationId(),
    });
    await owner.jp.quality.setCoefficient({
      projectId: project.id,
      contractItemId: itemId,
      material: "Cement",
      perUnit: "8.07",
    });
    const rec = await owner.jp.quality.reconciliation({ projectId: project.id });
    const cement = rec.materials.find((m) => m.material === "Cement")!;
    expect(cement.theoreticalThousandths).toBe("80700");
    expect(rec.items[0]!.cement).toBe("8070");
  });
});
