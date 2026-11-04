import { createHmac } from "node:crypto";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

// The WhatsApp bot over the demo SQLite database, with fake OpenWA and Gemini endpoints.
vi.mock("../../server/db", () => import("./server/db"));
vi.mock("../../server/_core/sdk", () => import("./server/sdk"));
vi.mock("../../server/storage", () => import("./server/storage"));

const { setDemoDriver } = await import("./runtime");
const { createNodeDriver } = await import("./testing/node-driver");
const { ensureDemoData } = await import("./backend");
const { signIn } = await import("./seed");
const { handleInbound, registerWhatsAppBot, validSignature } =
  await import("../../server/jp/whatsapp-bot");
const { BOT_TEXT } = await import("../jp/whatsapp-bot");
const express = (await import("express")).default;

const SECRET = "test-webhook-secret-1234";
const sent: { chatId: string; text: string }[] = [];
const prompts: string[] = [];
let modelReply = "Block A slab is 2 days behind plan.";
const realFetch = globalThis.fetch;
let server: ReturnType<ReturnType<typeof express>["listen"]>;
let base = "";

const message = (id: string, phone: string, body = "Kaunsi site peeche hai?", type = "text") => ({
  messageId: id,
  phone,
  text: body,
  type,
});

describe("whatsapp bot", () => {
  beforeAll(async () => {
    Object.assign(process.env, {
      WHATSAPP_BOT: "on",
      OPENWA_WEBHOOK_SECRET: SECRET,
      WHATSAPP_PROVIDER: "openwa",
      OPENWA_URL: "http://wa.test",
      OPENWA_API_KEY: "k",
      OPENWA_SESSION: "s1",
      GEMINI_API_KEY: "test-key",
    });
    vi.stubGlobal("fetch", async (url: string | URL, init?: RequestInit) => {
      const target = String(url);
      if (target.startsWith("http://wa.test")) {
        sent.push(JSON.parse(String(init?.body)));
        return new Response("{}", { status: 200 });
      }
      if (target.includes("generativelanguage.googleapis.com")) {
        prompts.push(String(init?.body ?? ""));
        return new Response(
          JSON.stringify({
            candidates: [
              {
                content: {
                  parts: [
                    { text: JSON.stringify({ reply: modelReply, action: { type: "none" } }) },
                  ],
                },
              },
            ],
          }),
          { status: 200 },
        );
      }
      return realFetch(url, init);
    });
    await setDemoDriver(createNodeDriver());
    await ensureDemoData();
    const supervisor = await signIn("supervisor");
    await supervisor.jp.notifications.updatePreferences({
      phone: "9876500001",
      whatsappOptIn: true,
      smsOptIn: false,
      pushOptIn: true,
    });
    const app = express();
    registerWhatsAppBot(app);
    server = app.listen(0);
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  }, 120_000);

  afterAll(() => {
    server?.close();
    vi.unstubAllGlobals();
    for (const key of [
      "WHATSAPP_BOT",
      "OPENWA_WEBHOOK_SECRET",
      "WHATSAPP_PROVIDER",
      "OPENWA_URL",
      "OPENWA_API_KEY",
      "OPENWA_SESSION",
      "GEMINI_API_KEY",
    ])
      delete process.env[key];
  });

  it("answers staff from their own data, once per message id", async () => {
    sent.length = 0;
    prompts.length = 0;
    const reply = await handleInbound(message("m1", "+919876500001"));
    expect(reply).toBe(modelReply);
    expect(sent).toEqual([{ chatId: "919876500001@c.us", text: modelReply }]);
    expect(prompts[0]).toContain("This chat is on WhatsApp");
    expect(prompts[0]).toContain("Demo Supervisor");
    // The same WhatsApp message delivered again is ignored.
    expect(await handleInbound(message("m1", "+919876500001"))).toBeNull();
    expect(sent).toHaveLength(1);
  });

  it("keeps the conversation as context", async () => {
    prompts.length = 0;
    modelReply = "Yes, Block A.";
    await handleInbound(message("m2", "+919876500001", "Kis block me?"));
    expect(prompts[0]).toContain("Kaunsi site peeche hai?");
    expect(prompts[0]).toContain("Block A slab is 2 days behind plan.");
  });

  it("tells a stranger once a day, without any company data or AI call", async () => {
    sent.length = 0;
    prompts.length = 0;
    expect(await handleInbound(message("s1", "+919000000009"))).toBe(BOT_TEXT.notStaff);
    expect(await handleInbound(message("s2", "+919000000009"))).toBeNull();
    expect(sent).toHaveLength(1);
    expect(prompts).toHaveLength(0);
  });

  it("asks for text when staff send a voice note", async () => {
    expect(await handleInbound(message("v1", "+919876500001", "", "voice"))).toBe(
      BOT_TEXT.textOnly,
    );
  });

  it("refuses unsigned or wrongly signed webhooks", async () => {
    const body = JSON.stringify({
      event: "message.received",
      data: { id: "w1", from: "919876500001@c.us", body: "hi", type: "text", fromMe: false },
    });
    const sign = (secret: string) =>
      `sha256=${createHmac("sha256", secret).update(body).digest("hex")}`;
    const post = (signature?: string) =>
      fetch(`${base}/api/whatsapp/webhook`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(signature ? { "X-OpenWA-Signature": signature } : {}),
        },
        body,
      });
    expect((await post()).status).toBe(401);
    expect((await post(sign("wrong-secret-1234567"))).status).toBe(401);
    expect((await post(sign(SECRET))).status).toBe(200);
    expect(validSignature(Buffer.from(body), sign(SECRET), SECRET)).toBe(true);
  });

  it("is off unless switched on", async () => {
    process.env.WHATSAPP_BOT = "off";
    try {
      const response = await fetch(`${base}/api/whatsapp/webhook`, { method: "POST", body: "{}" });
      expect(response.status).toBe(404);
    } finally {
      process.env.WHATSAPP_BOT = "on";
    }
  });
});
