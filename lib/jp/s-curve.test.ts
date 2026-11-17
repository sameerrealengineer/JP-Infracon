import { describe, expect, it } from "vitest";
import { ganttRows, sCurve } from "./s-curve";

const tasks = [
  {
    id: "a",
    code: "T1",
    title: "Excavation",
    status: "Completed",
    plannedStart: "2026-11-01",
    plannedEnd: "2026-11-10",
  },
  {
    id: "b",
    code: "T2",
    title: "Footing",
    status: "In Progress",
    plannedStart: "2026-11-11",
    plannedEnd: "2026-11-20",
  },
];

describe("S-curve and Gantt", () => {
  it("plans 0 → 100% and follows the reports for actual", () => {
    const curve = sCurve(
      tasks,
      [
        { taskId: "a", date: "2026-11-09", percent: 100 },
        { taskId: "b", date: "2026-11-15", percent: 40 },
      ],
      "2026-11-16",
      5,
    );
    expect(curve.points[0]!.planned).toBeGreaterThanOrEqual(0);
    expect(curve.points.at(-1)!.planned).toBe(100);
    const lastActual = curve.points.filter((p) => p.actual !== null).at(-1)!;
    expect(lastActual.actual).toBeGreaterThan(50);
    expect(curve.points.at(-1)!.actual).toBeNull();
  });

  it("places Gantt bars and marks late tasks", () => {
    const g = ganttRows(tasks, "2026-11-25");
    expect(g.days).toBe(20);
    expect(g.rows.map((row) => [row.offset, row.length, row.late])).toEqual([
      [0, 10, false],
      [10, 10, true],
    ]);
  });
});
