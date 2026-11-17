import { describe, expect, it } from "vitest";
import { bbsCsv, bbsLine, bbsProblem, bbsTotals, cuttingLengthMm } from "./bbs";

describe("bar bending schedule", () => {
  it("works out cutting lengths by shape", () => {
    expect(cuttingLengthMm({ dia: 12, shape: "Straight", a: 3000, b: 0 })).toBe(3000);
    expect(cuttingLengthMm({ dia: 12, shape: "Straight with 2 hooks", a: 3000, b: 0 })).toBe(3216);
    expect(cuttingLengthMm({ dia: 10, shape: "L-bar", a: 1000, b: 300 })).toBe(1280);
    // 230×450 beam, 25 mm cover → stirrup 180×400 inside, 8 mm: 2(580)+64 = 1224.
    expect(cuttingLengthMm({ dia: 8, shape: "Stirrup (rectangular)", a: 180, b: 400 })).toBe(1224);
    expect(cuttingLengthMm({ dia: 12, shape: "Crank (bent-up)", a: 4000, b: 150 })).toBeCloseTo(
      4015,
      0,
    );
  });

  it("weighs bars and totals by diameter with 12 m bars to order", () => {
    const line = bbsLine({
      mark: "B1",
      member: "Beam",
      dia: 16,
      shape: "Straight",
      a: 6000,
      b: 0,
      bars: 4,
      members: 5,
    });
    expect(line.totalBars).toBe(20);
    expect(line.kg).toBeCloseTo(189.63, 1);
    const totals = bbsTotals([line], 0);
    expect(totals.byDia).toEqual([{ dia: 16, kg: line.kg, bars12m: 10 }]);
    expect(bbsCsv([line], 3)).toContain("Total steel (kg),189.63");
  });

  it("explains a missing value", () => {
    expect(
      bbsProblem({
        mark: "",
        member: "",
        dia: 12,
        shape: "L-bar",
        a: 1000,
        b: 0,
        bars: 1,
        members: 1,
      }),
    ).toMatch(/Enter B/);
  });
});
