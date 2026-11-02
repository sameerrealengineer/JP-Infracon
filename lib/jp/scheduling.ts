export type TaskStatus =
  | "Planned"
  | "Ready"
  | "In Progress"
  | "On Hold"
  | "Completed"
  | "Cancelled"
  | "Blocked"
  | "Awaiting Inspection";

export type RescheduleStrategy = "selected_only" | "shift_dependents";

export type ScheduleTask = {
  id: string;
  title: string;
  plannedStart: string;
  plannedEnd: string;
  status: TaskStatus;
};

export type ScheduleDependency = {
  predecessorTaskId: string;
  successorTaskId: string;
  lagDays: number;
};

export type ScheduleConflict = {
  kind: "dependency_overlap" | "terminal_task";
  predecessorTaskId?: string;
  successorTaskId?: string;
  taskId?: string;
  message: string;
};

export type ScheduleImpact = {
  id: string;
  title: string;
  status: TaskStatus;
  currentStart: string;
  currentEnd: string;
  proposedStart: string;
  proposedEnd: string;
  willMove: boolean;
};

export type ReschedulePreview = {
  selectedTaskId: string;
  strategy: RescheduleStrategy;
  deltaDays: number;
  impactedTasks: ScheduleImpact[];
  blockingConflicts: ScheduleConflict[];
  canApply: boolean;
};

function dayNumber(value: string): number {
  const parsed = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value) {
    throw new RangeError("Enter a valid calendar date.");
  }
  return Math.floor(parsed.getTime() / 86_400_000);
}

export function addCalendarDays(value: string, days: number): string {
  return new Date((dayNumber(value) + days) * 86_400_000).toISOString().slice(0, 10);
}

export function isTaskStatusTransitionAllowed(from: TaskStatus, to: TaskStatus): boolean {
  const transitions: Record<TaskStatus, readonly TaskStatus[]> = {
    Planned: ["Ready", "In Progress", "On Hold", "Blocked", "Cancelled"],
    Ready: ["In Progress", "On Hold", "Blocked", "Cancelled"],
    "In Progress": ["On Hold", "Completed", "Blocked", "Awaiting Inspection", "Cancelled"],
    "On Hold": ["Ready", "In Progress", "Blocked", "Cancelled"],
    Completed: [],
    Cancelled: [],
    Blocked: ["Ready", "In Progress", "On Hold", "Cancelled"],
    "Awaiting Inspection": ["Completed", "In Progress", "On Hold"],
  };
  return transitions[from].includes(to);
}

export function previewTaskReschedule(args: {
  tasks: readonly ScheduleTask[];
  dependencies: readonly ScheduleDependency[];
  selectedTaskId: string;
  newStartDate: string;
  strategy: RescheduleStrategy;
}): ReschedulePreview {
  const taskById = new Map(args.tasks.map((task) => [task.id, task]));
  const selected = taskById.get(args.selectedTaskId);
  if (!selected) throw new RangeError("The selected task is not in this site schedule.");
  if (selected.status === "Completed" || selected.status === "Cancelled") {
    throw new RangeError("A completed or cancelled task cannot be rescheduled.");
  }

  const oldStartDay = dayNumber(selected.plannedStart);
  const oldEndDay = dayNumber(selected.plannedEnd);
  if (oldEndDay < oldStartDay)
    throw new RangeError("The existing task end date precedes its start date.");
  const newStartDay = dayNumber(args.newStartDate);
  const deltaDays = newStartDay - oldStartDay;
  if (deltaDays === 0)
    throw new RangeError("Choose a different start date before previewing a reschedule.");
  const proposed = new Map(
    args.tasks.map((task) => [task.id, { start: task.plannedStart, end: task.plannedEnd }]),
  );
  proposed.set(selected.id, {
    start: args.newStartDate,
    end: addCalendarDays(selected.plannedEnd, deltaDays),
  });

  const descendantsByPredecessor = new Map<string, ScheduleDependency[]>();
  for (const dependency of args.dependencies) {
    const list = descendantsByPredecessor.get(dependency.predecessorTaskId) ?? [];
    list.push(dependency);
    descendantsByPredecessor.set(dependency.predecessorTaskId, list);
  }
  const descendantIds: string[] = [];
  const visiting = new Set<string>([selected.id]);
  const visited = new Set<string>();
  const visitDescendants = (taskId: string) => {
    for (const edge of descendantsByPredecessor.get(taskId) ?? []) {
      if (!taskById.has(edge.successorTaskId))
        throw new RangeError("A dependency refers to a task outside this site schedule.");
      if (visiting.has(edge.successorTaskId))
        throw new RangeError("The task dependency graph contains a cycle.");
      if (visited.has(edge.successorTaskId)) continue;
      visited.add(edge.successorTaskId);
      visiting.add(edge.successorTaskId);
      descendantIds.push(edge.successorTaskId);
      visitDescendants(edge.successorTaskId);
      visiting.delete(edge.successorTaskId);
    }
  };
  visitDescendants(selected.id);

  const blockingConflicts: ScheduleConflict[] = [];
  if (args.strategy === "shift_dependents") {
    for (const taskId of descendantIds) {
      const task = taskById.get(taskId)!;
      if (["In Progress", "Awaiting Inspection", "Completed", "Cancelled"].includes(task.status)) {
        blockingConflicts.push({
          kind: "terminal_task",
          taskId,
          message: `“${task.title}” is ${task.status.toLowerCase()} and cannot be shifted automatically with its predecessor.`,
        });
        continue;
      }
      const current = proposed.get(taskId)!;
      proposed.set(taskId, {
        start: addCalendarDays(current.start, deltaDays),
        end: addCalendarDays(current.end, deltaDays),
      });
    }
  }

  const affectedIds = new Set([selected.id, ...descendantIds]);
  for (const edge of args.dependencies) {
    if (!affectedIds.has(edge.predecessorTaskId) && !affectedIds.has(edge.successorTaskId))
      continue;
    const predecessor = taskById.get(edge.predecessorTaskId);
    const successor = taskById.get(edge.successorTaskId);
    if (!predecessor || !successor || successor.status === "Cancelled") continue;
    const predecessorDates = proposed.get(predecessor.id)!;
    const successorDates = proposed.get(successor.id)!;
    const requiredStart = dayNumber(predecessorDates.end) + Math.max(0, edge.lagDays) + 1;
    if (dayNumber(successorDates.start) < requiredStart) {
      blockingConflicts.push({
        kind: "dependency_overlap",
        predecessorTaskId: predecessor.id,
        successorTaskId: successor.id,
        message: `“${successor.title}” must start on or after ${addCalendarDays(predecessorDates.end, Math.max(0, edge.lagDays) + 1)} because it depends on “${predecessor.title}”.`,
      });
    }
  }

  const impactedTasks = [selected.id, ...descendantIds].map((id) => {
    const task = taskById.get(id)!;
    const dates = proposed.get(id)!;
    return {
      id,
      title: task.title,
      status: task.status,
      currentStart: task.plannedStart,
      currentEnd: task.plannedEnd,
      proposedStart: dates.start,
      proposedEnd: dates.end,
      willMove: dates.start !== task.plannedStart || dates.end !== task.plannedEnd,
    };
  });

  return {
    selectedTaskId: selected.id,
    strategy: args.strategy,
    deltaDays,
    impactedTasks,
    blockingConflicts,
    canApply: blockingConflicts.length === 0 && impactedTasks.some((task) => task.willMove),
  };
}
