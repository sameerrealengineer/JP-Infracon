// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { subscribeWebPush, unsubscribeWebPush, webPushState } from "./web-push-client";

const IPHONE =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Version/18.0 Mobile/15E148 Safari/604.1";
const CHROME =
  "Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 Chrome/131.0 Mobile Safari/537.36";

type Sub = { endpoint: string; toJSON: () => unknown; unsubscribe: () => Promise<boolean> };

/** Builds a browser with the given abilities; the browser APIs are the boundary under test. */
function browser({
  userAgent = CHROME,
  standalone = false,
  permission = "default" as NotificationPermission,
  askAnswer = "granted" as NotificationPermission,
  existing = null as Sub | null,
  created = null as Sub | null,
  withPush = true,
} = {}) {
  const subscribe = vi.fn(async (_options: unknown) => created);
  const reg = { pushManager: { getSubscription: async () => existing, subscribe } };
  const register = vi.fn(async () => reg);
  vi.stubGlobal("navigator", {
    userAgent,
    standalone,
    ...(withPush
      ? {
          serviceWorker: {
            register,
            ready: Promise.resolve(reg),
            getRegistration: async () => reg,
          },
        }
      : {}),
  });
  vi.stubGlobal("matchMedia", () => ({ matches: false }));
  if (withPush) {
    vi.stubGlobal("PushManager", function PushManager() {});
    vi.stubGlobal(
      "Notification",
      Object.assign(function Notification() {}, {
        permission,
        requestPermission: vi.fn(async () => askAnswer),
      }),
    );
  } else {
    // jsdom has neither; make sure no earlier stub leaks in.
    vi.stubGlobal("PushManager", undefined);
    Reflect.deleteProperty(window, "PushManager");
  }
  return { register, subscribe };
}

const sub = (keys: Record<string, string> | null = { p256dh: "pk", auth: "au" }): Sub => ({
  endpoint: "https://push.example/1",
  toJSON: () => ({ endpoint: "https://push.example/1", ...(keys ? { keys } : {}) }),
  unsubscribe: vi.fn(async () => true),
});

describe("webPushState", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("asks iPhone users to add the app to the home screen first", async () => {
    browser({ userAgent: IPHONE, standalone: false });
    expect(await webPushState()).toBe("needs-home-screen");
  });

  it("lets an iPhone opened from the home screen turn notifications on", async () => {
    browser({ userAgent: IPHONE, standalone: true });
    expect(await webPushState()).toBe("off");
  });

  it("reports a browser without push support", async () => {
    browser({ withPush: false });
    expect(await webPushState()).toBe("unsupported");
  });

  it("reports notifications blocked by the person", async () => {
    browser({ permission: "denied" });
    expect(await webPushState()).toBe("blocked");
  });

  it("is on only with both a subscription and permission", async () => {
    browser({ permission: "granted", existing: sub() });
    expect(await webPushState()).toBe("on");
    browser({ permission: "default", existing: sub() });
    expect(await webPushState()).toBe("off");
  });
});

describe("subscribeWebPush", () => {
  beforeEach(() => vi.unstubAllGlobals());
  afterEach(() => vi.unstubAllGlobals());

  it("registers the service worker, subscribes with the server key and returns what to save", async () => {
    const { register, subscribe } = browser({ created: sub() });
    const saved = await subscribeWebPush("AQID");
    expect(register).toHaveBeenCalledWith("/sw.js", { scope: "/" });
    const options = subscribe.mock.calls[0][0] as {
      userVisibleOnly: boolean;
      applicationServerKey: Uint8Array;
    };
    expect(options.userVisibleOnly).toBe(true);
    // "AQID" is base64url for the bytes 1, 2, 3.
    expect([...options.applicationServerKey]).toEqual([1, 2, 3]);
    expect(saved).toEqual({
      endpoint: "https://push.example/1",
      keys: { p256dh: "pk", auth: "au" },
      userAgent: CHROME,
    });
  });

  it("decodes base64url keys with - and _ and no padding", async () => {
    const { subscribe } = browser({ created: sub() });
    await subscribeWebPush("-_8");
    const key = (subscribe.mock.calls[0][0] as { applicationServerKey: Uint8Array })
      .applicationServerKey;
    expect([...key]).toEqual([251, 255]);
  });

  it("reuses an existing subscription instead of making a second one", async () => {
    const { subscribe } = browser({ existing: sub() });
    await subscribeWebPush("AQID");
    expect(subscribe).not.toHaveBeenCalled();
  });

  it("stops when the person does not allow notifications", async () => {
    const { register } = browser({ askAnswer: "denied" });
    await expect(subscribeWebPush("AQID")).rejects.toThrow("Notifications were not allowed.");
    expect(register).not.toHaveBeenCalled();
  });

  it("refuses a subscription without keys", async () => {
    browser({ created: sub(null) });
    await expect(subscribeWebPush("AQID")).rejects.toThrow("did not give a push address");
  });
});

describe("unsubscribeWebPush", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("unsubscribes and returns the endpoint so the server can forget it", async () => {
    const current = sub();
    browser({ existing: current });
    expect(await unsubscribeWebPush()).toBe("https://push.example/1");
    expect(current.unsubscribe).toHaveBeenCalled();
  });

  it("returns null when this browser had no subscription", async () => {
    browser({ existing: null });
    expect(await unsubscribeWebPush()).toBeNull();
  });
});
