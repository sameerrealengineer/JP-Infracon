import { describe, expect, it } from "vitest";
import {
  JOURNEY,
  EXTRA_MODULES,
  journeyLevel,
  journeyView,
  lockedByJourney,
  parseJourney,
} from "./journey";
import { MODULE_KEYS } from "./modules";

const zero = {
  sites: 0,
  workers: 0,
  attendanceDays: 0,
  dprs: 0,
  moneyEntries: 0,
  materialRequests: 0,
  workOrders: 0,
};

describe("step-by-step journey", () => {
  it("covers every module exactly once across steps and extras", () => {
    const all = [...JOURNEY.flatMap((step) => step.modules), ...EXTRA_MODULES];
    expect([...all].sort()).toEqual([...MODULE_KEYS].sort());
  });

  it("starts at step 1 with only Workforce open", () => {
    expect(journeyLevel(zero)).toBe(1);
    const locked = lockedByJourney(1, parseJourney(null));
    expect(MODULE_KEYS.filter((key) => !locked.includes(key))).toEqual(["workforce", "contracts"]);
  });

  it("opens each step only after the previous goal is met, in order", () => {
    expect(journeyLevel({ ...zero, sites: 1, workers: 3 })).toBe(2);
    // Later goals do not count while an earlier one is open.
    expect(journeyLevel({ ...zero, sites: 1, workers: 2, dprs: 10 })).toBe(1);
    expect(journeyLevel({ ...zero, sites: 1, workers: 5, attendanceDays: 3, dprs: 3 })).toBe(4);
    expect(
      journeyLevel({
        sites: 1,
        workers: 9,
        attendanceDays: 9,
        dprs: 9,
        moneyEntries: 1,
        materialRequests: 1,
        workOrders: 1,
      }),
    ).toBe(7);
  });

  it("keeps extras closed until a leader opens them, and all mode opens everything", () => {
    expect(lockedByJourney(7, parseJourney(null))).toEqual(
      expect.arrayContaining([...EXTRA_MODULES]),
    );
    expect(
      lockedByJourney(1, parseJourney('{"mode":"guided","early":["crm","bogus"]}')),
    ).not.toContain("crm");
    expect(lockedByJourney(1, parseJourney('{"mode":"all"}'))).toEqual([]);
    expect(parseJourney("not json")).toEqual({ mode: "guided", early: [] });
  });

  it("shows the current goal and what it opens", () => {
    const view = journeyView({ ...zero, sites: 1, workers: 1 }, parseJourney(null));
    expect(view.level).toBe(1);
    expect(view.next).toEqual({ label: "Add 3 workers", done: 1, target: 3, opens: "Attendance" });
    expect(view.steps.map((s) => s.state)).toEqual([
      "current",
      "locked",
      "locked",
      "locked",
      "locked",
      "locked",
      "locked",
    ]);
  });
});
