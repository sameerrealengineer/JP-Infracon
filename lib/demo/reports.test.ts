import { beforeAll, describe, expect, it, vi } from "vitest";

// Problem reports over the demo SQLite database: a worker's forgotten PIN reaches the site
// manager's inbox and closes when a new PIN is set; worker "something is wrong"; staff reports;
// app errors from phones counted once per repeat; who may see and close them.
vi.mock("../../server/db", () => import("./server/db"));
vi.mock("../../server/_core/sdk", () => import("./server/sdk"));
vi.mock("../../server/storage", () => import("./server/storage"));

const { setDemoDriver } = await import("./runtime");
const { createNodeDriver } = await import("./testing/node-driver");
const { ensureDemoData } = await import("./backend");
const { signIn, callerFor } = await import("./seed");
const { DEMO_WORKER } = await import("./config");

type Caller = Awaited<ReturnType<typeof signIn>>;
let owner: Caller, manager: Caller, supervisor: Caller, store: Caller;
let siteId = "";
let rameshId = "";

async function workerCaller() {
  const guest = await callerFor(null);
  const { sessionToken } = await guest.auth.workerLogin({
    mobile: DEMO_WORKER.mobile,
    pin: DEMO_WORKER.pin,
  });
  return callerFor(sessionToken);
}

describe("problem reports", () => {
  beforeAll(async () => {
    await setDemoDriver(createNodeDriver());
    await ensureDemoData();
    [owner, manager, supervisor, store] = await Promise.all(
      ["owner", "manager", "supervisor", "store"].map(signIn),
    );
    siteId = (await owner.jp.workspace.mySites()).find((s) => s.code === "PATIA-A")!.id;
    rameshId = (await owner.jp.people.search({ query: "Ramesh" })).people[0].id;
  }, 120_000);

  it("a forgotten PIN reaches the manager's inbox and closes with the new PIN", async () => {
    const guest = await callerFor(null);
    const answer = await guest.auth.workerForgotPin({ mobile: `+91 ${DEMO_WORKER.mobile}` });
    expect(answer.message).toMatch(/supervisor has been told/);
    // An unknown number gets the very same answer and stores nothing.
    expect((await guest.auth.workerForgotPin({ mobile: "9000000001" })).message).toBe(
      answer.message,
    );
    // Asking again soon does not make a second request.
    await guest.auth.workerForgotPin({ mobile: DEMO_WORKER.mobile });
    await expect(guest.auth.workerForgotPin({ mobile: "12345" })).rejects.toThrow(/10-digit/);

    const inbox = (await manager.jp.workspace.inbox()).items;
    const pinItems = inbox.filter((item) => item.kind === "worker.help");
    expect(pinItems).toHaveLength(1);
    expect(pinItems[0]).toMatchObject({
      title: "Worker forgot PIN",
      route: `/person?id=${rameshId}`,
      siteId,
    });
    const listed = await manager.jp.feedback.list({ status: "Open", source: "pin_reset" });
    expect(listed.items).toHaveLength(1);
    expect(listed.items[0].who).toBe("Ramesh Behera");

    await manager.jp.worker.setLogin({
      siteId,
      personId: rameshId,
      mobile: DEMO_WORKER.mobile,
      pin: DEMO_WORKER.pin,
    });
    expect((await manager.jp.feedback.list({ status: "Open", source: "pin_reset" })).items).toEqual(
      [],
    );
    const done = await manager.jp.feedback.list({ status: "Resolved", source: "pin_reset" });
    expect(done.items[0].resolution).toBe("New PIN set");
    expect((await manager.jp.workspace.inbox()).items.some((i) => i.kind === "worker.help")).toBe(
      false,
    );
  });

  it("a worker reports a problem only when help is switched on", async () => {
    const worker = await workerCaller();
    // Ramesh's switched-on features do not include help yet.
    await expect(worker.jp.worker.reportProblem({ problem: "money" })).rejects.toThrow(
      /not switched on/,
    );
    await manager.jp.worker.update({
      siteId,
      personId: rameshId,
      features: ["money", "attendance", "drawings", "call", "help"],
    });
    expect((await worker.jp.worker.me()).features).toContain("help");
    await worker.jp.worker.reportProblem({ problem: "money" });
    const inbox = (await manager.jp.workspace.inbox()).items;
    const help = inbox.find((item) => item.kind === "worker.help");
    expect(help).toMatchObject({ title: "Worker needs help" });
    expect(help?.detail).toContain("Money is wrong");
    // The worker cannot read the company's reports.
    await expect(worker.jp.feedback.list({ status: "Open" })).rejects.toThrow();
  });

  it("staff reports and app errors are seen by leaders, not by people without review", async () => {
    await store.jp.feedback.send({
      category: "bug",
      message: "Stock page shows a blank card",
      appVersion: "1.5.0",
      platform: "android",
    });
    const guest = await callerFor(null);
    for (let i = 0; i < 3; i += 1)
      await guest.jp.feedback.appError({
        message: `Cannot read property 'x' of undefined (row ${i})`,
        stack: "TypeError\n at fn (file:///data/user/0/x/index.bundle:1:2)",
        screen: "/inventory",
        appVersion: "1.5.0",
        platform: "android",
      });
    await supervisor.jp.feedback.appError({ message: "Render failed", screen: "/payroll" });

    const all = await owner.jp.feedback.list({ status: "Open" });
    expect(all.canSeeAll).toBe(true);
    const staff = all.items.find((item) => item.source === "staff");
    expect(staff).toMatchObject({
      who: "Demo Storekeeper",
      message: "Stock page shows a blank card",
    });
    const errors = all.items.filter((item) => item.source === "app_error");
    // Three repeats from a phone that was not signed in are kept as one with a count.
    const anonymous = errors.find((item) => item.screen === "/inventory")!;
    expect(anonymous.repeatCount).toBe(3);
    expect(anonymous.detail).not.toContain("/data/user");
    // The signed-in supervisor's error is in the company's list.
    expect(errors.find((item) => item.screen === "/payroll")?.who).toBe("Demo Supervisor");

    // A site manager sees only worker requests on their sites.
    const mine = await manager.jp.feedback.list({ status: "Open" });
    expect(mine.canSeeAll).toBe(false);
    expect(
      mine.items.every((item) => item.source === "worker" || item.source === "pin_reset"),
    ).toBe(true);
    expect(mine.items[0]?.detail).toBeNull();
    await expect(store.jp.feedback.list({ status: "Open" })).rejects.toThrow(
      /leaders and site managers/,
    );

    // Closing: a manager cannot close a staff report, the owner can.
    await expect(manager.jp.feedback.resolve({ id: staff!.id })).rejects.toThrow(/not found/);
    await owner.jp.feedback.resolve({ id: staff!.id, resolution: "Fixed in 1.5.1" });
    const closed = await owner.jp.feedback.list({ status: "Resolved", source: "staff" });
    expect(closed.items[0]).toMatchObject({ resolution: "Fixed in 1.5.1" });
  });
});
