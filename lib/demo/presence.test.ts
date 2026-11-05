import { beforeAll, describe, expect, it, vi } from "vitest";

// GPS alerts over the demo SQLite database: site working hours decide whether leaving the site
// alerts anyone; only site managers change the rules; phones report whether tracking is on.
vi.mock("../../server/db", () => import("./server/db"));
vi.mock("../../server/_core/sdk", () => import("./server/sdk"));
vi.mock("../../server/storage", () => import("./server/storage"));

const { setDemoDriver } = await import("./runtime");
const { createNodeDriver } = await import("./testing/node-driver");
const { ensureDemoData } = await import("./backend");
const { signIn, mutationId } = await import("./seed");
const { istClock } = await import("../jp/presence-rules");

type Caller = Awaited<ReturnType<typeof signIn>>;
let owner: Caller, manager: Caller, supervisor: Caller;
let siteId = "";

const allDays = [0, 1, 2, 3, 4, 5, 6];

describe("GPS alerts", () => {
  beforeAll(async () => {
    await setDemoDriver(createNodeDriver());
    await ensureDemoData();
    [owner, manager, supervisor] = await Promise.all(
      ["owner", "manager", "supervisor"].map(signIn),
    );
    siteId = (await owner.jp.workspace.mySites()).find((s) => s.code === "PATIA-A")!.id;
  }, 120_000);

  it("leaving on a working day alerts; on a day off it is only recorded", async () => {
    const view = await owner.jp.presence.siteSettings({ siteId });
    expect(view).toMatchObject({ hasBoundary: true, saved: false });
    expect(view.settings).toMatchObject({ workStart: "08:00", alertOnLeave: true });
    await owner.jp.presence.saveSiteSettings({
      siteId,
      workStart: "00:00",
      workEnd: "23:59",
      workDays: allDays,
      alertOnLeave: true,
      alertOnArrive: false,
      recipientUserIds: [],
    });
    const now = new Date(Date.now() - 60_000);
    const left = await supervisor.jp.presence.record({
      siteId,
      eventType: "Left",
      occurredAt: now,
      clientMutationId: mutationId(),
    });
    expect(left.alerted).toBe(true);
    const arrived = await supervisor.jp.presence.record({
      siteId,
      eventType: "Arrived",
      occurredAt: now,
      clientMutationId: mutationId(),
    });
    expect(arrived.alerted).toBe(false);
    const today = istClock(now).day;
    await owner.jp.presence.saveSiteSettings({
      siteId,
      workStart: "00:00",
      workEnd: "23:59",
      workDays: allDays.filter((day) => day !== today),
      alertOnLeave: true,
      alertOnArrive: false,
      recipientUserIds: [],
    });
    const offDay = await supervisor.jp.presence.record({
      siteId,
      eventType: "Left",
      occurredAt: now,
      clientMutationId: mutationId(),
    });
    expect(offDay.alerted).toBe(false);
  });

  it("only site managers change the rules; bad times and outside people are refused", async () => {
    const base = {
      siteId,
      workStart: "08:00",
      workEnd: "18:00",
      workDays: [1, 2, 3, 4, 5, 6],
      alertOnLeave: true,
      alertOnArrive: false,
      recipientUserIds: [] as number[],
    };
    await expect(supervisor.jp.presence.saveSiteSettings(base)).rejects.toThrow();
    await expect(owner.jp.presence.saveSiteSettings({ ...base, workEnd: "07:00" })).rejects.toThrow(
      /after/,
    );
    await expect(
      owner.jp.presence.saveSiteSettings({ ...base, recipientUserIds: [999_999] }),
    ).rejects.toThrow(/your company/);
    const view = await owner.jp.presence.siteSettings({ siteId });
    const supervisorChoice = view.choices.find((c) => c.role === "supervisor")!;
    await owner.jp.presence.saveSiteSettings({
      ...base,
      recipientUserIds: [supervisorChoice.userId],
    });
    expect((await owner.jp.presence.siteSettings({ siteId })).recipients).toEqual([
      supervisorChoice.userId,
    ]);
  });

  it("shows who has tracking on, as the phone reports it", async () => {
    await supervisor.jp.presence.reportTracking({
      enabled: true,
      fenceCount: 1,
      platform: "android",
    });
    await manager.jp.presence.reportTracking({ enabled: false, fenceCount: 0 });
    const view = await owner.jp.presence.siteSettings({ siteId });
    const sup = view.team.find((p) => p.role === "supervisor")!;
    expect(sup.tracking).toBe(true);
    expect(sup.lastEvent?.eventType).toBeTruthy();
    const pm = view.team.find((p) => p.role === "project_manager");
    if (pm) expect(pm.tracking).toBe(false);
  });
});
