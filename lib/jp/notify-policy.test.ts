import { describe, expect, it } from "vitest";
import {
  alertText,
  expoPushRequest,
  isExpoPushToken,
  normalizeIndianMobile,
  smsRequest,
  whatsappMediaRequest,
  whatsappRequest,
} from "./notify-policy";

describe("normalizeIndianMobile", () => {
  it("accepts common Indian formats", () => {
    expect(normalizeIndianMobile("98765 43210")).toBe("+919876543210");
    expect(normalizeIndianMobile("+91-98765-43210")).toBe("+919876543210");
    expect(normalizeIndianMobile("09876543210")).toBe("+919876543210");
  });
  it("rejects invalid numbers", () => {
    expect(normalizeIndianMobile("12345")).toBeNull();
    expect(normalizeIndianMobile("+91 1234567890")).toBeNull();
    expect(normalizeIndianMobile("")).toBeNull();
  });
});

describe("gateway requests", () => {
  const openwa = {
    provider: "openwa" as const,
    baseUrl: "http://openwa:2785/",
    apiKey: "k",
    session: "jp main",
  };
  it("builds an OpenWA send-text call", () => {
    const req = whatsappRequest(openwa, "+919876543210", "hi");
    expect(req.url).toBe("http://openwa:2785/api/sessions/jp%20main/messages/send-text");
    expect(req.headers["X-API-Key"]).toBe("k");
    expect(JSON.parse(req.body)).toEqual({ chatId: "919876543210@c.us", text: "hi" });
  });
  it("builds media calls for every gateway", () => {
    const media = {
      kind: "image" as const,
      url: "https://files.example/p.jpg",
      mimetype: "image/jpeg",
      filename: "p.jpg",
      caption: "Slab photo",
    };
    const open = whatsappMediaRequest(openwa, "+919876543210", { ...media, kind: "video" });
    expect(open.url).toBe("http://openwa:2785/api/sessions/jp%20main/messages/send-video");
    expect(JSON.parse(open.body)).toMatchObject({
      chatId: "919876543210@c.us",
      url: media.url,
      mimetype: "image/jpeg",
      caption: "Slab photo",
    });
    const waha = whatsappMediaRequest(
      { provider: "waha", baseUrl: "http://wa:3000", session: "default" },
      "+919876543210",
      { ...media, kind: "document" },
    );
    expect(waha.url).toBe("http://wa:3000/api/sendFile");
    expect(JSON.parse(waha.body).file.url).toBe(media.url);
    const evo = whatsappMediaRequest(
      { provider: "evolution", baseUrl: "https://evo.example", apiKey: "k", instance: "jp" },
      "+919876543210",
      media,
    );
    expect(evo.url).toBe("https://evo.example/message/sendMedia/jp");
    expect(JSON.parse(evo.body)).toMatchObject({ number: "919876543210", mediatype: "image" });
    const cloud = whatsappMediaRequest(
      { provider: "cloud", token: "t", phoneNumberId: "123" },
      "+919876543210",
      media,
    );
    expect(JSON.parse(cloud.body)).toMatchObject({
      type: "image",
      image: { link: media.url, caption: "Slab photo" },
    });
  });
  it("builds a WAHA sendText call", () => {
    const req = whatsappRequest(
      { provider: "waha", baseUrl: "http://wa:3000/", apiKey: "k", session: "default" },
      "+919876543210",
      "hi",
    );
    expect(req.url).toBe("http://wa:3000/api/sendText");
    expect(req.headers["X-Api-Key"]).toBe("k");
    expect(JSON.parse(req.body)).toEqual({
      session: "default",
      chatId: "919876543210@c.us",
      text: "hi",
    });
  });
  it("builds an Evolution API sendText call", () => {
    const req = whatsappRequest(
      { provider: "evolution", baseUrl: "https://evo.example", apiKey: "k", instance: "jp main" },
      "+919876543210",
      "hi",
    );
    expect(req.url).toBe("https://evo.example/message/sendText/jp%20main");
    expect(req.headers.apikey).toBe("k");
    expect(JSON.parse(req.body)).toEqual({ number: "919876543210", text: "hi" });
  });
  it("builds a WhatsApp Cloud API call", () => {
    const req = whatsappRequest(
      { provider: "cloud", token: "t", phoneNumberId: "123" },
      "+919876543210",
      "hi",
    );
    expect(req.url).toContain("/123/messages");
    expect(req.headers.Authorization).toBe("Bearer t");
  });
  it("builds SMS gateway calls", () => {
    const asg = smsRequest(
      {
        provider: "android-sms-gateway",
        baseUrl: "https://api.sms-gate.app/3rdparty/v1",
        username: "u",
        password: "p",
      },
      "+919876543210",
      "hi",
    );
    expect(asg.url).toBe("https://api.sms-gate.app/3rdparty/v1/message");
    expect(asg.headers.Authorization).toBe(`Basic ${Buffer.from("u:p").toString("base64")}`);
    expect(JSON.parse(asg.body)).toEqual({
      textMessage: { text: "hi" },
      phoneNumbers: ["+919876543210"],
    });
    const tb = smsRequest(
      {
        provider: "textbee",
        baseUrl: "https://api.textbee.dev/api/v1",
        deviceId: "d1",
        apiKey: "k",
      },
      "+919876543210",
      "hi",
    );
    expect(tb.url).toBe("https://api.textbee.dev/api/v1/gateway/devices/d1/send-sms");
    expect(JSON.parse(tb.body)).toEqual({ recipients: ["+919876543210"], message: "hi" });
  });
  it("builds Expo push batches and validates tokens", () => {
    const req = expoPushRequest([{ to: "ExponentPushToken[abc]", title: "t", body: "b" }]);
    expect(JSON.parse(req.body)[0]).toMatchObject({
      to: "ExponentPushToken[abc]",
      priority: "high",
    });
    expect(isExpoPushToken("ExponentPushToken[abc-123]")).toBe(true);
    expect(isExpoPushToken("random")).toBe(false);
  });
  it("keeps alert text short and generic", () => {
    const text = alertText({
      title: "Critical issue reported",
      siteName: "Balugaon",
      detail: "x".repeat(300),
    });
    expect(text).toContain("Site: Balugaon");
    expect(text.length).toBeLessThan(300);
  });
});
