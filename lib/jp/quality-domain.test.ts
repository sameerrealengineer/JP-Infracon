import { describe, expect, it } from "vitest";
import {
  cubeDueDates,
  cubeVerdict,
  gradeStrength,
  parseResults,
  rangeVerdict,
  reconcile,
  testState,
  theoretical,
} from "./quality-domain";

describe("quality tests and reconciliation", () => {
  it("reads grades and due dates", () => {
    expect(gradeStrength("M20")).toBe(20);
    expect(gradeStrength("m7.5")).toBe(7.5);
    expect(gradeStrength("C20")).toBeNull();
    expect(cubeDueDates("2026-11-01")).toEqual({
      sevenDay: "2026-11-08",
      twentyEightDay: "2026-11-29",
    });
    expect(parseResults("21.5, 22 20.8")).toEqual([21.5, 22, 20.8]);
    expect(parseResults("21, x")).toBeNull();
  });

  it("judges cube sets per IS 456 per-sample check", () => {
    expect(cubeVerdict("M20", 28, [21.5, 22, 20.8])!.pass).toBe(true);
    expect(cubeVerdict("M20", 28, [24, 24, 16.5])!.pass).toBe(false); // lowest below 17
    expect(cubeVerdict("M20", 28, [19, 19.5, 19.8])!.pass).toBe(false); // average below 20
    expect(cubeVerdict("M15", 28, [16.5, 16, 13.1])!.pass).toBe(true); // floor 13 for M15
    expect(cubeVerdict("M15", 28, [15.5, 15.2, 13.1])!.pass).toBe(false); // average 14.6
    expect(cubeVerdict("M20", 7, [14, 13.5, 13.2])!.pass).toBe(true); // 65% of 20 = 13
  });

  it("checks ranges and test state", () => {
    expect(rangeVerdict([75, 90], 50, 100)!.pass).toBe(true);
    expect(rangeVerdict([120], 50, 100)!.pass).toBe(false);
    expect(testState({ dueDate: "2026-11-10", status: "Pending", pass: null }, "2026-11-18")).toBe(
      "Overdue",
    );
    expect(testState({ dueDate: "2026-11-20", status: "Pending", pass: null }, "2026-11-18")).toBe(
      "Due",
    );
    expect(testState({ dueDate: null, status: "Done", pass: false }, "2026-11-18")).toBe("Failed");
  });

  it("reconciles cement and steel against theoretical consumption", () => {
    // 10 m³ of M20 at 8.07 bags/m³ = 80.7 bags.
    const t = theoretical([{ workThousandths: 10000n, perUnitThousandths: 8070n }]);
    expect(t).toBe(80700n);
    expect(reconcile("Cement", t, 82000n)).toEqual({ variancePct: 1.61, ok: true });
    expect(reconcile("Cement", t, 85000n).ok).toBe(false);
    expect(reconcile("Steel", 0n, 5n)).toEqual({ variancePct: null, ok: null });
  });
});
