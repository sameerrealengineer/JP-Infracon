import { beforeAll, describe, expect, it, vi } from "vitest";

// Step-by-step mode over the demo database: switching it on closes steps not reached and the
// extras; the Modules screen switch opens a module early; switching it off opens everything.
vi.mock("../../server/db", () => import("./server/db"));
vi.mock("../../server/_core/sdk", () => import("./server/sdk"));
vi.mock("../../server/storage", () => import("./server/storage"));

const { setDemoDriver } = await import("./runtime");
const { createNodeDriver } = await import("./testing/node-driver");
const { ensureDemoData } = await import("./backend");
const { signIn } = await import("./seed");

type Caller = Awaited<ReturnType<typeof signIn>>;
let owner: Caller, supervisor: Caller;

const canCrm = async (caller: Caller) =>
  (await caller.jp.workspace.myCapabilities()).some((row) => row["crm.view"]);

describe("step-by-step journey", () => {
  beforeAll(async () => {
    await setDemoDriver(createNodeDriver());
    await ensureDemoData();
    [owner, supervisor] = await Promise.all(["owner", "supervisor"].map(signIn));
  }, 120_000);

  it("the demo starts with everything open", async () => {
    expect((await owner.jp.journey.status())!.mode).toBe("all");
    expect(await canCrm(owner)).toBe(true);
  });

  it("guided mode follows real records and keeps extras closed", async () => {
    await expect(supervisor.jp.journey.setMode({ mode: "guided" })).rejects.toThrow(
      /owner, a director or an admin/,
    );
    await owner.jp.journey.setMode({ mode: "guided" });
    const status = (await owner.jp.journey.status())!;
    expect(status.mode).toBe("guided");
    expect(status.level).toBeGreaterThanOrEqual(2); // the demo has workers on a site
    expect(status.steps[0]!.state).toBe("done");
    expect(await canCrm(owner)).toBe(false);
  });

  it("switching a module on in Modules opens it early; mode off opens everything", async () => {
    const settings = await owner.jp.modules.settings();
    const off = settings.modules
      .filter((row) => !row.enabled && row.key !== "crm")
      .map((row) => row.key);
    await owner.jp.modules.update({ disabled: off, reason: "Need CRM now" });
    expect(await canCrm(owner)).toBe(true);
    const status = (await owner.jp.journey.status())!;
    expect(status.extras).not.toContain("crm");
    await owner.jp.journey.setMode({ mode: "all" });
    const all = await owner.jp.modules.settings();
    expect(all.modules.find((row) => row.key === "crm")!.enabled).toBe(true);
  });
});
