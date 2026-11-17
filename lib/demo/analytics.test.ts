import { beforeAll, describe, expect, it, vi } from "vitest";

// Analytics over the demo database through the real procedures: sections follow permissions,
// money stays exact paise strings, and the Gantt/S-curve source works for a site.
vi.mock("../../server/db", () => import("./server/db"));
vi.mock("../../server/_core/sdk", () => import("./server/sdk"));
vi.mock("../../server/storage", () => import("./server/storage"));

const { setDemoDriver } = await import("./runtime");
const { createNodeDriver } = await import("./testing/node-driver");
const { ensureDemoData } = await import("./backend");
const { signIn } = await import("./seed");
const { sCurve, ganttRows } = await import("../jp/s-curve");

type Caller = Awaited<ReturnType<typeof signIn>>;
let owner: Caller, store: Caller;

describe("analytics", () => {
  beforeAll(async () => {
    await setDemoDriver(createNodeDriver());
    await ensureDemoData();
    [owner, store] = await Promise.all(["owner", "store"].map(signIn));
  }, 120_000);

  it("gives the owner every section with paise strings", async () => {
    const data = await owner.jp.analytics.overview({ days: 90 });
    expect(data.bucket).toBe("week");
    expect(data.moneyOut).not.toBeNull();
    expect(data.moneyOut!.totalMinor).toMatch(/^\d+$/);
    expect(data.payables).not.toBeNull();
    expect(data.labour).not.toBeNull();
    expect(data.materials).not.toBeNull();
    expect(data.progress).not.toBeNull();
    expect(data.labels.length).toBe(data.moneyOut!.series.Suppliers!.length);
  });

  it("hides money from the storekeeper but shows materials", async () => {
    const data = await store.jp.analytics.overview({ days: 30 });
    expect(data.payables).toBeNull();
    expect(data.labour?.costMinor ?? null).toBeNull();
    expect(data.materials).not.toBeNull();
  });

  it("refuses a site outside access and serves the Gantt source", async () => {
    await expect(
      owner.jp.analytics.overview({ days: 7, siteId: "00000000-0000-4000-8000-000000000000" }),
    ).rejects.toThrow(/outside your access/);
    const site = (await owner.jp.workspace.mySites()).find((s) => s.code === "PATIA-A")!;
    const schedule = await owner.jp.analytics.schedule({ siteId: site.id });
    expect(schedule.tasks.length).toBeGreaterThan(0);
    const curve = sCurve(schedule.tasks, schedule.reports, schedule.today);
    expect(curve.points.at(-1)!.planned).toBe(100);
    expect(ganttRows(schedule.tasks, schedule.today).rows.length).toBe(
      schedule.tasks.filter((t) => t.status !== "Cancelled").length,
    );
  });
});
