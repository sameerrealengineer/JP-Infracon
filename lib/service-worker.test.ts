import { readFileSync } from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { describe, expect, it, vi } from "vitest";

// public/sw.js runs in the browser's service worker. It is loaded here into a fake worker scope
// (the browser APIs are the boundary) so its push and tap handling can be checked.
// The test lives in lib/ because everything in public/ is published with the web app.
const source = readFileSync(path.resolve(__dirname, "../public/sw.js"), "utf8");

type Listener = (event: Record<string, unknown>) => void;

function loadWorker(
  windows: { navigate: ReturnType<typeof vi.fn>; focus: ReturnType<typeof vi.fn> }[] = [],
) {
  const listeners: Record<string, Listener> = {};
  const waits: Promise<unknown>[] = [];
  const self = {
    addEventListener: (type: string, fn: Listener) => (listeners[type] = fn),
    skipWaiting: vi.fn(),
    location: { origin: "https://jp.example" },
    registration: {
      showNotification: vi.fn(
        async (_title: string, _options: { body: string; data: unknown }) => undefined,
      ),
    },
    clients: {
      claim: vi.fn(async () => undefined),
      matchAll: vi.fn(async () => windows),
      openWindow: vi.fn(async () => undefined),
    },
  };
  vm.runInNewContext(source, { self, URL });
  const fire = async (type: string, event: Record<string, unknown>) => {
    listeners[type]({ ...event, waitUntil: (p: Promise<unknown>) => waits.push(p) });
    await Promise.all(waits);
  };
  return { self, fire };
}

const pushEvent = (payload: unknown) => ({
  data:
    payload === undefined
      ? null
      : {
          json: () => (typeof payload === "string" ? JSON.parse(payload) : payload),
          text: () => (typeof payload === "string" ? payload : JSON.stringify(payload)),
        },
});

describe("service worker: push", () => {
  it("shows the alert with its title, body, app icon and screen", async () => {
    const { self, fire } = loadWorker();
    await fire(
      "push",
      pushEvent({ title: "JP Infracon", body: "Safety issue at Patia", route: "/issues" }),
    );
    expect(self.registration.showNotification).toHaveBeenCalledWith("JP Infracon", {
      body: "Safety issue at Patia",
      icon: "/icon-192.png",
      badge: "/icon-192.png",
      data: { route: "/issues" },
    });
  });

  it("falls back to the inbox when the screen is missing or not an app path", async () => {
    const { self, fire } = loadWorker();
    await fire("push", pushEvent({ body: "x", route: "https://evil.example" }));
    const [title, options] = self.registration.showNotification.mock.calls[0];
    expect(title).toBe("JP Infracon");
    expect(options.data).toEqual({ route: "/notifications" });
  });

  it("still shows plain text when the message is not JSON", async () => {
    const { self, fire } = loadWorker();
    await fire("push", {
      data: {
        json: () => {
          throw new Error("not json");
        },
        text: () => "Plain alert",
      },
    });
    expect(self.registration.showNotification.mock.calls[0][1].body).toBe("Plain alert");
  });

  it("shows a default alert for an empty push", async () => {
    const { self, fire } = loadWorker();
    await fire("push", pushEvent(undefined));
    expect(self.registration.showNotification).toHaveBeenCalledWith(
      "JP Infracon",
      expect.objectContaining({ body: "", data: { route: "/notifications" } }),
    );
  });
});

describe("service worker: tapping an alert", () => {
  it("opens the alert's screen in the app window that is already open", async () => {
    const win = { navigate: vi.fn(), focus: vi.fn(async () => undefined) };
    const { self, fire } = loadWorker([win]);
    const close = vi.fn();
    await fire("notificationclick", { notification: { close, data: { route: "/issues" } } });
    expect(close).toHaveBeenCalled();
    expect(win.navigate).toHaveBeenCalledWith("https://jp.example/issues");
    expect(win.focus).toHaveBeenCalled();
    expect(self.clients.openWindow).not.toHaveBeenCalled();
  });

  it("opens a new window when the app is closed", async () => {
    const { self, fire } = loadWorker([]);
    await fire("notificationclick", { notification: { close: vi.fn(), data: { route: "/po" } } });
    expect(self.clients.openWindow).toHaveBeenCalledWith("https://jp.example/po");
  });

  it("opens the inbox when the alert carries no screen", async () => {
    const { self, fire } = loadWorker([]);
    await fire("notificationclick", { notification: { close: vi.fn(), data: undefined } });
    expect(self.clients.openWindow).toHaveBeenCalledWith("https://jp.example/notifications");
  });
});
