import { describe, expect, it } from "vitest";
import { leaveHalfDays, leaveLengthText, leaveProblem, rangesOverlap } from "./leave-domain";

describe("leave domain", () => {
  it("counts half days", () => {
    expect(leaveHalfDays("2026-11-16", "2026-11-18", false)).toBe(6);
    expect(leaveHalfDays("2026-11-16", "2026-11-16", true)).toBe(1);
    expect(leaveLengthText(6)).toBe("3 days");
    expect(leaveLengthText(1)).toBe("½ day");
    expect(leaveLengthText(3)).toBe("1½ days");
    expect(leaveLengthText(2)).toBe("1 day");
  });

  it("checks requests", () => {
    const ok = {
      fromDate: "2026-11-16",
      toDate: "2026-11-17",
      halfDay: false,
      reason: "Family function",
    };
    expect(leaveProblem(ok)).toBeNull();
    expect(leaveProblem({ ...ok, toDate: "2026-11-15" })).toMatch(/ends before/);
    expect(leaveProblem({ ...ok, halfDay: true })).toMatch(/same day/);
    expect(leaveProblem({ ...ok, reason: "x" })).toMatch(/reason/);
    expect(leaveProblem({ ...ok, toDate: "2027-03-01" })).toMatch(/90 days/);
  });

  it("finds overlaps", () => {
    const a = { fromDate: "2026-11-16", toDate: "2026-11-18" };
    expect(rangesOverlap(a, { fromDate: "2026-11-18", toDate: "2026-11-20" })).toBe(true);
    expect(rangesOverlap(a, { fromDate: "2026-11-19", toDate: "2026-11-20" })).toBe(false);
  });
});
