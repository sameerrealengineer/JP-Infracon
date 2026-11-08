import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

// Browser push for the web app, over the demo SQLite database with the real notifications router
// and dispatchAlert. The push sender is faked at the boundary (no request leaves the machine).
vi.mock("../../server/db", () => import("./server/db"));
vi.mock("../../server/_core/sdk", () => import("./server/sdk"));
vi.mock("../../server/storage", () => import("./server/storage"));

const sendWebPush = vi.fn();
let publicKey: string | null = "BPubKeyForTests";
vi.mock("../../server/web-push-send", () => ({
  sendWebPush: (...args: unknown[]) => sendWebPush(...args),
  webPushPublicKey: () => publicKey,
}));

const { setDemoDriver } = await import("./runtime");
const { createNodeDriver } = await import("./testing/node-driver");
const { ensureDemoData } = await import("./backend");
const { callerFor, signIn } = await import("./seed");
const { dispatchAlert } = await import("../../server/jp/notify");

type Caller = Awaited<ReturnType<typeof signIn>>;
let owner: Caller, supervisor: Caller, manager: Caller;
let supervisorId = 0;
let organizationId = "";

const subscription = (n: number) => ({
  endpoint: `https://push.example.test/send/${n}`,
  keys: { p256dh: `p256dh-key-${n}-xxxxxxxx`, auth: `auth-${n}-xxxxx` },
  userAgent: "Mozilla/5.0 (iPhone)",
});

async function alertSupervisor() {
  await dispatchAlert({
    organizationId,
    kind: "issue.reported",
    title: "Safety issue at Patia",
    route: "/issues",
    recipientUserIds: [supervisorId],
  });
  return sendWebPush.mock.calls.map(([target]) => (target as { endpoint: string }).endpoint);
}

describe("web push", () => {
  beforeAll(async () => {
    await setDemoDriver(createNodeDriver());
    await ensureDemoData();
    [owner, supervisor, manager] = await Promise.all(
      ["owner", "supervisor", "manager"].map(signIn),
    );
    supervisorId = (await supervisor.auth.me())!.id;
    organizationId = (await owner.jp.workspace.mySites())[0].organizationId;
  }, 120_000);

  beforeEach(() => {
    sendWebPush.mockReset();
    sendWebPush.mockResolvedValue({ ok: true, gone: false, detail: "web push 201" });
    publicKey = "BPubKeyForTests";
  });

  afterAll(() => vi.restoreAllMocks());

  it("gives the browser the public key, or null when the server has none", async () => {
    expect(await supervisor.jp.notifications.webPushKey()).toEqual({
      publicKey: "BPubKeyForTests",
    });
    publicKey = null;
    expect(await supervisor.jp.notifications.webPushKey()).toEqual({ publicKey: null });
  });

  it("refuses people who are not signed in", async () => {
    const guest = await callerFor(null);
    await expect(guest.jp.notifications.webPushKey()).rejects.toThrow(/login/i);
    await expect(guest.jp.notifications.registerWebPush(subscription(99))).rejects.toThrow(
      /login/i,
    );
  });

  it("refuses an endpoint that is not https", async () => {
    await expect(
      supervisor.jp.notifications.registerWebPush({
        ...subscription(1),
        endpoint: "http://push.example.test/insecure",
      }),
    ).rejects.toThrow();
  });

  it("sends an alert to a registered browser with its title and screen", async () => {
    await supervisor.jp.notifications.registerWebPush(subscription(1));
    const endpoints = await alertSupervisor();
    expect(endpoints).toContain(subscription(1).endpoint);
    const [target, message] = sendWebPush.mock.calls[0];
    expect(target).toMatchObject({
      p256dh: subscription(1).keys.p256dh,
      auth: subscription(1).keys.auth,
    });
    expect(message).toEqual({
      title: "JP Infracon",
      body: "Safety issue at Patia",
      route: "/issues",
    });
  });

  it("registering the same browser twice keeps one subscription", async () => {
    await supervisor.jp.notifications.registerWebPush(subscription(2));
    await supervisor.jp.notifications.registerWebPush(subscription(2));
    const endpoints = await alertSupervisor();
    expect(endpoints.filter((e) => e === subscription(2).endpoint)).toHaveLength(1);
  });

  it("stops sending after the person turns notifications off on that browser", async () => {
    await supervisor.jp.notifications.registerWebPush(subscription(3));
    await supervisor.jp.notifications.unregisterWebPush({ endpoint: subscription(3).endpoint });
    expect(await alertSupervisor()).not.toContain(subscription(3).endpoint);
  });

  it("another person cannot turn off someone else's browser", async () => {
    await supervisor.jp.notifications.registerWebPush(subscription(4));
    await manager.jp.notifications.unregisterWebPush({ endpoint: subscription(4).endpoint });
    expect(await alertSupervisor()).toContain(subscription(4).endpoint);
  });

  it("drops a subscription the browser has removed (404/410) and never sends to it again", async () => {
    await supervisor.jp.notifications.registerWebPush(subscription(5));
    sendWebPush.mockImplementation(async (target: { endpoint: string }) =>
      target.endpoint === subscription(5).endpoint
        ? { ok: false, gone: true, detail: "web push 410" }
        : { ok: true, gone: false, detail: "web push 201" },
    );
    expect(await alertSupervisor()).toContain(subscription(5).endpoint);
    sendWebPush.mockClear();
    expect(await alertSupervisor()).not.toContain(subscription(5).endpoint);
  });

  it("respects the person's choice to switch app notifications off", async () => {
    await supervisor.jp.notifications.registerWebPush(subscription(6));
    await supervisor.jp.notifications.updatePreferences({
      phone: "",
      whatsappOptIn: false,
      smsOptIn: false,
      pushOptIn: false,
    });
    try {
      expect(await alertSupervisor()).toEqual([]);
    } finally {
      await supervisor.jp.notifications.updatePreferences({
        phone: "",
        whatsappOptIn: false,
        smsOptIn: false,
        pushOptIn: true,
      });
    }
  });

  it("a failing push service never breaks the alert", async () => {
    await supervisor.jp.notifications.registerWebPush(subscription(7));
    sendWebPush.mockRejectedValue(new Error("network down"));
    await expect(alertSupervisor()).resolves.toBeDefined();
  });
});
