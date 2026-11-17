import { beforeAll, describe, expect, it, vi } from "vitest";

// Today on site over the demo database: per site status within permissions.
vi.mock("../../server/db", () => import("./server/db"));
vi.mock("../../server/_core/sdk", () => import("./server/sdk"));
vi.mock("../../server/storage", () => import("./server/storage"));

const { setDemoDriver } = await import("./runtime");
const { createNodeDriver } = await import("./testing/node-driver");
const { ensureDemoData } = await import("./backend");
const { signIn } = await import("./seed");

describe("today on site", () => {
  beforeAll(async () => {
    await setDemoDriver(createNodeDriver());
    await ensureDemoData();
  }, 120_000);

  it("lists active sites with attendance, DPR and late tasks where visible", async () => {
    const supervisor = await signIn("supervisor");
    const data = await supervisor.jp.today.sites();
    expect(data.today).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(data.sites.length).toBeGreaterThan(0);
    const site = data.sites[0]!;
    expect(typeof site.attendance).toBe("number");
    expect(site.canMark).toBe(true);
    expect(site.lateTasks === null || typeof site.lateTasks === "number").toBe(true);
  });

  it("hides attendance from a role without it", async () => {
    const accounts = await signIn("accounts");
    const data = await accounts.jp.today.sites();
    for (const site of data.sites) expect(site.canMark).toBe(false);
  });
});
