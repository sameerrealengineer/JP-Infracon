import { describe, expect, it } from "vitest";
import { expectedTenths, summarizeProgress, taskProgressTenths } from "./progress-domain";

describe("task progress", () => {
  it("counts completed as 100% and caps reported progress below 100", () => {
    expect(taskProgressTenths({ status: "Completed", reportedPercent: 40 })).toBe(1000);
    expect(taskProgressTenths({ status: "In Progress", reportedPercent: 100 })).toBe(999);
    expect(taskProgressTenths({ status: "In Progress", reportedPercent: 42.55 })).toBe(426);
    expect(taskProgressTenths({ status: "Planned", reportedPercent: null })).toBe(0);
  });

  it("expects even progress over the planned dates", () => {
    const task = { plannedStart: "2026-11-01", plannedEnd: "2026-11-10" };
    expect(expectedTenths(task, "2026-10-31")).toBe(0);
    expect(expectedTenths(task, "2026-11-05")).toBe(500);
    expect(expectedTenths(task, "2026-11-11")).toBe(1000);
  });
});

describe("summarizeProgress", () => {
  it("weights by duration, skips cancelled tasks and reports health", () => {
    const summary = summarizeProgress(
      [
        {
          status: "Completed",
          plannedStart: "2026-11-01",
          plannedEnd: "2026-11-02",
          reportedPercent: null,
        },
        {
          status: "In Progress",
          plannedStart: "2026-11-01",
          plannedEnd: "2026-11-08",
          reportedPercent: 25,
        },
        {
          status: "Cancelled",
          plannedStart: "2026-11-01",
          plannedEnd: "2026-12-31",
          reportedPercent: null,
        },
        {
          status: "Blocked",
          plannedStart: "2026-10-20",
          plannedEnd: "2026-10-30",
          reportedPercent: 10,
        },
      ],
      "2026-11-05",
    );
    // Weights 2, 8, 11 days: (2*1000 + 8*250 + 11*100) / 21 = 243
    expect(summary).toMatchObject({
      actualTenths: 243,
      total: 3,
      completed: 1,
      inProgress: 1,
      overdue: 1,
      blocked: 1,
      health: "behind",
    });
  });

  it("returns empty values without tasks", () => {
    expect(summarizeProgress([], "2026-11-05")).toMatchObject({ actualTenths: null, health: null });
  });
});
