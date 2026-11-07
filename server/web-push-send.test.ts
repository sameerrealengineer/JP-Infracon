import { describe, expect, it } from "vitest";
import { sendWebPush, webPushPublicKey } from "./web-push-send";

const target = {
  endpoint: "https://push.example/abc",
  p256dh: "x".repeat(20),
  auth: "y".repeat(10),
};

describe("web push", () => {
  it("is off until both keys are set", () => {
    expect(webPushPublicKey({})).toBeNull();
    expect(webPushPublicKey({ WEB_PUSH_PUBLIC_KEY: "pub" })).toBeNull();
    expect(webPushPublicKey({ WEB_PUSH_PUBLIC_KEY: "pub", WEB_PUSH_PRIVATE_KEY: "priv" })).toBe(
      "pub",
    );
  });

  it("does not send without keys", async () => {
    const result = await sendWebPush(target, { title: "t", body: "b", route: "/" }, {});
    expect(result).toEqual({ ok: false, gone: false, detail: "web push not set up" });
  });
});
