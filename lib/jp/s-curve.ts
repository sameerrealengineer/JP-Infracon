import { expectedTenths, taskProgressTenths } from "./progress-domain";

/**
 * Planned vs actual S-curve and Gantt rows for a site, from its tasks and the progress the DPRs
 * reported over time. Weights are planned durations (as on the dashboard). Planned: where the
 * work should have been on each date; actual: what the reports said by then (completed tasks
 * count 100% from their last report, or from today when never reported). An estimate for
 * monitoring, never a payment basis.
 */

export type CurveTask = {
  id: string;
  code: string;
  title: string;
  status: string;
  plannedStart: string;
  plannedEnd: string;
};

export type ProgressReport = { taskId: string; date: string; percent: number };

const DAY = 86_400_000;
const toDay = (iso: string) => Math.floor(Date.parse(`${iso}T00:00:00Z`) / DAY);
const fromDay = (day: number) => new Date(day * DAY).toISOString().slice(0, 10);
const span = (task: CurveTask) =>
  Math.max(1, toDay(task.plannedEnd) - toDay(task.plannedStart) + 1);

/** The task's reported percent on a date (latest report on or before it). */
function percentOn(reports: readonly ProgressReport[], date: string): number | null {
  let best: ProgressReport | null = null;
  for (const report of reports)
    if (report.date <= date && (!best || report.date > best.date)) best = report;
  return best ? best.percent : null;
}

export function sCurve(
  tasks: readonly CurveTask[],
  reports: readonly ProgressReport[],
  today: string,
  points = 24,
) {
  const live = tasks.filter((task) => task.status !== "Cancelled");
  if (!live.length) return { points: [], start: null, end: null };
  const start = Math.min(...live.map((task) => toDay(task.plannedStart)));
  const end = Math.max(
    ...live.map((task) => toDay(task.plannedEnd)),
    Math.min(toDay(today), start),
  );
  const step = Math.max(1, Math.ceil((end - start) / (points - 1)));
  const byTask = new Map<string, ProgressReport[]>();
  for (const report of reports)
    byTask.set(report.taskId, [...(byTask.get(report.taskId) ?? []), report]);
  const weight = live.reduce((sum, task) => sum + span(task), 0);
  const todayDay = toDay(today);
  const out: { date: string; planned: number; actual: number | null }[] = [];
  for (let day = start; ; day += step) {
    const at = Math.min(day, end);
    const date = fromDay(at);
    let planned = 0;
    let actual = 0;
    for (const task of live) {
      planned += span(task) * expectedTenths(task, date);
      const own = byTask.get(task.id) ?? [];
      const reported = percentOn(own, date);
      const lastReport = own.reduce<string | null>(
        (max, r) => (max && max > r.date ? max : r.date),
        null,
      );
      const doneFrom = lastReport ?? today;
      const status = task.status === "Completed" && date >= doneFrom ? "Completed" : "Open";
      actual += span(task) * taskProgressTenths({ status, reportedPercent: reported });
    }
    out.push({
      date,
      planned: Math.round(planned / weight) / 10,
      actual: at <= todayDay ? Math.round(actual / weight) / 10 : null,
    });
    if (at >= end) break;
  }
  return { points: out, start: fromDay(start), end: fromDay(end) };
}

/** Gantt rows: offsets in days from the site's first planned start, and late flags. */
export function ganttRows(tasks: readonly CurveTask[], today: string) {
  const live = tasks.filter((task) => task.status !== "Cancelled");
  if (!live.length) return { start: null, days: 0, rows: [] };
  const start = Math.min(...live.map((task) => toDay(task.plannedStart)));
  const end = Math.max(...live.map((task) => toDay(task.plannedEnd)));
  return {
    start: fromDay(start),
    days: end - start + 1,
    todayOffset: toDay(today) - start,
    rows: [...live]
      .sort((a, b) => a.plannedStart.localeCompare(b.plannedStart) || a.code.localeCompare(b.code))
      .map((task) => ({
        id: task.id,
        code: task.code,
        title: task.title,
        status: task.status,
        offset: toDay(task.plannedStart) - start,
        length: span(task),
        late: task.status !== "Completed" && task.plannedEnd < today,
      })),
  };
}
