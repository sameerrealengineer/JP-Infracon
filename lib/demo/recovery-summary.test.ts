import { beforeAll, describe, expect, it, vi } from "vitest";

// Staff forgot username/password by WhatsApp code, and the night summary, over the demo
// database through the real procedures. WhatsApp sending is faked so the test can read the code.
vi.mock("../../server/db", () => import("./server/db"));
vi.mock("../../server/_core/sdk", () => import("./server/sdk"));
vi.mock("../../server/storage", () => import("./server/storage"));

const sent: { phone: string; text: string }[] = [];
vi.mock("../../server/jp/notify", async (importOriginal) => {
  const real = await importOriginal<typeof import("../../server/jp/notify")>();
  return {
    ...real,
    sendWhatsAppText: async (phone: string, text: string) => {
      sent.push({ phone, text });
      return true;
    },
  };
});

const { setDemoDriver } = await import("./runtime");
const { createNodeDriver } = await import("./testing/node-driver");
const { ensureDemoData } = await import("./backend");
const { signIn, callerFor } = await import("./seed");
const { sendDailySummaries } = await import("../../server/jp/daily-summary");

type Caller = Awaited<ReturnType<typeof signIn>>;
let owner: Caller, supervisor: Caller;

describe("forgot login and day summary", () => {
  beforeAll(async () => {
    await setDemoDriver(createNodeDriver());
    await ensureDemoData();
    [owner, supervisor] = await Promise.all(["owner", "supervisor"].map(signIn));
    await supervisor.jp.notifications.updatePreferences({
      phone: "9876501234",
      whatsappOptIn: true,
      smsOptIn: false,
      pushOptIn: true,
    });
    await owner.jp.notifications.updatePreferences({
      phone: "9876505678",
      whatsappOptIn: true,
      smsOptIn: false,
      pushOptIn: true,
    });
  }, 120_000);

  it("gives the same answer for an unknown number and sends nothing", async () => {
    const guest = await callerFor(null);
    const before = sent.length;
    const answer = await guest.auth.staffForgotLogin({ mobile: "9000000009" });
    expect(answer.message).toMatch(/If this number is saved/);
    expect(sent.length).toBe(before);
  });

  it("sends the username and a code, and the code sets a new password", async () => {
    const guest = await callerFor(null);
    await guest.auth.staffForgotLogin({ mobile: "+91 98765 01234" });
    const message = sent.at(-1)!;
    expect(message.phone).toBe("+919876501234");
    expect(message.text).toContain("username is supervisor");
    const code = /code to set a new password is (\d{6})/.exec(message.text)![1]!;
    await expect(
      guest.auth.staffResetPassword({
        mobile: "9876501234",
        code: code === "111111" ? "222222" : "111111",
        username: "supervisor",
        password: "a-new-long-password-1",
      }),
    ).rejects.toThrow(/wrong or has expired/);
    await expect(
      guest.auth.staffResetPassword({
        mobile: "9876501234",
        code,
        username: "owner",
        password: "a-new-long-password-1",
      }),
    ).rejects.toThrow(/not saved with this mobile/);
    const done = await guest.auth.staffResetPassword({
      mobile: "9876501234",
      code,
      username: "supervisor",
      password: "a-new-long-password-1",
    });
    expect(done.username).toBe("supervisor");
    const login = await guest.auth.login({
      username: "supervisor",
      password: "a-new-long-password-1",
    });
    expect(login.user.id).toBeGreaterThan(0);
    // The code works once.
    await expect(
      guest.auth.staffResetPassword({
        mobile: "9876501234",
        code,
        username: "supervisor",
        password: "another-long-password-2",
      }),
    ).rejects.toThrow(/wrong or has expired/);
  });

  it("shows today's summary in the app and sends it once at night", async () => {
    const mine = await owner.jp.dailySummary.today();
    expect(mine.text).toContain("Patia Tower A");
    expect(mine.text).toContain("Attendance:");
    const before = sent.length;
    const first = await sendDailySummaries(new Date());
    expect(first.sent).toBeGreaterThanOrEqual(2);
    const texts = sent.slice(before).map((row) => row.text);
    expect(texts.every((text) => text.startsWith("JP Infracon — day summary"))).toBe(true);
    const again = await sendDailySummaries(new Date());
    expect(again.sent).toBe(0);
  });
});
