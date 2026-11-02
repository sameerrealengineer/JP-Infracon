import { beforeAll, describe, expect, it, vi } from "vitest";

// The same swaps metro.config.js makes in the demo APK.
vi.mock("../../server/db", () => import("./server/db"));
vi.mock("../../server/_core/sdk", () => import("./server/sdk"));
vi.mock("../../server/storage", () => import("./server/storage"));

const { setDemoDriver } = await import("./runtime");
const { createNodeDriver } = await import("./testing/node-driver");
const { ensureDemoData } = await import("./backend");
const { signIn, callerFor } = await import("./seed");
const { DEMO_ACCOUNTS, DEMO_PASSWORD } = await import("./config");

describe("offline demo backend", () => {
  beforeAll(async () => {
    await setDemoDriver(createNodeDriver());
    await ensureDemoData();
  }, 60_000);

  it("signs in every demo account with the shared password", async () => {
    for (const account of DEMO_ACCOUNTS) {
      const caller = await signIn(account.username);
      const me = await caller.auth.me();
      expect(me?.name).toBe(account.displayName);
      expect(me?.mustChangePassword).toBe(false);
    }
  });

  it("rejects a wrong password", async () => {
    const guest = await callerFor(null);
    await expect(
      guest.auth.login({ username: "owner", password: `${DEMO_PASSWORD}x` }),
    ).rejects.toThrow();
  });

  it("reports the setup as done, so no bootstrap screen appears", async () => {
    const guest = await callerFor(null);
    expect(await guest.auth.bootstrapStatus()).toEqual({ initialized: true });
  });

  it("shows each person only the sites their role covers", async () => {
    const owner = await signIn("owner");
    const sites = await owner.jp.workspace.mySites();
    expect(sites.length).toBe(2);
    const supervisor = await signIn("supervisor");
    const caps = await supervisor.jp.workspace.myCapabilities();
    expect(caps.length).toBe(2);
    expect(caps.every((cap) => cap["dpr.create"] && !cap["dpr.review"])).toBe(true);
  });
});
