import { beforeEach, describe, expect, it, vi } from "vitest";

// The web-push library is the network boundary; it is faked so nothing is sent.
// A plain fake (not vi.fn) so a rejected send is only seen by the code under test.
type Send = (...args: unknown[]) => Promise<{ statusCode: number }>;
const calls: unknown[][] = [];
let respond: Send = async () => ({ statusCode: 201 });
const sendNotification = {
  mockImplementation(fn: Send) {
    respond = fn;
  },
  mockResolvedValue(value: { statusCode: number }) {
    respond = async () => value;
  },
  mock: { calls },
};
vi.mock("web-push", () => ({
  default: {
    sendNotification: (...args: unknown[]) => {
      calls.push(args);
      return respond(...args);
    },
  },
}));

const { sendWebPush, webPushPublicKey } = await import("./web-push-send");
const env = (values: Record<string, string>) => values as unknown as NodeJS.ProcessEnv;

const target = {
  endpoint: "https://push.example/abc",
  p256dh: "x".repeat(20),
  auth: "y".repeat(10),
};
const message = { title: "JP Infracon", body: "Safety issue", route: "/issues" };
const keys = {
  WEB_PUSH_PUBLIC_KEY: "pub",
  WEB_PUSH_PRIVATE_KEY: "priv",
  WEB_PUSH_SUBJECT: "https://jp.example",
} as unknown as NodeJS.ProcessEnv;

describe("web push", () => {
  beforeEach(() => {
    calls.length = 0;
    respond = async () => ({ statusCode: 201 });
  });

  it("is off until both keys are set", () => {
    expect(webPushPublicKey(env({}))).toBeNull();
    expect(webPushPublicKey(env({ WEB_PUSH_PUBLIC_KEY: "pub" }))).toBeNull();
    expect(
      webPushPublicKey(env({ WEB_PUSH_PUBLIC_KEY: "pub", WEB_PUSH_PRIVATE_KEY: "priv" })),
    ).toBe("pub");
  });

  it("ignores keys that are only spaces", () => {
    expect(
      webPushPublicKey(env({ WEB_PUSH_PUBLIC_KEY: "  ", WEB_PUSH_PRIVATE_KEY: "priv" })),
    ).toBeNull();
  });

  it("does not send without keys", async () => {
    const result = await sendWebPush(target, message, {} as unknown as NodeJS.ProcessEnv);
    expect(result).toEqual({ ok: false, gone: false, detail: "web push not set up" });
    expect(calls).toHaveLength(0);
  });

  it("sends the message as JSON with the VAPID keys and reports success", async () => {
    sendNotification.mockResolvedValue({ statusCode: 201 });
    const result = await sendWebPush(target, message, keys);
    expect(result).toEqual({ ok: true, gone: false, detail: "web push 201" });
    const [subscription, payload, options] = sendNotification.mock.calls[0] as [
      unknown,
      string,
      { vapidDetails: unknown },
    ];
    expect(subscription).toEqual({
      endpoint: target.endpoint,
      keys: { p256dh: target.p256dh, auth: target.auth },
    });
    expect(JSON.parse(payload)).toEqual(message);
    expect(options.vapidDetails).toEqual({
      subject: "https://jp.example",
      publicKey: "pub",
      privateKey: "priv",
    });
  });

  it.each([404, 410])(
    "marks the subscription gone when the push service answers %i",
    async (code) => {
      sendNotification.mockImplementation(async () => {
        throw { message: "gone", statusCode: code };
      });
      expect(await sendWebPush(target, message, keys)).toEqual({
        ok: false,
        gone: true,
        detail: `web push ${code}`,
      });
    },
  );

  it("keeps the subscription on a temporary failure", async () => {
    sendNotification.mockImplementation(async () => {
      throw { message: "busy", statusCode: 503 };
    });
    expect(await sendWebPush(target, message, keys)).toEqual({
      ok: false,
      gone: false,
      detail: "web push 503",
    });
  });

  it("never throws on a network error and never puts the private key in the detail", async () => {
    sendNotification.mockImplementation(async () => {
      throw { message: "ECONNRESET priv" };
    });
    const result = await sendWebPush(target, message, keys);
    expect(result).toEqual({ ok: false, gone: false, detail: "web push error" });
    expect(result.detail).not.toContain("priv");
  });
});
