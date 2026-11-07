import { beforeAll, describe, expect, it, vi } from "vitest";

// Team tracking over the demo SQLite database (never the shared MySQL): who may see it, and
// that its numbers come from the real attendance, reports and pay records.
vi.mock("../../server/db", () => import("./server/db"));
vi.mock("../../server/_core/sdk", () => import("./server/sdk"));
vi.mock("../../server/storage", () => import("./server/storage"));

const { setDemoDriver } = await import("./runtime");
const { createNodeDriver } = await import("./testing/node-driver");
const { ensureDemoData } = await import("./backend");
const { signIn } = await import("./seed");
const { previousMonth } = await import("../jp/payroll-domain");

type Caller = Awaited<ReturnType<typeof signIn>>;
let owner: Caller, manager: Caller, supervisor: Caller, accounts: Caller, store: Caller;

// The demo marks attendance yesterday and today, and pays last month (see seed-business.ts).
const thisMonth = new Date().toISOString().slice(0, 7);
const yesterdayMonth = new Date(Date.now() - 86_400_000).toISOString().slice(0, 7);
const payMonth = previousMonth(new Date().toISOString().slice(0, 10));

describe("Team tracking", () => {
  beforeAll(async () => {
    await setDemoDriver(createNodeDriver());
    await ensureDemoData();
    [owner, manager, supervisor, accounts, store] = await Promise.all(
      ["owner", "manager", "supervisor", "accounts", "store"].map(signIn),
    );
  }, 120_000);

  it("is for leaders and project managers only", async () => {
    for (const caller of [supervisor, accounts, store])
      await expect(
        caller.jp.tracking.overview({ siteId: null, month: thisMonth }),
      ).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(
      owner.jp.tracking.overview({ siteId: null, month: "2026-13" }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });

  it("adds up the month's attendance and keeps unapproved marks apart", async () => {
    const view = await owner.jp.tracking.overview({ siteId: null, month: thisMonth });
    expect(view.canSeeMoney).toBe(true);
    expect(view.workers.length).toBeGreaterThan(0);
    expect(view.totals.workers).toBe(view.workers.length);
    expect(view.totals.presentHalfDays).toBe(
      view.workers.reduce((sum, row) => sum + row.presentHalfDays, 0),
    );
    // Today's marks are not approved yet.
    expect(view.totals.pendingRows).toBeGreaterThan(0);
    // Yesterday's approved Full Day / Half Day marks are counted in their month.
    const earlier = await owner.jp.tracking.overview({ siteId: null, month: yesterdayMonth });
    expect(earlier.totals.presentHalfDays).toBeGreaterThan(0);
    expect(earlier.workers.some((row) => row.markedDays > 0 && row.pendingRows === 0)).toBe(
      yesterdayMonth !== thisMonth,
    );
    // Staff are listed with their own reports; drafts never count as submitted.
    expect(view.staff.length).toBeGreaterThan(0);
    for (const row of view.staff)
      expect(row.reportsSubmitted).toBeGreaterThanOrEqual(row.reportsApproved);
  });

  it("shows wages and advances from pay runs to people allowed to see them", async () => {
    const view = await owner.jp.tracking.overview({ siteId: null, month: payMonth });
    expect(view.totals.dueMinor).not.toBeNull();
    const paid = view.workers.filter((row) => BigInt(row.paidMinor ?? "0") > 0n);
    const earned = view.workers.filter((row) => BigInt(row.earnedMonthMinor ?? "0") > 0n);
    expect(paid.length + earned.length).toBeGreaterThan(0);
    expect(BigInt(view.totals.earnedMonthMinor!)).toBe(
      view.workers.reduce((sum, row) => sum + BigInt(row.earnedMonthMinor ?? "0"), 0n),
    );
  });

  it("limits a project manager to the sites they review", async () => {
    const mine = await manager.jp.tracking.overview({ siteId: null, month: thisMonth });
    const all = await owner.jp.tracking.overview({ siteId: null, month: thisMonth });
    expect(mine.sites.length).toBeGreaterThan(0);
    expect(mine.sites.length).toBeLessThanOrEqual(all.sites.length);
    const outside = all.sites.find((site) => !mine.sites.some((own) => own.id === site.id));
    if (outside)
      await expect(
        manager.jp.tracking.overview({ siteId: outside.id, month: thisMonth }),
      ).rejects.toMatchObject({ code: "FORBIDDEN" });
    // One site: only people of that site.
    const one = await owner.jp.tracking.overview({ siteId: all.sites[0].id, month: thisMonth });
    for (const row of one.workers) expect(row.sites).toContain(all.sites[0].name);
  });
});
