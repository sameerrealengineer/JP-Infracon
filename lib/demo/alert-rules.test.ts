import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

// Company alert rules and personal mutes over the demo SQLite database, with a fake WhatsApp
// gateway (no message leaves the machine).
vi.mock("../../server/db", () => import("./server/db"));
vi.mock("../../server/_core/sdk", () => import("./server/sdk"));
vi.mock("../../server/storage", () => import("./server/storage"));

const { setDemoDriver } = await import("./runtime");
const { createNodeDriver } = await import("./testing/node-driver");
const { ensureDemoData } = await import("./backend");
const { signIn } = await import("./seed");
const { dispatchAlert } = await import("../../server/jp/notify");

type Caller = Awaited<ReturnType<typeof signIn>>;
let owner: Caller, supervisor: Caller;
let supervisorId = 0;
let organizationId = "";
const sent: string[] = [];
const realFetch = globalThis.fetch;

async function alert(kind: string, detail = "Slab 2 cube results attached") {
  sent.length = 0;
  await dispatchAlert({
    organizationId,
    kind,
    title: "Report update",
    detail,
    recipientUserIds: [supervisorId],
  });
  return [...sent];
}

describe("alert rules", () => {
  beforeAll(async () => {
    process.env.WHATSAPP_PROVIDER = "waha";
    process.env.WAHA_URL = "http://wa.test";
    vi.stubGlobal("fetch", async (url: string | URL, init?: RequestInit) => {
      if (String(url).startsWith("http://wa.test")) {
        sent.push(String(init?.body ?? ""));
        return new Response("{}", { status: 200 });
      }
      return realFetch(url, init);
    });
    await setDemoDriver(createNodeDriver());
    await ensureDemoData();
    [owner, supervisor] = await Promise.all(["owner", "supervisor"].map(signIn));
    supervisorId = (await supervisor.auth.me())!.id;
    organizationId = (await owner.jp.workspace.mySites())[0].organizationId;
    await supervisor.jp.notifications.updatePreferences({
      phone: "9876543210",
      whatsappOptIn: true,
      smsOptIn: false,
      pushOptIn: true,
    });
  }, 120_000);

  afterAll(() => {
    vi.unstubAllGlobals();
    delete process.env.WHATSAPP_PROVIDER;
    delete process.env.WAHA_URL;
  });

  it("sends by default, with details", async () => {
    const messages = await alert("report.approved");
    expect(messages).toHaveLength(1);
    expect(messages[0]).toContain("Slab 2 cube results");
  });

  it("a company rule can send titles only, or stop WhatsApp for a role", async () => {
    const { rules } = await owner.jp.notifications.alertRules();
    const change = (patch: object) =>
      rules.map((rule) =>
        rule.category === "reports" && rule.role === "supervisor" ? { ...rule, ...patch } : rule,
      );
    await owner.jp.notifications.saveAlertRules({ rules: change({ detail: "title" }) });
    const short = await alert("report.approved");
    expect(short).toHaveLength(1);
    expect(short[0]).not.toContain("Slab 2 cube results");

    await owner.jp.notifications.saveAlertRules({ rules: change({ whatsapp: false }) });
    expect(await alert("report.approved")).toHaveLength(0);
    // Other categories are untouched.
    expect(await alert("issue.raised")).toHaveLength(1);
    // System alerts (tests) ignore category rules.
    expect(await alert("test")).toHaveLength(1);

    await expect(supervisor.jp.notifications.saveAlertRules({ rules: [] })).rejects.toThrow(
      /owner/,
    );
    await owner.jp.notifications.saveAlertRules({ rules: [] });
    expect(await alert("report.approved")).toHaveLength(1);
  });

  it("a person can mute a category for themselves; module off stops it too", async () => {
    await supervisor.jp.notifications.setMutes({ muted: ["issues", "nonsense"] });
    expect((await supervisor.jp.notifications.myMutes()).muted).toEqual(["issues"]);
    expect(await alert("issue.raised")).toHaveLength(0);
    await supervisor.jp.notifications.setMutes({ muted: [] });
    expect(await alert("issue.raised")).toHaveLength(1);

    await owner.jp.modules.update({ disabled: ["budget"] });
    try {
      expect(await alert("budget.proposed")).toHaveLength(0);
    } finally {
      await owner.jp.modules.update({ disabled: [] });
    }
  });

  it("leaders see the delivery log, including skips and why", async () => {
    const log = await owner.jp.notifications.recentDeliveries();
    expect(log.rows.some((row) => row.status === "Skipped" && row.detail === "module off")).toBe(
      true,
    );
    expect((await supervisor.jp.notifications.recentDeliveries()).rows).toHaveLength(0);
  });
});
