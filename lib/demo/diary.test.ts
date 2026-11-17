import { beforeAll, describe, expect, it, vi } from "vitest";

// Site diary and hindrance register over the demo database through the real procedures.
vi.mock("../../server/db", () => import("./server/db"));
vi.mock("../../server/_core/sdk", () => import("./server/sdk"));
vi.mock("../../server/storage", () => import("./server/storage"));

const { setDemoDriver } = await import("./runtime");
const { createNodeDriver } = await import("./testing/node-driver");
const { ensureDemoData } = await import("./backend");
const { signIn, mutationId } = await import("./seed");

type Caller = Awaited<ReturnType<typeof signIn>>;
let supervisor: Caller, auditor: Caller;
let siteId = "";
const today = new Date(Date.now() + 330 * 60_000).toISOString().slice(0, 10);
const daysAgo = (n: number) =>
  new Date(Date.parse(`${today}T00:00:00Z`) - n * 86_400_000).toISOString().slice(0, 10);

describe("site diary and hindrances", () => {
  beforeAll(async () => {
    await setDemoDriver(createNodeDriver());
    await ensureDemoData();
    [supervisor, auditor] = await Promise.all(["supervisor", "auditor"].map(signIn));
    siteId = (await supervisor.jp.workspace.mySites()).find((s) => s.code === "PATIA-A")!.id;
  }, 120_000);

  it("adds a diary note once and shows it on the day page", async () => {
    const key = mutationId();
    const input = {
      siteId,
      date: today,
      kind: "Instruction" as const,
      personName: "Er. Das",
      personRole: "AE",
      text: "Raise column C4 shuttering by 50 mm",
      clientMutationId: key,
    };
    const first = await supervisor.jp.diary.addNote(input);
    const again = await supervisor.jp.diary.addNote(input);
    expect(again.id).toBe(first.id);
    const day = await supervisor.jp.diary.day({ siteId, date: today });
    expect(day.notes!.filter((n) => n.text.includes("C4"))).toHaveLength(1);
    expect(day.attendance).not.toBeNull();
    await expect(
      supervisor.jp.diary.addNote({ ...input, date: "2099-01-01", clientMutationId: mutationId() }),
    ).rejects.toThrow(/future/);
  });

  it("records hindrances with codes, closes them, and sums EOT days without double counting", async () => {
    const a = await supervisor.jp.diary.addHindrance({
      siteId,
      category: "Drawings or decisions pending",
      description: "Staircase drawing not issued",
      startDate: daysAgo(10),
      endDate: null,
      affectsWork: "Full stop",
      clientMutationId: mutationId(),
    });
    expect(a.code).toMatch(/^HIN-PATIA-A-\d{3}$/);
    await supervisor.jp.diary.addHindrance({
      siteId,
      category: "Rain or flood",
      description: "Heavy rain, site flooded",
      startDate: daysAgo(8),
      endDate: daysAgo(6),
      affectsWork: "Full stop",
      clientMutationId: mutationId(),
    });
    await expect(
      supervisor.jp.diary.addHindrance({
        siteId,
        category: "Aliens",
        description: "nope nope",
        startDate: today,
        endDate: null,
        affectsWork: "Partial",
        clientMutationId: mutationId(),
      }),
    ).rejects.toThrow(/caused/);
    await supervisor.jp.diary.closeHindrance({
      siteId,
      id: a.id,
      endDate: daysAgo(5),
      closeNote: "Drawing received",
    });
    const reg = await supervisor.jp.diary.hindrances({ siteId });
    // 10 days ago → 5 days ago is 6 days; the rain inside it adds nothing.
    expect(reg.summary.fullStopDays).toBe(6);
    expect(reg.rows.find((r) => r.id === a.id)!.status).toBe("Closed");
    const day = await supervisor.jp.diary.day({ siteId, date: daysAgo(7) });
    expect(day.hindrances!.length).toBe(2);
  });

  it("does not let an auditor write", async () => {
    await expect(
      auditor.jp.diary.addNote({
        siteId,
        date: today,
        kind: "General",
        text: "hello",
        clientMutationId: mutationId(),
      }),
    ).rejects.toThrow();
  });
});
