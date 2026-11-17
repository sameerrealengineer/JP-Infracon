import { describe, expect, it } from "vitest";
import {
  eotSummary,
  hindranceCode,
  hindranceDays,
  hindranceProblem,
  mergedDays,
} from "./hindrance-domain";

describe("hindrance register", () => {
  it("counts inclusive days; an open hindrance runs to today", () => {
    expect(hindranceDays("2026-11-01", "2026-11-01", "2026-11-18")).toBe(1);
    expect(hindranceDays("2026-11-01", null, "2026-11-18")).toBe(18);
  });

  it("counts overlapping periods once for the EOT claim", () => {
    expect(
      mergedDays(
        [
          { startDate: "2026-11-01", endDate: "2026-11-05" },
          { startDate: "2026-11-04", endDate: "2026-11-08" },
          { startDate: "2026-11-10", endDate: "2026-11-10" },
        ],
        "2026-11-18",
      ),
    ).toBe(9);
    // Adjacent periods join without double counting.
    expect(
      mergedDays(
        [
          { startDate: "2026-11-01", endDate: "2026-11-02" },
          { startDate: "2026-11-03", endDate: "2026-11-03" },
        ],
        "2026-11-18",
      ),
    ).toBe(3);
  });

  it("separates full-stop and partial hindrances", () => {
    const s = eotSummary(
      [
        { startDate: "2026-11-01", endDate: "2026-11-03", affectsWork: "Full stop" },
        { startDate: "2026-11-02", endDate: null, affectsWork: "Partial" },
      ],
      "2026-11-05",
    );
    expect(s).toEqual({ fullStopDays: 3, partialDays: 4, open: 1 });
  });

  it("checks input and numbers the register", () => {
    const base = {
      category: "Rain or flood",
      description: "Heavy rain, site flooded",
      startDate: "2026-11-02",
      endDate: null,
      today: "2026-11-18",
    };
    expect(hindranceProblem(base)).toBeNull();
    expect(hindranceProblem({ ...base, category: "Aliens" })).toMatch(/caused/);
    expect(hindranceProblem({ ...base, startDate: "2026-12-01" })).toMatch(/future/);
    expect(hindranceProblem({ ...base, endDate: "2026-11-01" })).toMatch(/before/);
    expect(hindranceCode("SHG-OHT01", 7)).toBe("HIN-SHG-OHT01-007");
  });
});
