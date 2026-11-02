import { randomUUID } from "node:crypto";
import { and, asc, desc, eq, inArray } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import {
  auditEvents,
  taskDependencies,
  taskScheduleChanges,
  taskScheduleRevisions,
  users,
  workTasks,
} from "../../drizzle/schema";
import {
  addCalendarDays,
  isTaskStatusTransitionAllowed,
  previewTaskReschedule,
  type RescheduleStrategy,
  type ScheduleDependency,
  type ScheduleTask,
  type TaskStatus,
} from "../../lib/jp/scheduling";
import { getSiteScope } from "./access";
import { protectedProcedure, router } from "../_core/trpc";

const dateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine((value) => {
    const date = new Date(`${value}T00:00:00.000Z`);
    return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
  }, "Enter a valid calendar date.");
const mutationIdSchema = z.string().trim().min(16).max(64);
const taskStatusSchema = z.enum([
  "Planned",
  "Ready",
  "In Progress",
  "On Hold",
  "Completed",
  "Cancelled",
  "Blocked",
  "Awaiting Inspection",
]);
const rescheduleStrategySchema = z.enum(["selected_only", "shift_dependents"]);
const rescheduleReasonSchema = z.enum([
  "weather_rain",
  "material_shortage",
  "labour_shortage",
  "equipment_breakdown",
  "drawing_approval_pending",
  "inspection_pending",
  "access_issue",
  "safety_issue",
  "client_instruction",
  "other",
]);
const dependenciesSchema = z
  .array(z.object({ taskId: z.string().uuid(), lagDays: z.number().int().min(0).max(365) }))
  .max(25)
  .refine(
    (edges) => new Set(edges.map((edge) => edge.taskId)).size === edges.length,
    "A predecessor task can be added only once.",
  );

function requireDb(db: Awaited<ReturnType<typeof import("../db").getDb>>) {
  if (!db)
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message: "The business data service is temporarily unavailable.",
    });
  return db;
}

function scheduleTasks(rows: Array<typeof workTasks.$inferSelect>): ScheduleTask[] {
  return rows.map((row) => ({
    id: row.id,
    title: row.title,
    plannedStart: row.plannedStart,
    plannedEnd: row.plannedEnd,
    status: row.status as TaskStatus,
  }));
}

function scheduleDependencies(
  rows: Array<typeof taskDependencies.$inferSelect>,
): ScheduleDependency[] {
  return rows.map((row) => ({
    predecessorTaskId: row.predecessorTaskId,
    successorTaskId: row.successorTaskId,
    lagDays: row.lagDays,
  }));
}

async function recordTaskAudit(
  tx: any,
  input: {
    organizationId: string;
    siteId: string;
    actorUserId: number;
    action: string;
    entityId: string;
    requestId?: string;
    clientMutationId?: string;
    beforeSummary?: string;
    afterSummary?: string;
    reason?: string;
  },
) {
  await tx.insert(auditEvents).values({
    id: randomUUID(),
    ...input,
    entityType: "work_task",
    requestId: input.requestId?.slice(0, 100),
  });
}

function conflictingScheduleMessage(conflicts: Array<{ message: string }>): string {
  return conflicts
    .map((conflict) => conflict.message)
    .join(" ")
    .slice(0, 1800);
}

async function verifyTaskCreateReplay(
  queryable: any,
  existing: typeof workTasks.$inferSelect,
  input: {
    title: string;
    description?: string;
    workCategory?: string;
    locationLabel?: string;
    plannedStart: string;
    plannedEnd: string;
    priority: "Low" | "Normal" | "High" | "Critical";
    dependencies: Array<{ taskId: string; lagDays: number }>;
  },
  userId: number,
  siteId: string,
) {
  const samePayload =
    existing.createdBy === userId &&
    existing.siteId === siteId &&
    existing.title === input.title &&
    existing.description === (input.description || null) &&
    existing.workCategory === (input.workCategory || null) &&
    existing.locationLabel === (input.locationLabel || null) &&
    existing.plannedStart === input.plannedStart &&
    existing.plannedEnd === input.plannedEnd &&
    existing.priority === input.priority;
  if (!samePayload)
    throw new TRPCError({
      code: "CONFLICT",
      message: "This task mutation key is already associated with a different record or payload.",
    });
  const priorEdges = await queryable
    .select()
    .from(taskDependencies)
    .where(eq(taskDependencies.successorTaskId, existing.id));
  const priorSignature = priorEdges
    .map(
      (edge: typeof taskDependencies.$inferSelect) => `${edge.predecessorTaskId}:${edge.lagDays}`,
    )
    .sort()
    .join("|");
  const requestSignature = input.dependencies
    .map((edge) => `${edge.taskId}:${edge.lagDays}`)
    .sort()
    .join("|");
  if (priorSignature !== requestSignature)
    throw new TRPCError({
      code: "CONFLICT",
      message: "This task mutation key is already associated with a different predecessor set.",
    });
  return existing;
}

async function verifyTaskStatusReplay(
  queryable: any,
  input: {
    taskId: string;
    status: TaskStatus;
    reason?: string;
    clientMutationId: string;
  },
  actorUserId: number,
) {
  const [event] = await queryable
    .select()
    .from(auditEvents)
    .where(
      and(
        eq(auditEvents.actorUserId, actorUserId),
        eq(auditEvents.clientMutationId, input.clientMutationId),
      ),
    )
    .limit(1);
  if (!event) return null;
  const expectedAction = `task.status.${input.status.toLowerCase().replaceAll(" ", "_")}`;
  if (
    event.entityType !== "work_task" ||
    event.entityId !== input.taskId ||
    event.action !== expectedAction ||
    event.reason !== (input.reason || null) ||
    event.afterSummary !== JSON.stringify({ status: input.status })
  ) {
    throw new TRPCError({
      code: "CONFLICT",
      message: "This status mutation key is already associated with a different task change.",
    });
  }
  return { id: input.taskId, status: input.status };
}

export const taskRouter = router({
  list: protectedProcedure
    .input(z.object({ siteId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const scope = await getSiteScope(ctx.user, input.siteId, "task.view");
      const db = requireDb(await (await import("../db")).getDb());
      const rows = await db
        .select()
        .from(workTasks)
        .where(eq(workTasks.siteId, scope.siteId))
        .orderBy(asc(workTasks.plannedStart), asc(workTasks.taskCode));
      const edges =
        rows.length === 0
          ? []
          : await db
              .select()
              .from(taskDependencies)
              .where(eq(taskDependencies.siteId, scope.siteId));
      const predecessorIds = [...new Set(edges.map((edge) => edge.predecessorTaskId))];
      const predecessors =
        predecessorIds.length === 0
          ? []
          : await db
              .select({ id: workTasks.id, taskCode: workTasks.taskCode, title: workTasks.title })
              .from(workTasks)
              .where(inArray(workTasks.id, predecessorIds));
      return rows.map((task) => ({
        ...task,
        dependencies: edges
          .filter((edge) => edge.successorTaskId === task.id)
          .map((edge) => ({
            ...edge,
            predecessor: predecessors.find((row) => row.id === edge.predecessorTaskId) ?? null,
          })),
      }));
    }),

  create: protectedProcedure
    .input(
      z
        .object({
          siteId: z.string().uuid(),
          title: z.string().trim().min(2).max(180),
          description: z.string().trim().max(2000).optional(),
          workCategory: z.string().trim().max(80).optional(),
          locationLabel: z.string().trim().max(180).optional(),
          plannedStart: dateSchema,
          plannedEnd: dateSchema,
          priority: z.enum(["Low", "Normal", "High", "Critical"]).default("Normal"),
          dependencies: dependenciesSchema.default([]),
          clientMutationId: mutationIdSchema,
        })
        .refine((input) => input.plannedStart <= input.plannedEnd, {
          message: "The planned end date cannot be before the start date.",
          path: ["plannedEnd"],
        }),
    )
    .mutation(async ({ ctx, input }) => {
      const scope = await getSiteScope(ctx.user, input.siteId, "task.manage");
      const db = requireDb(await (await import("../db")).getDb());
      const [existing] = await db
        .select()
        .from(workTasks)
        .where(eq(workTasks.clientMutationId, input.clientMutationId))
        .limit(1);
      if (existing) return verifyTaskCreateReplay(db, existing, input, ctx.user.id, scope.siteId);

      const taskId = randomUUID();
      const taskCode = `TSK-${taskId.slice(0, 8).toUpperCase()}`;
      const changeId = randomUUID();
      const now = new Date();
      try {
        await db.transaction(async (tx) => {
          const [priorTask] = await tx
            .select()
            .from(workTasks)
            .where(eq(workTasks.clientMutationId, input.clientMutationId))
            .limit(1);
          if (priorTask)
            await verifyTaskCreateReplay(tx, priorTask, input, ctx.user.id, scope.siteId);
          if (priorTask)
            throw new TRPCError({
              code: "CONFLICT",
              message: "This task was created by a concurrent retry.",
            });
          const dependencyIds = input.dependencies.map((edge) => edge.taskId);
          const predecessors =
            dependencyIds.length === 0
              ? []
              : await tx
                  .select()
                  .from(workTasks)
                  .where(
                    and(eq(workTasks.siteId, scope.siteId), inArray(workTasks.id, dependencyIds)),
                  )
                  .for("update");
          if (predecessors.length !== dependencyIds.length)
            throw new TRPCError({
              code: "NOT_FOUND",
              message: "A selected predecessor task is not available in this site.",
            });
          for (const dependency of input.dependencies) {
            const predecessor = predecessors.find((row) => row.id === dependency.taskId)!;
            if (predecessor.status === "Cancelled")
              throw new TRPCError({
                code: "PRECONDITION_FAILED",
                message: "A cancelled task cannot be a predecessor.",
              });
            if (
              input.plannedStart < addCalendarDays(predecessor.plannedEnd, dependency.lagDays + 1)
            ) {
              throw new TRPCError({
                code: "PRECONDITION_FAILED",
                message: `This task must start on or after ${addCalendarDays(predecessor.plannedEnd, dependency.lagDays + 1)} because it depends on ${predecessor.taskCode}.`,
              });
            }
          }
          await tx.insert(workTasks).values({
            id: taskId,
            organizationId: scope.organizationId,
            siteId: scope.siteId,
            taskCode,
            title: input.title,
            description: input.description || null,
            workCategory: input.workCategory || null,
            locationLabel: input.locationLabel || null,
            plannedStart: input.plannedStart,
            plannedEnd: input.plannedEnd,
            priority: input.priority,
            status: "Planned",
            scheduleRevision: 1,
            recordVersion: 1,
            clientMutationId: input.clientMutationId,
            createdBy: ctx.user.id,
            createdAt: now,
            updatedAt: now,
          });
          if (input.dependencies.length > 0) {
            await tx.insert(taskDependencies).values(
              input.dependencies.map((edge) => ({
                id: randomUUID(),
                siteId: scope.siteId,
                predecessorTaskId: edge.taskId,
                successorTaskId: taskId,
                dependencyType: "Finish-to-Start" as const,
                lagDays: edge.lagDays,
                createdBy: ctx.user.id,
                createdAt: now,
              })),
            );
          }
          await tx.insert(taskScheduleChanges).values({
            id: changeId,
            organizationId: scope.organizationId,
            siteId: scope.siteId,
            selectedTaskId: taskId,
            changeType: "Initial Plan",
            strategy: "selected_only",
            reasonCode: "initial_plan",
            reasonText: null,
            impactSummary: JSON.stringify({
              taskCode,
              plannedStart: input.plannedStart,
              plannedEnd: input.plannedEnd,
            }),
            status: "Applied",
            requestedBy: ctx.user.id,
            clientMutationId: input.clientMutationId,
            createdAt: now,
          });
          await tx.insert(taskScheduleRevisions).values({
            id: randomUUID(),
            changeId,
            siteId: scope.siteId,
            taskId,
            revisionNumber: 1,
            oldStart: null,
            oldEnd: null,
            newStart: input.plannedStart,
            newEnd: input.plannedEnd,
            createdAt: now,
          });
          await recordTaskAudit(tx, {
            organizationId: scope.organizationId,
            siteId: scope.siteId,
            actorUserId: ctx.user.id,
            action: "task.created",
            entityId: taskId,
            requestId:
              typeof ctx.req.headers["x-request-id"] === "string"
                ? ctx.req.headers["x-request-id"]
                : undefined,
            afterSummary: JSON.stringify({
              taskCode,
              plannedStart: input.plannedStart,
              plannedEnd: input.plannedEnd,
              status: "Planned",
            }),
          });
        });
      } catch (error) {
        const [racedTask] = await db
          .select()
          .from(workTasks)
          .where(eq(workTasks.clientMutationId, input.clientMutationId))
          .limit(1);
        if (racedTask)
          return verifyTaskCreateReplay(db, racedTask, input, ctx.user.id, scope.siteId);
        throw error;
      }
      const [created] = await db.select().from(workTasks).where(eq(workTasks.id, taskId)).limit(1);
      return created;
    }),

  previewReschedule: protectedProcedure
    .input(
      z.object({
        taskId: z.string().uuid(),
        newStartDate: dateSchema,
        strategy: rescheduleStrategySchema,
      }),
    )
    .query(async ({ ctx, input }) => {
      const db = requireDb(await (await import("../db")).getDb());
      const [task] = await db
        .select()
        .from(workTasks)
        .where(eq(workTasks.id, input.taskId))
        .limit(1);
      if (!task) throw new TRPCError({ code: "NOT_FOUND", message: "Task not found." });
      const scope = await getSiteScope(ctx.user, task.siteId, "task.view");
      const tasks = await db
        .select()
        .from(workTasks)
        .where(eq(workTasks.siteId, scope.siteId))
        .orderBy(asc(workTasks.plannedStart));
      const dependencies = await db
        .select()
        .from(taskDependencies)
        .where(eq(taskDependencies.siteId, scope.siteId));
      const preview = previewTaskReschedule({
        tasks: scheduleTasks(tasks),
        dependencies: scheduleDependencies(dependencies),
        selectedTaskId: task.id,
        newStartDate: input.newStartDate,
        strategy: input.strategy,
      });
      if (tasks.length > 5000)
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message:
            "This site schedule is too large for a complete impact preview. Narrow the schedule or split the site before rescheduling.",
        });
      return {
        ...preview,
        scheduleSnapshot: tasks.map((row) => ({
          taskId: row.id,
          recordVersion: row.recordVersion,
        })),
      };
    }),

  reschedule: protectedProcedure
    .input(
      z
        .object({
          taskId: z.string().uuid(),
          newStartDate: dateSchema,
          strategy: rescheduleStrategySchema,
          reasonCode: rescheduleReasonSchema,
          reasonText: z.string().trim().max(2000).optional(),
          expectedScheduleSnapshot: z
            .array(
              z.object({ taskId: z.string().uuid(), recordVersion: z.number().int().positive() }),
            )
            .min(1)
            .max(5000)
            .refine(
              (rows) => new Set(rows.map((row) => row.taskId)).size === rows.length,
              "Schedule snapshot contains duplicate tasks.",
            ),
          clientMutationId: mutationIdSchema,
        })
        .refine((input) => input.reasonCode !== "other" || Boolean(input.reasonText), {
          message: "Add a short note when the reason is Other.",
          path: ["reasonText"],
        }),
    )
    .mutation(async ({ ctx, input }) => {
      const db = requireDb(await (await import("../db")).getDb());
      const [task] = await db
        .select()
        .from(workTasks)
        .where(eq(workTasks.id, input.taskId))
        .limit(1);
      if (!task) throw new TRPCError({ code: "NOT_FOUND", message: "Task not found." });
      const scope = await getSiteScope(ctx.user, task.siteId, "task.manage");

      const verifyIdempotentResult = async (queryable: any) => {
        const [change] = await queryable
          .select()
          .from(taskScheduleChanges)
          .where(eq(taskScheduleChanges.clientMutationId, input.clientMutationId))
          .limit(1);
        if (!change) return null;
        if (
          change.requestedBy !== ctx.user.id ||
          change.siteId !== scope.siteId ||
          change.selectedTaskId !== task.id ||
          change.strategy !== input.strategy ||
          change.reasonCode !== input.reasonCode ||
          change.reasonText !== (input.reasonText || null)
        ) {
          throw new TRPCError({
            code: "CONFLICT",
            message: "This schedule mutation key is already associated with a different change.",
          });
        }
        const [selectedRevision] = await queryable
          .select()
          .from(taskScheduleRevisions)
          .where(
            and(
              eq(taskScheduleRevisions.changeId, change.id),
              eq(taskScheduleRevisions.taskId, task.id),
            ),
          )
          .limit(1);
        if (!selectedRevision || selectedRevision.newStart !== input.newStartDate)
          throw new TRPCError({
            code: "CONFLICT",
            message: "This schedule mutation key is already associated with a different date.",
          });
        const revisions = await queryable
          .select()
          .from(taskScheduleRevisions)
          .where(eq(taskScheduleRevisions.changeId, change.id))
          .orderBy(asc(taskScheduleRevisions.revisionNumber));
        return { changeId: change.id, status: "Applied" as const, revisions };
      };
      const priorResult = await verifyIdempotentResult(db);
      if (priorResult) return priorResult;

      return db.transaction(async (tx) => {
        const priorInsideTransaction = await verifyIdempotentResult(tx);
        if (priorInsideTransaction) return priorInsideTransaction;
        const lockedTasks = await tx
          .select()
          .from(workTasks)
          .where(eq(workTasks.siteId, scope.siteId))
          .for("update");
        const selected = lockedTasks.find((row) => row.id === task.id);
        if (!selected)
          throw new TRPCError({ code: "NOT_FOUND", message: "Task not found in this site." });
        const expectedVersions = new Map(
          input.expectedScheduleSnapshot.map((row) => [row.taskId, row.recordVersion]),
        );
        if (
          lockedTasks.length !== expectedVersions.size ||
          lockedTasks.some((row) => expectedVersions.get(row.id) !== row.recordVersion)
        ) {
          throw new TRPCError({
            code: "CONFLICT",
            message:
              "A task in this site changed after the preview. Refresh the schedule and review a new impact preview.",
          });
        }
        const dependencies = await tx
          .select()
          .from(taskDependencies)
          .where(eq(taskDependencies.siteId, scope.siteId));
        const preview = previewTaskReschedule({
          tasks: scheduleTasks(lockedTasks),
          dependencies: scheduleDependencies(dependencies),
          selectedTaskId: selected.id,
          newStartDate: input.newStartDate,
          strategy: input.strategy as RescheduleStrategy,
        });
        if (!preview.canApply) {
          const detail = preview.blockingConflicts.length
            ? conflictingScheduleMessage(preview.blockingConflicts)
            : "The schedule has no date change to apply.";
          throw new TRPCError({
            code: "PRECONDITION_FAILED",
            message: `The reschedule cannot be applied. ${detail}`,
          });
        }
        const changeId = randomUUID();
        const changeNow = new Date();
        await tx.insert(taskScheduleChanges).values({
          id: changeId,
          organizationId: scope.organizationId,
          siteId: scope.siteId,
          selectedTaskId: selected.id,
          changeType: "Reschedule",
          strategy: input.strategy,
          reasonCode: input.reasonCode,
          reasonText: input.reasonText || null,
          impactSummary: JSON.stringify({
            deltaDays: preview.deltaDays,
            impactedTasks: preview.impactedTasks
              .filter((item) => item.willMove)
              .map(({ id, currentStart, currentEnd, proposedStart, proposedEnd }) => ({
                id,
                currentStart,
                currentEnd,
                proposedStart,
                proposedEnd,
              })),
          }),
          status: "Applied",
          requestedBy: ctx.user.id,
          clientMutationId: input.clientMutationId,
          createdAt: changeNow,
        });
        const movedRevisions = [];
        for (const impact of preview.impactedTasks.filter((item) => item.willMove)) {
          const before = lockedTasks.find((row) => row.id === impact.id)!;
          const revisionNumber = before.scheduleRevision + 1;
          await tx
            .update(workTasks)
            .set({
              plannedStart: impact.proposedStart,
              plannedEnd: impact.proposedEnd,
              scheduleRevision: revisionNumber,
              recordVersion: before.recordVersion + 1,
              updatedAt: changeNow,
            })
            .where(eq(workTasks.id, impact.id));
          const revision = {
            id: randomUUID(),
            changeId,
            siteId: scope.siteId,
            taskId: impact.id,
            revisionNumber,
            oldStart: before.plannedStart,
            oldEnd: before.plannedEnd,
            newStart: impact.proposedStart,
            newEnd: impact.proposedEnd,
            createdAt: changeNow,
          };
          await tx.insert(taskScheduleRevisions).values(revision);
          movedRevisions.push(revision);
          await recordTaskAudit(tx, {
            organizationId: scope.organizationId,
            siteId: scope.siteId,
            actorUserId: ctx.user.id,
            action: "task.rescheduled",
            entityId: impact.id,
            requestId:
              typeof ctx.req.headers["x-request-id"] === "string"
                ? ctx.req.headers["x-request-id"]
                : undefined,
            beforeSummary: JSON.stringify({
              plannedStart: before.plannedStart,
              plannedEnd: before.plannedEnd,
              scheduleRevision: before.scheduleRevision,
            }),
            afterSummary: JSON.stringify({
              plannedStart: impact.proposedStart,
              plannedEnd: impact.proposedEnd,
              scheduleRevision: revisionNumber,
              changeId,
              strategy: input.strategy,
            }),
            reason: `${input.reasonCode}${input.reasonText ? `: ${input.reasonText}` : ""}`,
          });
        }
        return { changeId, status: "Applied" as const, revisions: movedRevisions };
      });
    }),

  updateStatus: protectedProcedure
    .input(
      z
        .object({
          taskId: z.string().uuid(),
          status: taskStatusSchema,
          reason: z.string().trim().max(2000).optional(),
          clientMutationId: mutationIdSchema,
        })
        .refine(
          (input) =>
            !["On Hold", "Blocked", "Cancelled"].includes(input.status) || Boolean(input.reason),
          {
            message:
              "A reason is required when placing a task on hold, blocking, or cancelling it.",
            path: ["reason"],
          },
        ),
    )
    .mutation(async ({ ctx, input }) => {
      const db = requireDb(await (await import("../db")).getDb());
      const [task] = await db
        .select()
        .from(workTasks)
        .where(eq(workTasks.id, input.taskId))
        .limit(1);
      if (!task) throw new TRPCError({ code: "NOT_FOUND", message: "Task not found." });
      const scope = await getSiteScope(ctx.user, task.siteId, "task.status.update");
      const priorResult = await verifyTaskStatusReplay(db, input, ctx.user.id);
      if (priorResult) return priorResult;
      const now = new Date();
      try {
        return await db.transaction(async (tx) => {
          const replay = await verifyTaskStatusReplay(tx, input, ctx.user.id);
          if (replay) return replay;
          const [lockedTask] = await tx
            .select()
            .from(workTasks)
            .where(eq(workTasks.id, task.id))
            .for("update")
            .limit(1);
          if (!lockedTask) throw new TRPCError({ code: "NOT_FOUND", message: "Task not found." });
          if (!isTaskStatusTransitionAllowed(lockedTask.status as TaskStatus, input.status))
            throw new TRPCError({
              code: "PRECONDITION_FAILED",
              message: `A task cannot move from ${lockedTask.status} to ${input.status}.`,
            });
          await tx
            .update(workTasks)
            .set({
              status: input.status,
              holdReason: ["On Hold", "Blocked"].includes(input.status)
                ? input.reason || null
                : null,
              recordVersion: lockedTask.recordVersion + 1,
              updatedAt: now,
            })
            .where(eq(workTasks.id, lockedTask.id));
          await recordTaskAudit(tx, {
            organizationId: scope.organizationId,
            siteId: scope.siteId,
            actorUserId: ctx.user.id,
            action: `task.status.${input.status.toLowerCase().replaceAll(" ", "_")}`,
            entityId: task.id,
            requestId:
              typeof ctx.req.headers["x-request-id"] === "string"
                ? ctx.req.headers["x-request-id"]
                : undefined,
            clientMutationId: input.clientMutationId,
            beforeSummary: JSON.stringify({ status: lockedTask.status }),
            afterSummary: JSON.stringify({ status: input.status }),
            reason: input.reason,
          });
          return { id: task.id, status: input.status };
        });
      } catch (error) {
        const replay = await verifyTaskStatusReplay(db, input, ctx.user.id);
        if (replay) return replay;
        throw error;
      }
    }),

  history: protectedProcedure
    .input(z.object({ taskId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const db = requireDb(await (await import("../db")).getDb());
      const [task] = await db
        .select()
        .from(workTasks)
        .where(eq(workTasks.id, input.taskId))
        .limit(1);
      if (!task) throw new TRPCError({ code: "NOT_FOUND", message: "Task not found." });
      await getSiteScope(ctx.user, task.siteId, "task.view");
      return db
        .select({
          id: taskScheduleRevisions.id,
          taskId: taskScheduleRevisions.taskId,
          changeId: taskScheduleChanges.id,
          taskCode: workTasks.taskCode,
          revisionNumber: taskScheduleRevisions.revisionNumber,
          oldStart: taskScheduleRevisions.oldStart,
          oldEnd: taskScheduleRevisions.oldEnd,
          newStart: taskScheduleRevisions.newStart,
          newEnd: taskScheduleRevisions.newEnd,
          changeType: taskScheduleChanges.changeType,
          strategy: taskScheduleChanges.strategy,
          reasonCode: taskScheduleChanges.reasonCode,
          reasonText: taskScheduleChanges.reasonText,
          requestedBy: taskScheduleChanges.requestedBy,
          requesterName: users.name,
          createdAt: taskScheduleRevisions.createdAt,
        })
        .from(taskScheduleRevisions)
        .innerJoin(taskScheduleChanges, eq(taskScheduleRevisions.changeId, taskScheduleChanges.id))
        .innerJoin(workTasks, eq(taskScheduleRevisions.taskId, workTasks.id))
        .innerJoin(users, eq(taskScheduleChanges.requestedBy, users.id))
        .where(eq(taskScheduleRevisions.taskId, task.id))
        .orderBy(desc(taskScheduleRevisions.revisionNumber));
    }),
});
