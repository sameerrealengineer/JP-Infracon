import { beforeAll, describe, expect, it, vi } from "vitest";

// Cash-flow forecast over the demo database: approved bills to pay and receive, by week.
vi.mock("../../server/db", () => import("./server/db"));
vi.mock("../../server/_core/sdk", () => import("./server/sdk"));
vi.mock("../../server/storage", () => import("./server/storage"));

const { setDemoDriver } = await import("./runtime");
const { createNodeDriver } = await import("./testing/node-driver");
const { ensureDemoData } = await import("./backend");
const { signIn } = await import("./seed");

describe("cash-flow forecast", () => {
  beforeAll(async () => {
    await setDemoDriver(createNodeDriver());
    await ensureDemoData();
  }, 120_000);

  it("lists approved money to come and go, with a running balance from the opening figure", async () => {
    const owner = await signIn("owner");
    const zero = await owner.jp.cashflow.forecast({ days: 60, openingRupees: "0" });
    expect(zero.rows[0]!.label).toBe("Overdue");
    const withCash = await owner.jp.cashflow.forecast({ days: 60, openingRupees: "100000" });
    expect(
      BigInt(withCash.rows.at(-1)!.balanceMinor) - BigInt(zero.rows.at(-1)!.balanceMinor),
    ).toBe(10000000n);
    for (const e of zero.entries) expect(BigInt(e.amountMinor) > 0n).toBe(true);
  });

  it("is not for supervisors", async () => {
    const supervisor = await signIn("supervisor");
    await expect(supervisor.jp.cashflow.forecast({ days: 30, openingRupees: "0" })).rejects.toThrow(
      /contract.view/,
    );
  });
});
