import { beforeAll, describe, expect, it, vi } from "vitest";

// Plant & machinery over the demo database through the real procedures.
vi.mock("../../server/db", () => import("./server/db"));
vi.mock("../../server/_core/sdk", () => import("./server/sdk"));
vi.mock("../../server/storage", () => import("./server/storage"));

const { setDemoDriver } = await import("./runtime");
const { createNodeDriver } = await import("./testing/node-driver");
const { ensureDemoData } = await import("./backend");
const { signIn, mutationId } = await import("./seed");

type Caller = Awaited<ReturnType<typeof signIn>>;
let manager: Caller, supervisor: Caller, accounts: Caller;
let siteId = "";
const today = new Date(Date.now() + 330 * 60_000).toISOString().slice(0, 10);
const ago = (n: number) =>
  new Date(Date.parse(`${today}T00:00:00Z`) - n * 86_400_000).toISOString().slice(0, 10);

describe("plant and machinery", () => {
  beforeAll(async () => {
    await setDemoDriver(createNodeDriver());
    await ensureDemoData();
    [manager, supervisor, accounts] = await Promise.all(
      ["manager", "supervisor", "accounts"].map(signIn),
    );
    siteId = (await manager.jp.workspace.mySites()).find((s) => s.code === "PATIA-A")!.id;
  }, 120_000);

  it("adds a hired JCB and logs days; meter readings must continue", async () => {
    await expect(
      manager.jp.plant.addEquipment({
        siteId,
        name: "JCB",
        equipmentType: "JCB / backhoe",
        ownership: "Hired",
        clientMutationId: mutationId(),
      }),
    ).rejects.toThrow(/hire basis/);
    const jcb = await manager.jp.plant.addEquipment({
      siteId,
      name: "JCB 3DX",
      equipmentType: "JCB / backhoe",
      ownership: "Hired",
      ownerName: "Maa Tarini Earthmovers",
      hireBasis: "Hour",
      hireRateRupees: "1200",
      hireFrom: ago(3),
      fuelNorm: "6",
      serviceIntervalHours: 250,
      currentMeter: "1000",
      clientMutationId: mutationId(),
    });
    expect(jcb.code).toMatch(/^EQ-\d{3}$/);
    await supervisor.jp.plant.log({
      equipmentId: jcb.id,
      siteId,
      logDate: ago(2),
      startMeter: "1240",
      endMeter: "1248",
      idle: "1",
      fuel: "45",
      operatorName: "Rabi",
      clientMutationId: mutationId(),
    });
    const high = await supervisor.jp.plant.log({
      equipmentId: jcb.id,
      siteId,
      logDate: ago(1),
      startMeter: "1248",
      endMeter: "1256",
      fuel: "60",
      clientMutationId: mutationId(),
    });
    expect(high.fuelHigh).toBe(true);
    await expect(
      supervisor.jp.plant.log({
        equipmentId: jcb.id,
        siteId,
        logDate: today,
        startMeter: "1250",
        endMeter: "1260",
        clientMutationId: mutationId(),
      }),
    ).rejects.toThrow(/below the last closing/);
    await expect(
      supervisor.jp.plant.log({
        equipmentId: jcb.id,
        siteId,
        logDate: ago(1),
        startMeter: "1256",
        endMeter: "1257",
        clientMutationId: mutationId(),
      }),
    ).rejects.toThrow(/already has a logsheet/);
    const reg = await manager.jp.plant.register({});
    const m = reg.machines.find((x) => x.id === jcb.id)!;
    expect(m.month.workingThousandths).toBe(
      ago(1).slice(0, 7) === today.slice(0, 7) && ago(2).slice(0, 7) === today.slice(0, 7)
        ? "15000"
        : m.month.workingThousandths,
    );
    expect(m.serviceLeftThousandths).toBe("-6000"); // serviced at 1000, due at 1250, now 1256
  });

  it("lets accounts view but not log", async () => {
    const reg = await accounts.jp.plant.register({});
    expect(reg.machines.length).toBeGreaterThan(0);
    const id = reg.machines[0]!.id;
    await expect(
      accounts.jp.plant.log({
        equipmentId: id,
        siteId,
        logDate: today,
        startMeter: "1",
        endMeter: "2",
        clientMutationId: mutationId(),
      }),
    ).rejects.toThrow(/plant.log/);
  });
});
