import { beforeAll, describe, expect, it, vi } from "vitest";

// Crews over the demo SQLite database (never the shared MySQL): the real server rules for
// trade-wise teams, members with history, daily deployments and labour cost per crew.
vi.mock("../../server/db", () => import("./server/db"));
vi.mock("../../server/_core/sdk", () => import("./server/sdk"));
vi.mock("../../server/storage", () => import("./server/storage"));

const { setDemoDriver } = await import("./runtime");
const { createNodeDriver } = await import("./testing/node-driver");
const { ensureDemoData } = await import("./backend");
const { signIn, mutationId } = await import("./seed");
const { istDate } = await import("../jp/tracking-domain");

type Caller = Awaited<ReturnType<typeof signIn>>;
let owner: Caller, manager: Caller, supervisor: Caller, store: Caller;
let siteId = "";
let crewId = "";
const today = istDate(new Date());
const month = today.slice(0, 7);

describe("Crews", () => {
  beforeAll(async () => {
    await setDemoDriver(createNodeDriver());
    await ensureDemoData();
    [owner, manager, supervisor, store] = await Promise.all(
      ["owner", "manager", "supervisor", "store"].map(signIn),
    );
    // The site where the demo has workers.
    const sites = await owner.jp.workspace.mySites();
    for (const site of sites) {
      const view = await owner.jp.crews.list({ siteId: site.id, month });
      if (view.freePeople.length >= 2) {
        siteId = site.id;
        break;
      }
    }
    expect(siteId).not.toBe("");
  }, 120_000);

  it("a supervisor makes a crew once, even when the request is sent twice", async () => {
    const key = mutationId();
    const first = await supervisor.jp.crews.create({
      siteId,
      name: "Shuttering team 1",
      trade: "Shuttering",
      clientMutationId: key,
    });
    const again = await supervisor.jp.crews.create({
      siteId,
      name: "Shuttering team 1",
      trade: "Shuttering",
      clientMutationId: key,
    });
    expect(again.id).toBe(first.id);
    crewId = first.id;
    await expect(
      supervisor.jp.crews.create({
        siteId,
        name: "Shuttering team 1",
        trade: "Shuttering",
        clientMutationId: mutationId(),
      }),
    ).rejects.toMatchObject({ code: "CONFLICT" });
    await expect(store.jp.crews.list({ siteId, month })).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
  });

  it("keeps a worker in one open crew and keeps history when they leave", async () => {
    const view = await supervisor.jp.crews.list({ siteId, month });
    const [a, b] = view.freePeople;
    for (const person of [a, b])
      await supervisor.jp.crews.addMember({
        crewId,
        personId: person.id,
        clientMutationId: mutationId(),
      });
    const second = await supervisor.jp.crews.create({
      siteId,
      name: "Masonry team",
      trade: "Masonry",
      clientMutationId: mutationId(),
    });
    await expect(
      supervisor.jp.crews.addMember({
        crewId: second.id,
        personId: a.id,
        clientMutationId: mutationId(),
      }),
    ).rejects.toMatchObject({ code: "CONFLICT" });
    await supervisor.jp.crews.removeMember({
      crewId,
      personId: b.id,
      clientMutationId: mutationId(),
    });
    const after = await supervisor.jp.crews.list({ siteId, month });
    const crew = after.crews.find((row) => row.id === crewId)!;
    expect(crew.members.map((row) => row.personId)).toEqual([a.id]);
    expect(crew.formerCount).toBe(1);
    // b left, so b is free again and can join the other crew.
    expect(after.freePeople.some((row) => row.id === b.id)).toBe(true);
    await supervisor.jp.crews.addMember({
      crewId: second.id,
      personId: b.id,
      clientMutationId: mutationId(),
    });
  });

  it("records a day's deployment on a task and refuses future days", async () => {
    const view = await supervisor.jp.crews.list({ siteId, month });
    const taskId = view.tasks[0]?.id ?? null;
    const key = mutationId();
    const first = await supervisor.jp.crews.deploy({
      crewId,
      workDate: today,
      taskId,
      headcount: 1,
      clientMutationId: key,
    });
    const again = await supervisor.jp.crews.deploy({
      crewId,
      workDate: today,
      taskId,
      headcount: 1,
      clientMutationId: key,
    });
    expect(again.id).toBe(first.id);
    const tomorrow = new Date(Date.parse(`${today}T00:00:00Z`) + 86_400_000)
      .toISOString()
      .slice(0, 10);
    await expect(
      supervisor.jp.crews.deploy({
        crewId,
        workDate: tomorrow,
        taskId: null,
        headcount: 1,
        clientMutationId: mutationId(),
      }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    const after = await manager.jp.crews.list({ siteId, month });
    const crew = after.crews.find((row) => row.id === crewId)!;
    expect(crew.deployedToday).toBe(true);
    expect(crew.deployments).toHaveLength(1);
  });

  it("shows labour cost only to people with payroll rights, and closing ends membership", async () => {
    expect((await supervisor.jp.crews.list({ siteId, month })).canSeeMoney).toBe(false);
    const ownerView = await owner.jp.crews.list({ siteId, month });
    expect(ownerView.canSeeMoney).toBe(true);
    expect(ownerView.crews.every((row) => row.costMinor !== null)).toBe(true);
    await expect(
      supervisor.jp.crews.close({ crewId, reason: "x", clientMutationId: mutationId() }),
    ).rejects.toBeTruthy();
    await supervisor.jp.crews.close({
      crewId,
      reason: "Shuttering work finished",
      clientMutationId: mutationId(),
    });
    const closed = (await owner.jp.crews.list({ siteId, month })).crews.find(
      (row) => row.id === crewId,
    )!;
    expect(closed.status).toBe("Closed");
    expect(closed.members).toHaveLength(0);
    await expect(
      supervisor.jp.crews.deploy({
        crewId,
        workDate: today,
        taskId: null,
        headcount: 1,
        clientMutationId: mutationId(),
      }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });
});
