import { beforeAll, describe, expect, it, vi } from "vitest";

// Task assignment over the demo SQLite database (never the shared MySQL): who may assign, who
// may be chosen, and that Team tracking counts each person's tasks.
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
let taskId = "";
let supervisorId = 0;
const month = istDate(new Date()).slice(0, 7);

describe("Task assignment", () => {
  beforeAll(async () => {
    await setDemoDriver(createNodeDriver());
    await ensureDemoData();
    [owner, manager, supervisor, store] = await Promise.all(
      ["owner", "manager", "supervisor", "store"].map(signIn),
    );
    supervisorId = (await supervisor.auth.me())!.id;
    for (const site of await manager.jp.workspace.mySites()) {
      const tasks = await manager.jp.tasks.list({ siteId: site.id });
      const team = (await manager.jp.sitesAdmin.siteDetail({ siteId: site.id })).team;
      const open = tasks.find((task) => !["Completed", "Cancelled"].includes(task.status));
      if (open && team.some((member) => member.userId === supervisorId)) {
        siteId = site.id;
        taskId = open.id;
        break;
      }
    }
    expect(taskId).not.toBe("");
  }, 120_000);

  it("a project manager makes the supervisor responsible, with a crew, once", async () => {
    const crew = await manager.jp.crews.create({
      siteId,
      name: "Bar bending team",
      trade: "Bar bending",
      clientMutationId: mutationId(),
    });
    const key = mutationId();
    for (let i = 0; i < 2; i += 1)
      await manager.jp.tasks.assign({
        taskId,
        assigneeUserId: supervisorId,
        crewId: crew.id,
        clientMutationId: key,
      });
    const task = (await manager.jp.tasks.list({ siteId })).find((row) => row.id === taskId)!;
    expect(task.assigneeUserId).toBe(supervisorId);
    expect(task.assigneeName).toBeTruthy();
    expect(task.crewName).toBe("Bar bending team");
    // The change is in the audit log (task history shows schedule revisions only).
    const events = await owner.jp.workspace.auditEvents();
    expect(JSON.stringify(events)).toContain("task.assigned");
  });

  it("only people who manage tasks may assign, and only to this site's team", async () => {
    await expect(
      supervisor.jp.tasks.assign({
        taskId,
        assigneeUserId: null,
        crewId: null,
        clientMutationId: mutationId(),
      }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    const storeId = (await store.auth.me())!.id;
    const team = (await manager.jp.sitesAdmin.siteDetail({ siteId })).team;
    if (!team.some((member) => member.userId === storeId))
      await expect(
        manager.jp.tasks.assign({
          taskId,
          assigneeUserId: storeId,
          crewId: null,
          clientMutationId: mutationId(),
        }),
      ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });

  it("Team tracking counts the supervisor's tasks", async () => {
    const view = await owner.jp.tracking.overview({ siteId, month });
    const row = view.staff.find((person) => person.userId === supervisorId)!;
    expect(row.tasks.open + row.tasks.done).toBeGreaterThan(0);
  });
});
