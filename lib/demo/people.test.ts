import { beforeAll, describe, expect, it, vi } from "vitest";

// Person profiles over the demo SQLite database (never the shared MySQL).
vi.mock("../../server/db", () => import("./server/db"));
vi.mock("../../server/_core/sdk", () => import("./server/sdk"));
vi.mock("../../server/storage", () => import("./server/storage"));

const { setDemoDriver } = await import("./runtime");
const { createNodeDriver } = await import("./testing/node-driver");
const { ensureDemoData } = await import("./backend");
const { signIn, mutationId } = await import("./seed");

type Caller = Awaited<ReturnType<typeof signIn>>;
let owner: Caller, supervisor: Caller, auditor: Caller, store: Caller;

describe("person profiles", () => {
  beforeAll(async () => {
    await setDemoDriver(createNodeDriver());
    await ensureDemoData();
    [owner, supervisor, auditor, store] = await Promise.all(
      ["owner", "supervisor", "auditor", "store"].map(signIn),
    );
  }, 120_000);

  it("finds people by name or trade, only for those allowed to see the workforce", async () => {
    const found = await owner.jp.people.search({ query: "mason" });
    expect(found.people.map((p) => p.fullName)).toContain("Ramesh Behera");
    expect((await owner.jp.people.search({ query: "Sunita" })).people).toHaveLength(1);
    expect((await store.jp.people.search({ query: "" })).people).toHaveLength(0);
  });

  it("shows sites, attendance and estimated earnings; pay only with compensation.view", async () => {
    const [ramesh] = (await owner.jp.people.search({ query: "Ramesh" })).people;
    const history = await owner.jp.people.history({ personId: ramesh.id });
    expect(history.sites.length).toBeGreaterThan(0);
    const site = history.sites[0];
    expect(site.rates?.[0]).toMatchObject({ rateType: "daily", rateMinor: "85000" });
    expect(site.work?.daysPresent).toBeGreaterThanOrEqual(1);
    expect(site.work?.estimatedEarningsMinor).not.toBeNull();
    expect(history.person.phone === null || typeof history.person.phone === "string").toBe(true);
    expect(history.contact).not.toBeNull();

    // The auditor sees work and pay but not contact details; the storekeeper sees nothing.
    const audited = await auditor.jp.people.history({ personId: ramesh.id });
    expect(audited.contact).toBeNull();
    expect(audited.sites[0].rates).not.toBeNull();
    await expect(store.jp.people.history({ personId: ramesh.id })).rejects.toThrow(/workforce/);
  });

  it("records feedback append-only with audit, and saves address details", async () => {
    const [ramesh] = (await owner.jp.people.search({ query: "Ramesh" })).people;
    const history = await supervisor.jp.people.history({ personId: ramesh.id });
    const siteId = history.sites[0].siteId;
    const key = mutationId();
    const first = await supervisor.jp.people.addFeedback({
      personId: ramesh.id,
      siteId,
      kind: "Quality",
      rating: 4,
      note: "Clean brickwork on block A",
      clientMutationId: key,
    });
    const replay = await supervisor.jp.people.addFeedback({
      personId: ramesh.id,
      siteId,
      kind: "Quality",
      rating: 4,
      note: "Clean brickwork on block A",
      clientMutationId: key,
    });
    expect(replay.id).toBe(first.id);
    await supervisor.jp.people.addFeedback({
      personId: ramesh.id,
      siteId,
      kind: "Default",
      note: "Left the site for two days without notice",
      clientMutationId: mutationId(),
    });
    await expect(
      supervisor.jp.people.addFeedback({
        personId: ramesh.id,
        siteId,
        kind: "Quality",
        rating: 9,
        note: "Too good",
        clientMutationId: mutationId(),
      }),
    ).rejects.toThrow();
    await expect(
      auditor.jp.people.addFeedback({
        personId: ramesh.id,
        siteId,
        kind: "Praise",
        note: "Helpful",
        clientMutationId: mutationId(),
      }),
    ).rejects.toThrow(/workforce.manage/);

    await supervisor.jp.people.saveDetails({
      personId: ramesh.id,
      siteId,
      addressLine: "Plot 12, Patia",
      city: "Bhubaneswar",
      pincode: "751024",
      clientMutationId: mutationId(),
    });
    const after = await owner.jp.people.history({ personId: ramesh.id });
    expect(after.contact).toMatchObject({ city: "Bhubaneswar", pincode: "751024" });
    expect(after.feedbackSummary).toMatchObject({ averageRating: 4, counts: { Default: 1 } });
    const search = await owner.jp.people.search({ query: "Ramesh" });
    expect(search.people[0]).toMatchObject({ averageRating: 4, defaults: 1 });
    const audit = await owner.jp.workspace.auditEvents();
    expect(JSON.stringify(audit)).toContain("workforce.person_feedback_added");
  });

  it("is refused while the Workforce module is off", async () => {
    const [ramesh] = (await owner.jp.people.search({ query: "Ramesh" })).people;
    await owner.jp.modules.update({ disabled: ["workforce"] });
    try {
      await expect(owner.jp.people.history({ personId: ramesh.id })).rejects.toThrow(/turned off/);
      expect((await owner.jp.people.search({ query: "" })).people).toHaveLength(0);
    } finally {
      await owner.jp.modules.update({ disabled: [] });
    }
  });
});
