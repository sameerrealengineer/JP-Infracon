import { describe, expect, it } from "vitest";
import { isTaskStatusTransitionAllowed, previewTaskReschedule } from "./scheduling";

const tasks = [
  {
    id: "a",
    title: "Excavate",
    plannedStart: "2026-10-01",
    plannedEnd: "2026-10-02",
    status: "In Progress" as const,
  },
  {
    id: "b",
    title: "Lay pipe",
    plannedStart: "2026-10-04",
    plannedEnd: "2026-10-05",
    status: "Planned" as const,
  },
  {
    id: "c",
    title: "Backfill",
    plannedStart: "2026-10-07",
    plannedEnd: "2026-10-08",
    status: "Planned" as const,
  },
];
const dependencies = [
  { predecessorTaskId: "a", successorTaskId: "b", lagDays: 1 },
  { predecessorTaskId: "b", successorTaskId: "c", lagDays: 1 },
];

describe("task schedule impact", () => {
  it("previews the complete dependent chain and preserves its day offsets", () => {
    const preview = previewTaskReschedule({
      tasks,
      dependencies,
      selectedTaskId: "a",
      newStartDate: "2026-10-03",
      strategy: "shift_dependents",
    });
    expect(preview.canApply).toBe(true);
    expect(
      preview.impactedTasks.map((task) => [task.id, task.proposedStart, task.proposedEnd]),
    ).toEqual([
      ["a", "2026-10-03", "2026-10-04"],
      ["b", "2026-10-06", "2026-10-07"],
      ["c", "2026-10-09", "2026-10-10"],
    ]);
    expect(preview.blockingConflicts).toEqual([]);
  });

  it("keeps dependents unchanged and blocks a selected-only change that breaks finish-to-start", () => {
    const preview = previewTaskReschedule({
      tasks,
      dependencies,
      selectedTaskId: "a",
      newStartDate: "2026-10-05",
      strategy: "selected_only",
    });
    expect(preview.canApply).toBe(false);
    expect(preview.impactedTasks[1]?.willMove).toBe(false);
    expect(preview.blockingConflicts[0]?.kind).toBe("dependency_overlap");
  });

  it("does not shift a completed dependent task", () => {
    const withCompleted = tasks.map((task) =>
      task.id === "b" ? { ...task, status: "Completed" as const } : task,
    );
    const preview = previewTaskReschedule({
      tasks: withCompleted,
      dependencies,
      selectedTaskId: "a",
      newStartDate: "2026-10-03",
      strategy: "shift_dependents",
    });
    expect(preview.canApply).toBe(false);
    expect(preview.blockingConflicts.some((conflict) => conflict.kind === "terminal_task")).toBe(
      true,
    );
  });

  it("blocks automatic dependent shifts when field work is already in progress", () => {
    const withInProgress = tasks.map((task) =>
      task.id === "b" ? { ...task, status: "In Progress" as const } : task,
    );
    const preview = previewTaskReschedule({
      tasks: withInProgress,
      dependencies,
      selectedTaskId: "a",
      newStartDate: "2026-10-03",
      strategy: "shift_dependents",
    });
    expect(preview.canApply).toBe(false);
    expect(preview.impactedTasks.find((task) => task.id === "b")?.willMove).toBe(false);
    expect(preview.blockingConflicts.some((conflict) => conflict.kind === "terminal_task")).toBe(
      true,
    );
  });

  it("rejects a cycle reachable from the selected task", () => {
    expect(() =>
      previewTaskReschedule({
        tasks,
        dependencies: [
          ...dependencies,
          { predecessorTaskId: "c", successorTaskId: "a", lagDays: 0 },
        ],
        selectedTaskId: "a",
        newStartDate: "2026-10-03",
        strategy: "shift_dependents",
      }),
    ).toThrow("cycle");
  });
});

describe("task status transitions", () => {
  it("allows explicit field progression and keeps completed/cancelled terminal", () => {
    expect(isTaskStatusTransitionAllowed("Planned", "Ready")).toBe(true);
    expect(isTaskStatusTransitionAllowed("In Progress", "On Hold")).toBe(true);
    expect(isTaskStatusTransitionAllowed("Awaiting Inspection", "Completed")).toBe(true);
    expect(isTaskStatusTransitionAllowed("Completed", "In Progress")).toBe(false);
    expect(isTaskStatusTransitionAllowed("Cancelled", "Ready")).toBe(false);
  });
});
