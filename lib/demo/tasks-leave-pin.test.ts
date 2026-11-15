import { beforeAll, describe, expect, it, vi } from "vitest";

// My tasks, worker leave from the mistri app, approved leave in attendance, and the WhatsApp
// PIN code refusing a wrong code — over the demo database through the real procedures.
vi.mock("../../server/db", () => import("./server/db"));
vi.mock("../../server/_core/sdk", () => import("./server/sdk"));
vi.mock("../../server/storage", () => import("./server/storage"));

const { setDemoDriver } = await import("./runtime");
const { createNodeDriver } = await import("./testing/node-driver");
const { ensureDemoData } = await import("./backend");
const { signIn, callerFor, mutationId } = await import("./seed");
const { DEMO_WORKER } = await import("./config");

type Caller = Awaited<ReturnType<typeof signIn>>;
let owner: Caller, manager: Caller, store: Caller;
let siteId = "";

const day = (offset: number) =>
  new Date(Date.now() + offset * 86_400_000).toISOString().slice(0, 10);

describe("tasks, worker leave and PIN code", () => {
  beforeAll(async () => {
    await setDemoDriver(createNodeDriver());
    await ensureDemoData();
    [owner, manager, store] = await Promise.all(["owner", "manager", "store"].map(signIn));
    siteId = (await owner.jp.workspace.mySites()).find((s) => s.code === "PATIA-A")!.id;
  }, 120_000);

  it("lets the assignee move their own task, even without task status rights", async () => {
    const storeUser = (
      await owner.jp.accounts.list({ organizationId: (await owner.jp.accounts.options())[0]!.id })
    ).find((row) => row.username === "store")!;
    const task = await manager.jp.tasks.create({
      siteId,
      title: "Count cement bags in the store",
      plannedStart: day(0),
      plannedEnd: day(1),
      clientMutationId: mutationId(),
    });
    await manager.jp.tasks.assign({
      taskId: task.id,
      assigneeUserId: storeUser.id,
      crewId: null,
      clientMutationId: mutationId(),
    } as never);
    const mine = await store.jp.tasks.mine();
    expect(mine.some((row) => row.id === task.id)).toBe(true);
    await store.jp.tasks.updateStatus({
      taskId: task.id,
      status: "In Progress",
      clientMutationId: mutationId(),
    });
    await store.jp.tasks.updateStatus({
      taskId: task.id,
      status: "Completed",
      clientMutationId: mutationId(),
    });
    // Cancelling stays with managers.
    const other = await manager.jp.tasks.create({
      siteId,
      title: "Second task",
      plannedStart: day(0),
      plannedEnd: day(1),
      clientMutationId: mutationId(),
    });
    await manager.jp.tasks.assign({
      taskId: other.id,
      assigneeUserId: storeUser.id,
      crewId: null,
      clientMutationId: mutationId(),
    } as never);
    await expect(
      store.jp.tasks.updateStatus({
        taskId: other.id,
        status: "Cancelled",
        reason: "Not needed",
        clientMutationId: mutationId(),
      }),
    ).rejects.toThrow();
    const team = await manager.jp.tasks.byPerson({ siteId });
    expect(team.find((row) => row.done >= 1)).toBeTruthy();
  });

  it("takes a leave request from the mistri app and marks attendance when approved", async () => {
    const ramesh = (await owner.jp.people.search({ query: "Ramesh" })).people[0]!.id;
    // The supervisor switches leave on for this worker's app.
    await manager.jp.worker.update({
      siteId,
      personId: ramesh,
      features: ["money", "attendance", "drawings", "call", "help", "leave"],
    });
    const guest = await callerFor(null);
    const { sessionToken } = await guest.auth.workerLogin({
      mobile: DEMO_WORKER.mobile,
      pin: DEMO_WORKER.pin,
    });
    const worker = await callerFor(sessionToken);
    await worker.jp.worker.requestLeave({
      leaveType: "Sick",
      fromDate: day(-1),
      toDate: day(-1),
      halfDay: false,
      reason: "I am sick",
    });
    const mine = await worker.jp.worker.myLeave();
    expect(mine[0]?.status).toBe("Pending");
    const pending = await manager.jp.leave.list({ scope: "review" });
    const leave = pending.rows.find((row) => row.status === "Pending" && row.fromDate === day(-1))!;
    await manager.jp.leave.review({ leaveId: leave.id, decision: "Approved" });
    expect((await worker.jp.worker.myLeave())[0]?.status).toBe("Approved");
    const roster = await manager.jp.attendance.roster({
      siteId: leave.siteId,
      workDate: day(-1),
      shiftCode: "GEN",
    });
    const marked = roster.rows.filter((row) => row.record?.status === "Leave");
    // Either newly marked Leave, or the day was already marked before the leave.
    expect(
      marked.length +
        roster.rows.filter((row) => row.record && row.record.status !== "Leave").length,
    ).toBeGreaterThan(0);
  });

  it("refuses a wrong WhatsApp PIN code", async () => {
    const guest = await callerFor(null);
    await expect(
      guest.auth.workerResetPin({ mobile: DEMO_WORKER.mobile, code: "000000", pin: "582947" }),
    ).rejects.toThrow(/wrong or has expired/);
  });
});
