import { describe, expect, it } from "vitest";
import {
  ageBucket,
  bucketOf,
  bucketStarts,
  rangeFor,
  seriesByBucket,
  shortRupees,
  topByAmount,
} from "./analytics";

describe("analytics helpers", () => {
  it("uses days up to a month and Monday weeks beyond", () => {
    const week = rangeFor("2026-11-17", 7);
    expect(week).toEqual({ from: "2026-11-11", to: "2026-11-17" });
    expect(bucketStarts(week.from, week.to).starts).toHaveLength(7);
    const quarter = bucketStarts("2026-08-20", "2026-11-17");
    expect(quarter.size).toBe("week");
    expect(quarter.starts[0]).toBe("2026-08-17"); // a Monday
    expect(bucketOf("2026-08-19", quarter.starts)).toBe(0);
  });

  it("sums exact paise per bucket and series", () => {
    const s = seriesByBucket(
      [
        { date: "2026-11-11", series: "Suppliers", amountMinor: "150" },
        { date: "2026-11-11", series: "Suppliers", amountMinor: "50" },
        { date: "2026-11-12", series: "Petty cash", amountMinor: "7" },
        { date: "2026-10-01", series: "Suppliers", amountMinor: "999" },
      ],
      ["2026-11-11", "2026-11-12"],
      ["Suppliers", "Petty cash"],
    );
    expect(s).toEqual({ Suppliers: ["200", "0"], "Petty cash": ["0", "7"] });
  });

  it("ranks, ages and shortens amounts", () => {
    expect(
      topByAmount(
        [
          { key: "A", amountMinor: "5" },
          { key: "B", amountMinor: "9" },
          { key: "A", amountMinor: "5" },
        ],
        1,
      ),
    ).toEqual([{ key: "A", amountMinor: "10" }]);
    expect(ageBucket("2026-11-20", "2026-11-01", "2026-11-17")).toBe("Not due");
    expect(ageBucket(null, "2026-08-01", "2026-11-17")).toBe("Over 90 days");
    expect(shortRupees("125000000")).toBe("₹12.5 L");
    expect(shortRupees("4500000")).toBe("₹45,000");
    expect(shortRupees("2500000000")).toBe("₹2.5 Cr");
  });
});
