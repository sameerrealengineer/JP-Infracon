import { beforeAll, describe, expect, it, vi } from "vitest";

// Worker (mistri) app over the demo SQLite database: PIN sign-in with a lock, a screen with only
// the worker's own money, attendance, drawings and supervisor number as switched on, nothing
// else of the company, and the supervisor-phone view.
vi.mock("../../server/db", () => import("./server/db"));
vi.mock("../../server/_core/sdk", () => import("./server/sdk"));
vi.mock("../../server/storage", () => import("./server/storage"));

const { setDemoDriver } = await import("./runtime");
const { createNodeDriver } = await import("./testing/node-driver");
const { ensureDemoData } = await import("./backend");
const { signIn, callerFor, mutationId } = await import("./seed");
const { DEMO_WORKER } = await import("./config");

type Caller = Awaited<ReturnType<typeof signIn>>;
let owner: Caller, manager: Caller, supervisor: Caller, store: Caller;
let siteId = "";
let rameshId = "";

async function workerCaller(mobile: string, pin: string) {
  const guest = await callerFor(null);
  const { sessionToken } = await guest.auth.workerLogin({ mobile, pin });
  return callerFor(sessionToken);
}

describe("worker app", () => {
  beforeAll(async () => {
    await setDemoDriver(createNodeDriver());
    await ensureDemoData();
    [owner, manager, supervisor, store] = await Promise.all(
      ["owner", "manager", "supervisor", "store"].map(signIn),
    );
    siteId = (await owner.jp.workspace.mySites()).find((s) => s.code === "PATIA-A")!.id;
    rameshId = (await owner.jp.people.search({ query: "Ramesh" })).people[0].id;
  }, 120_000);

  it("signs in with mobile and PIN and sees only their own things", async () => {
    const worker = await workerCaller(`+91 ${DEMO_WORKER.mobile}`, DEMO_WORKER.pin);
    const me = await worker.auth.me();
    expect(me?.loginMethod).toBe("worker_pin");
    const screen = await worker.jp.worker.me();
    expect(screen.person.name).toBe("Ramesh Behera");
    expect(screen.features).toEqual(["money", "attendance", "drawings", "call"]);
    expect(screen.money?.[0]).toMatchObject({ siteName: "Patia Tower A" });
    expect(BigInt(screen.money![0].paidMinor)).toBeGreaterThan(0n);
    expect(screen.attendance!.length).toBeGreaterThan(0);
    expect(screen.drawings?.map((d) => d.title)).toContain("Block 1 ground floor plan (GF-01)");
    expect(screen.contacts?.[0]).toMatchObject({ role: "supervisor", phone: "+919437011111" });
    const opened = await worker.jp.worker.openDrawing({ documentId: screen.drawings![0].id });
    expect(opened.url).toBeTruthy();
    // Nothing else of the company answers.
    await expect(worker.jp.workspace.mySites()).resolves.toEqual([]);
    await expect(worker.jp.payroll.runs({ siteId })).rejects.toThrow();
    await expect(worker.jp.advances.list({ siteId })).rejects.toThrow();
    await expect(worker.jp.books.overview()).rejects.toThrow();
    // The worker's phone gets the site boundary for arrival alerts.
    const fences = await worker.jp.presence.myFences();
    expect(fences.map((f) => f.siteId)).toContain(siteId);
  });

  it("locks after five wrong PINs, with the same answer for unknown numbers", async () => {
    await manager.jp.worker.setLogin({
      siteId,
      personId: (await owner.jp.people.search({ query: "Sunita" })).people[0].id,
      mobile: "9876500002",
      pin: "730419",
    });
    const guest = await callerFor(null);
    for (let i = 0; i < 5; i += 1)
      await expect(guest.auth.workerLogin({ mobile: "9876500002", pin: "111222" })).rejects.toThrow(
        /PIN is wrong/,
      );
    await expect(guest.auth.workerLogin({ mobile: "9876500002", pin: "730419" })).rejects.toThrow(
      /locked/,
    );
    await expect(guest.auth.workerLogin({ mobile: "9000000000", pin: "730419" })).rejects.toThrow(
      /PIN is wrong/,
    );
    // The account's own username cannot be used with a password to get around the PIN lock.
    await expect(
      guest.auth.login({ username: "w-anything", password: "730419" }),
    ).rejects.toThrow();
  }, 30_000);

  it("staff choose features, reset PINs and turn a login off", async () => {
    await expect(
      manager.jp.worker.setLogin({
        siteId,
        personId: rameshId,
        mobile: "9876500001",
        pin: "123456",
      }),
    ).rejects.toThrow(/in a row/);
    await expect(
      supervisor.jp.worker.update({ siteId, personId: rameshId, features: ["money"] }),
    ).rejects.toThrow();
    await manager.jp.worker.update({ siteId, personId: rameshId, features: ["attendance"] });
    const worker = await workerCaller(DEMO_WORKER.mobile, DEMO_WORKER.pin);
    const screen = await worker.jp.worker.me();
    expect(screen.money).toBeNull();
    expect(screen.drawings).toBeNull();
    expect(screen.attendance).not.toBeNull();
    await expect(
      worker.jp.worker.openDrawing({ documentId: "00000000-0000-4000-8000-000000000000" }),
    ).rejects.toThrow(/not switched on/);
    const account = await supervisor.jp.worker.account({ siteId, personId: rameshId });
    expect(account).toMatchObject({ canManage: false, account: { status: "Active" } });
    await manager.jp.worker.update({ siteId, personId: rameshId, status: "Disabled" });
    await expect(worker.jp.worker.me()).rejects.toThrow();
    await expect(workerCaller(DEMO_WORKER.mobile, DEMO_WORKER.pin)).rejects.toThrow();
    await manager.jp.worker.update({
      siteId,
      personId: rameshId,
      status: "Active",
      features: ["money", "attendance", "drawings", "call"],
    });
    await expect(store.jp.worker.account({ siteId, personId: rameshId })).rejects.toThrow();
  });

  it("a supervisor shows the worker view on their own phone", async () => {
    const view = await supervisor.jp.worker.viewFor({ siteId, personId: rameshId });
    expect(view.person.name).toBe("Ramesh Behera");
    expect(view.money?.length).toBe(1);
    await expect(store.jp.worker.viewFor({ siteId, personId: rameshId })).rejects.toThrow();
    void mutationId;
  });
});
