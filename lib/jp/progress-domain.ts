/**
 * Progress of a site or project, worked out from its tasks. A task counts 100% when Completed;
 * otherwise its last reported DPR percent (capped below 100 until it is completed). Tasks are
 * weighted by planned duration, so a long task moves the total more than a short one. Cancelled
 * tasks are left out. This is an estimate for the dashboard, never a payment basis.
 */

export type ProgressTask = {
  status: string;
  plannedStart: string;
  plannedEnd: string;
  /** Latest DPR estimated percent for this task, 0–100, or null when never reported. */
  reportedPercent: number | null;
};

const DAY = 86_400_000;

function days(start: string, end: string) {
  const span = Math.round(
    (Date.parse(`${end}T00:00:00Z`) - Date.parse(`${start}T00:00:00Z`)) / DAY,
  );
  return Number.isFinite(span) ? Math.max(1, span + 1) : 1;
}

/** One task's progress in tenths of a percent (0–1000). */
export function taskProgressTenths(task: Pick<ProgressTask, "status" | "reportedPercent">) {
  if (task.status === "Completed") return 1000;
  if (task.reportedPercent === null || !Number.isFinite(task.reportedPercent)) return 0;
  return Math.max(0, Math.min(999, Math.round(task.reportedPercent * 10)));
}

/** Where the work should be by `today` if every task ran evenly over its planned dates. */
export function expectedTenths(
  task: Pick<ProgressTask, "plannedStart" | "plannedEnd">,
  today: string,
) {
  const total = days(task.plannedStart, task.plannedEnd);
  if (today < task.plannedStart) return 0;
  if (today > task.plannedEnd) return 1000;
  return Math.round((days(task.plannedStart, today) / total) * 1000);
}

export type ProgressSummary = {
  /** Weighted actual progress, tenths of a percent; null without tasks. */
  actualTenths: number | null;
  expectedTenths: number | null;
  total: number;
  completed: number;
  inProgress: number;
  overdue: number;
  blocked: number;
  /** "ahead" | "on track" | "behind" when there is a plan to compare with. */
  health: "ahead" | "on track" | "behind" | null;
};

export function summarizeProgress(tasks: readonly ProgressTask[], today: string): ProgressSummary {
  const live = tasks.filter((task) => task.status !== "Cancelled");
  let weight = 0;
  let actual = 0;
  let expected = 0;
  let completed = 0;
  let inProgress = 0;
  let overdue = 0;
  let blocked = 0;
  for (const task of live) {
    const w = days(task.plannedStart, task.plannedEnd);
    weight += w;
    actual += w * taskProgressTenths(task);
    expected += w * expectedTenths(task, today);
    if (task.status === "Completed") completed += 1;
    else {
      if (task.status === "In Progress") inProgress += 1;
      if (task.status === "Blocked" || task.status === "On Hold") blocked += 1;
      if (task.plannedEnd < today) overdue += 1;
    }
  }
  if (weight === 0)
    return {
      actualTenths: null,
      expectedTenths: null,
      total: 0,
      completed: 0,
      inProgress: 0,
      overdue: 0,
      blocked: 0,
      health: null,
    };
  const actualTenths = Math.round(actual / weight);
  const expectedT = Math.round(expected / weight);
  // Five points of slack either way before calling it ahead or behind.
  const health =
    expectedT === 0 && actualTenths === 0
      ? null
      : actualTenths + 50 < expectedT
        ? "behind"
        : actualTenths > expectedT + 50
          ? "ahead"
          : "on track";
  return {
    actualTenths,
    expectedTenths: expectedT,
    total: live.length,
    completed,
    inProgress,
    overdue,
    blocked,
    health,
  };
}
