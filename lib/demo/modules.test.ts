import { beforeAll, describe, expect, it, vi } from "vitest";

// Company module switches over the demo SQLite database (never the shared MySQL).
vi.mock("../../server/db", () => import("./server/db"));
vi.mock("../../server/_core/sdk", () => import("./server/sdk"));
vi.mock("../../server/storage", () => import("./server/storage"));

const { setDemoDriver } = await import("./runtime");
const { createNodeDriver } = await import("./testing/node-driver");
const { ensureDemoData } = await import("./backend");
const { signIn } = await import("./seed");

type Caller = Awaited<ReturnType<typeof signIn>>;
let owner: Caller, supervisor: Caller;

describe("company modules", () => {
  beforeAll(async () => {
    delete process.env.GEMINI_API_KEY;
    delete process.env.SARVAM_API_KEY;
    await setDemoDriver(createNodeDriver());
    await ensureDemoData();
    [owner, supervisor] = await Promise.all(["owner", "supervisor"].map(signIn));
  }, 120_000);

  it("lists modules with usage, and only leaders may change them", async () => {
    const settings = await owner.jp.modules.settings();
    expect(settings.canManage).toBe(true);
    expect(settings.modules.every((row) => row.enabled)).toBe(true);
    expect(
      settings.modules.find((row) => row.key === "reports")!.actionsLast30Days,
    ).toBeGreaterThan(0);
    expect((await supervisor.jp.modules.settings()).canManage).toBe(false);
    await expect(supervisor.jp.modules.update({ disabled: ["budget"] })).rejects.toThrow(/owner/);
  });

  it("a module turned off is refused by the server and hidden, then comes back", async () => {
    await owner.jp.modules.update({ disabled: ["budget", "inventory", "unknown"] });
    expect(
      (await owner.jp.modules.settings()).modules.filter((row) => !row.enabled).map((r) => r.key),
    ).toEqual(["inventory", "budget"]);
    const caps = await owner.jp.workspace.myCapabilities();
    expect(caps.every((row) => !row["budget.view"] && !row["inventory.view"])).toBe(true);
    expect(caps.some((row) => row["dpr.view"])).toBe(true);
    const sites = await owner.jp.workspace.mySites();
    await expect(owner.jp.inventory.list({ siteId: sites[0].id })).rejects.toThrow(/turned off/);
    expect((await owner.jp.budgets.options()).projects).toHaveLength(0);

    await owner.jp.modules.update({ disabled: [] });
    expect((await owner.jp.workspace.myCapabilities()).some((row) => row["budget.view"])).toBe(
      true,
    );
  });

  it("workforce turned off is refused, not only hidden", async () => {
    const sites = await owner.jp.workspace.mySites();
    expect(Array.isArray(await owner.jp.workforce.list({ siteId: sites[0].id }))).toBe(true);
    await owner.jp.modules.update({ disabled: ["workforce"] });
    try {
      await expect(owner.jp.workforce.list({ siteId: sites[0].id })).rejects.toThrow(/turned off/);
      await expect(owner.jp.workforce.rates({ siteId: sites[0].id })).rejects.toThrow(/turned off/);
    } finally {
      await owner.jp.modules.update({ disabled: [] });
    }
  });

  it("finance turned off also refuses the custodian's fund acknowledgement", async () => {
    const sites = await owner.jp.workspace.mySites();
    await owner.jp.modules.update({ disabled: ["finance"] });
    try {
      await expect(
        owner.jp.finance.pettyCash.acknowledgeFund({
          siteId: sites[0].id,
          fundId: "00000000-0000-4000-8000-000000000000",
          clientMutationId: `probe-${Date.now()}-ack-fund`,
        }),
      ).rejects.toThrow(/turned off/);
    } finally {
      await owner.jp.modules.update({ disabled: [] });
    }
  });

  it("reports turned off hides returned reports from the inbox", async () => {
    await owner.jp.modules.update({ disabled: ["reports", "schedule"] });
    try {
      const inbox = await owner.jp.workspace.inbox();
      expect(inbox.items.filter((item) => item.kind.startsWith("report."))).toHaveLength(0);
      expect(inbox.items.filter((item) => item.kind.startsWith("task."))).toHaveLength(0);
    } finally {
      await owner.jp.modules.update({ disabled: [] });
    }
  });

  it("suggests modules from usage when AI is not set up", async () => {
    const suggestion = await owner.jp.modules.suggest({ about: "Small building contractor" });
    expect(suggestion.source).toBe("rules");
    expect(suggestion.turnOff).not.toContain("reports");
    expect(Array.isArray(suggestion.reasons)).toBe(true);
  });
});
