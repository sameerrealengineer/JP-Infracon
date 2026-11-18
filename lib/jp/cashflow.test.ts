import { describe, expect, it } from "vitest";
import { expectedDate, forecast } from "./cashflow";

const e = (date: string, direction: "in" | "out", amountMinor: string) => ({
  date,
  direction,
  amountMinor,
  kind: "",
  who: "",
  reference: "",
});

describe("cash-flow forecast", () => {
  it("uses the due date, else the document date plus credit days", () => {
    expect(expectedDate(null, "2026-11-01", 30)).toBe("2026-12-01");
    expect(expectedDate("2026-11-20", "2026-11-01", 30)).toBe("2026-11-20");
  });

  it("puts past items in Overdue, the rest by week, and runs a balance", () => {
    const f = forecast(
      [
        e("2026-11-10", "out", "5000000"),
        e("2026-11-19", "in", "20000000"),
        e("2026-11-26", "out", "30000000"),
        e("2027-03-01", "in", "1"),
      ],
      "2026-11-18",
      14,
      1000000n,
    );
    expect(f.rows.map((r) => r.label)).toEqual(["Overdue", "2026-11-18", "2026-11-25"]);
    expect(f.rows.map((r) => r.balanceMinor)).toEqual(["-4000000", "16000000", "-14000000"]);
    expect(f.shortfall).toBe(true);
    expect(f.lowestBalance.label).toBe("2026-11-25");
    expect(f.laterInMinor).toBe("1");
  });
});
