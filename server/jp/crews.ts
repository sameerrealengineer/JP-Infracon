import { randomUUID } from "node:crypto";
import { and, asc, between, desc, eq, inArray, isNull } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import {
  attendanceRecords,
  auditEvents,
  crewDeployments,
  crewMembers,
  crews,
  people,
  personSiteAssignments,
  workerEngagements,
  workTasks,
} from "../../drizzle/schema";
import { protectedProcedure, router } from "../_core/trpc";
import { getDb } from "../db";
import { getSiteScope } from "./access";
import {
  estimateEarning,
  parseHours,
  type AttendanceStatus,
  type RateType,
} from "../../lib/jp/attendance-domain";
import {
  checkCrew,
  checkDeployment,
  crewCosts,
  joinBlocker,
  memberOn,
  type Membership,
} from "../../lib/jp/crew-domain";
import { istDate, monthRange } from "../../lib/jp/tracking-domain";

/**
 * Crews (`jp.crews`): trade-wise teams on a site. View with `workforce.view`; create, change
 * members, close and record daily deployments with `workforce.manage`. Labour cost per crew
 * (approved attendance only) is shown only to people with `payroll.view` on the site.
 */

const uuid = z.string().uuid();
const mutationId = z.string().min(16).max(64);

function requireDb(db: Awaited<ReturnType<typeof getDb>>) {
  if (!db)
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message: "The business data service is temporarily unavailable.",
    });
  return db;
}
type Db = ReturnType<typeof requireDb>;

async function replayOf(db: Db, userId: number, clientMutationId: string) {
  const [event] = await db
    .select()
    .from(auditEvents)
    .where(
      and(eq(auditEvents.actorUserId, userId), eq(auditEvents.clientMutationId, clientMutationId)),
    )
    .limit(1);
  return event;
}

async function loadCrew(db: Db, crewId: string) {
  const [crew] = await db.select().from(crews).where(eq(crews.id, crewId)).limit(1);
  if (!crew) throw new TRPCError({ code: "NOT_FOUND", message: "Crew not found." });
  return crew;
}

async function canSeeMoney(user: Parameters<typeof getSiteScope>[0], siteId: string) {
  try {
    await getSiteScope(user, siteId, "payroll.view");
    return true;
  } catch {
    return false;
  }
}

export const crewsRouter = router({
  list: protectedProcedure
    .input(z.object({ siteId: uuid, month: z.string().regex(/^\d{4}-\d{2}$/) }))
    .query(async ({ ctx, input }) => {
      const scope = await getSiteScope(ctx.user, input.siteId, "workforce.view");
      const range = monthRange(input.month);
      if (!range) throw new TRPCError({ code: "BAD_REQUEST", message: "Choose a valid month." });
      const db = requireDb(await getDb());
      const crewRows = await db
        .select()
        .from(crews)
        .where(eq(crews.siteId, scope.siteId))
        .orderBy(asc(crews.status), asc(crews.name));
      const crewIds = crewRows.map((row) => row.id);
      const [members, deployments, sitePeople, tasks] = await Promise.all([
        crewIds.length
          ? db
              .select({
                crewId: crewMembers.crewId,
                personId: crewMembers.personId,
                joinedOn: crewMembers.joinedOn,
                leftOn: crewMembers.leftOn,
                name: people.fullName,
                trade: people.tradeType,
              })
              .from(crewMembers)
              .innerJoin(people, eq(crewMembers.personId, people.id))
              .where(inArray(crewMembers.crewId, crewIds))
          : [],
        db
          .select({
            id: crewDeployments.id,
            crewId: crewDeployments.crewId,
            workDate: crewDeployments.workDate,
            headcount: crewDeployments.headcount,
            note: crewDeployments.note,
            taskTitle: workTasks.title,
            taskCode: workTasks.taskCode,
          })
          .from(crewDeployments)
          .leftJoin(workTasks, eq(crewDeployments.taskId, workTasks.id))
          .where(
            and(
              eq(crewDeployments.siteId, scope.siteId),
              between(crewDeployments.workDate, range.from, range.to),
            ),
          )
          .orderBy(desc(crewDeployments.workDate)),
        db
          .select({ id: people.id, name: people.fullName, trade: people.tradeType })
          .from(personSiteAssignments)
          .innerJoin(people, eq(personSiteAssignments.personId, people.id))
          .where(
            and(
              eq(personSiteAssignments.siteId, scope.siteId),
              eq(personSiteAssignments.status, "Active"),
              eq(people.status, "Active"),
            ),
          )
          .orderBy(asc(people.fullName)),
        db
          .select({ id: workTasks.id, title: workTasks.title, code: workTasks.taskCode })
          .from(workTasks)
          .where(eq(workTasks.siteId, scope.siteId))
          .orderBy(asc(workTasks.plannedStart))
          .limit(300),
      ]);

      // Labour cost per crew from approved attendance of members on the days they were in it.
      const money = await canSeeMoney(ctx.user, scope.siteId);
      let costs: ReturnType<typeof crewCosts> | null = null;
      if (money && members.length) {
        const attendance = await db
          .select({
            personId: workerEngagements.personId,
            date: attendanceRecords.workDate,
            status: attendanceRecords.attendanceStatus,
            regular: attendanceRecords.regularHours,
            overtime: attendanceRecords.overtimeHours,
            overtimeStatus: attendanceRecords.overtimeApprovalStatus,
            rate: attendanceRecords.rateSnapshotMinor,
            rateType: workerEngagements.rateType,
            reviewedBy: attendanceRecords.reviewedBy,
          })
          .from(attendanceRecords)
          .innerJoin(
            workerEngagements,
            eq(attendanceRecords.workerEngagementId, workerEngagements.id),
          )
          .where(
            and(
              eq(attendanceRecords.siteId, scope.siteId),
              between(attendanceRecords.workDate, range.from, range.to),
              inArray(workerEngagements.personId, [...new Set(members.map((row) => row.personId))]),
            ),
          );
        const earnings = attendance.flatMap((row) => {
          if (row.reviewedBy === null) return [];
          const earning = estimateEarning({
            status: row.status as AttendanceStatus,
            rateType: row.rateType as RateType,
            rateMinor: row.rate,
            regularHundredths: parseHours(String(row.regular)) ?? 0n,
            overtimeHundredths: parseHours(String(row.overtime)) ?? 0n,
            overtimeApproved: row.overtimeStatus === "Approved",
          });
          return earning.kind === "amount"
            ? [{ personId: row.personId, date: String(row.date), minor: earning.minor }]
            : [];
        });
        costs = crewCosts(
          members.map((row) => ({
            ...row,
            joinedOn: String(row.joinedOn),
            leftOn: row.leftOn ? String(row.leftOn) : null,
          })),
          earnings,
        );
      }

      const today = istDate(new Date());
      const inCrew = new Set(
        members.filter((row) => row.leftOn === null).map((row) => row.personId),
      );
      return {
        siteName: scope.siteName,
        today,
        canManage: await getSiteScope(ctx.user, scope.siteId, "workforce.manage")
          .then(() => scope.siteStatus === "Active")
          .catch(() => false),
        canSeeMoney: money,
        crews: crewRows.map((crew) => {
          const mine = members.filter((row) => row.crewId === crew.id);
          const days = deployments.filter((row) => row.crewId === crew.id);
          return {
            id: crew.id,
            name: crew.name,
            trade: crew.trade,
            status: crew.status,
            members: mine
              .filter((row) => row.leftOn === null)
              .map((row) => ({
                personId: row.personId,
                name: row.name,
                trade: row.trade,
                joinedOn: String(row.joinedOn),
              }))
              .sort((a, b) => a.name.localeCompare(b.name)),
            formerCount: mine.filter((row) => row.leftOn !== null).length,
            deployments: days.map((row) => ({
              id: row.id,
              workDate: String(row.workDate),
              headcount: row.headcount,
              note: row.note,
              task: row.taskTitle ? `${row.taskCode} · ${row.taskTitle}` : null,
            })),
            deployedToday: days.some((row) => String(row.workDate) === today),
            daysDeployed: new Set(days.map((row) => String(row.workDate))).size,
            costMinor: costs ? (costs.byCrew.get(crew.id) ?? 0n).toString() : null,
          };
        }),
        unassignedCostMinor: costs ? costs.unassigned.toString() : null,
        freePeople: sitePeople.filter((person) => !inCrew.has(person.id)),
        tasks,
      };
    }),

  create: protectedProcedure
    .input(
      z.object({
        siteId: uuid,
        name: z.string().max(120),
        trade: z.string().max(80),
        clientMutationId: mutationId,
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const scope = await getSiteScope(ctx.user, input.siteId, "workforce.manage");
      const db = requireDb(await getDb());
      const replay = await replayOf(db, ctx.user.id, input.clientMutationId);
      if (replay) {
        if (replay.action !== "crew.created")
          throw new TRPCError({ code: "CONFLICT", message: "This retry key was already used." });
        return { id: replay.entityId };
      }
      const problem = checkCrew(input.name, input.trade);
      if (problem) throw new TRPCError({ code: "BAD_REQUEST", message: problem });
      const name = input.name.trim();
      const [same] = await db
        .select({ id: crews.id })
        .from(crews)
        .where(and(eq(crews.siteId, scope.siteId), eq(crews.name, name)))
        .limit(1);
      if (same)
        throw new TRPCError({
          code: "CONFLICT",
          message: "A crew with this name is already on this site.",
        });
      const id = randomUUID();
      await db.transaction(async (tx) => {
        await tx.insert(crews).values({
          id,
          organizationId: scope.organizationId,
          siteId: scope.siteId,
          name,
          trade: input.trade.trim(),
          createdBy: ctx.user.id,
          clientMutationId: input.clientMutationId,
        });
        await tx.insert(auditEvents).values({
          id: randomUUID(),
          organizationId: scope.organizationId,
          siteId: scope.siteId,
          actorUserId: ctx.user.id,
          action: "crew.created",
          entityType: "crew",
          entityId: id,
          clientMutationId: input.clientMutationId,
          afterSummary: JSON.stringify({ name, trade: input.trade.trim() }),
        });
      });
      return { id };
    }),

  addMember: protectedProcedure
    .input(z.object({ crewId: uuid, personId: uuid, clientMutationId: mutationId }))
    .mutation(async ({ ctx, input }) => {
      const db = requireDb(await getDb());
      const crew = await loadCrew(db, input.crewId);
      const scope = await getSiteScope(ctx.user, crew.siteId, "workforce.manage");
      const replay = await replayOf(db, ctx.user.id, input.clientMutationId);
      if (replay) {
        if (replay.action !== "crew.member_added" || replay.entityId !== crew.id)
          throw new TRPCError({ code: "CONFLICT", message: "This retry key was already used." });
        return { crewId: crew.id };
      }
      if (crew.status !== "Active")
        throw new TRPCError({ code: "BAD_REQUEST", message: "This crew is closed." });
      const [onSite] = await db
        .select({ id: personSiteAssignments.id })
        .from(personSiteAssignments)
        .where(
          and(
            eq(personSiteAssignments.personId, input.personId),
            eq(personSiteAssignments.siteId, crew.siteId),
            eq(personSiteAssignments.status, "Active"),
          ),
        )
        .limit(1);
      if (!onSite)
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "This person is not assigned to this site.",
        });
      const today = istDate(new Date());
      await db.transaction(async (tx) => {
        // Lock the site's open memberships so two people cannot add the same worker at once.
        const open = (await tx
          .select({
            crewId: crewMembers.crewId,
            personId: crewMembers.personId,
            joinedOn: crewMembers.joinedOn,
            leftOn: crewMembers.leftOn,
          })
          .from(crewMembers)
          .innerJoin(crews, eq(crewMembers.crewId, crews.id))
          .where(
            and(
              eq(crews.siteId, crew.siteId),
              eq(crewMembers.personId, input.personId),
              isNull(crewMembers.leftOn),
            ),
          )
          .for("update")) as Membership[];
        const blocker = joinBlocker(input.personId, crew.id, open);
        if (blocker) throw new TRPCError({ code: "CONFLICT", message: blocker });
        await tx.insert(crewMembers).values({
          id: randomUUID(),
          crewId: crew.id,
          personId: input.personId,
          joinedOn: today,
          addedBy: ctx.user.id,
        });
        await tx.insert(auditEvents).values({
          id: randomUUID(),
          organizationId: scope.organizationId,
          siteId: scope.siteId,
          actorUserId: ctx.user.id,
          action: "crew.member_added",
          entityType: "crew",
          entityId: crew.id,
          clientMutationId: input.clientMutationId,
          afterSummary: JSON.stringify({ personId: input.personId, joinedOn: today }),
        });
      });
      return { crewId: crew.id };
    }),

  removeMember: protectedProcedure
    .input(z.object({ crewId: uuid, personId: uuid, clientMutationId: mutationId }))
    .mutation(async ({ ctx, input }) => {
      const db = requireDb(await getDb());
      const crew = await loadCrew(db, input.crewId);
      const scope = await getSiteScope(ctx.user, crew.siteId, "workforce.manage");
      const replay = await replayOf(db, ctx.user.id, input.clientMutationId);
      if (replay) {
        if (replay.action !== "crew.member_removed" || replay.entityId !== crew.id)
          throw new TRPCError({ code: "CONFLICT", message: "This retry key was already used." });
        return { crewId: crew.id };
      }
      const today = istDate(new Date());
      await db.transaction(async (tx) => {
        const [open] = await tx
          .select({ id: crewMembers.id, joinedOn: crewMembers.joinedOn })
          .from(crewMembers)
          .where(
            and(
              eq(crewMembers.crewId, crew.id),
              eq(crewMembers.personId, input.personId),
              isNull(crewMembers.leftOn),
            ),
          )
          .for("update")
          .limit(1);
        if (!open)
          throw new TRPCError({ code: "NOT_FOUND", message: "This person is not in the crew." });
        await tx.update(crewMembers).set({ leftOn: today }).where(eq(crewMembers.id, open.id));
        await tx.insert(auditEvents).values({
          id: randomUUID(),
          organizationId: scope.organizationId,
          siteId: scope.siteId,
          actorUserId: ctx.user.id,
          action: "crew.member_removed",
          entityType: "crew",
          entityId: crew.id,
          clientMutationId: input.clientMutationId,
          beforeSummary: JSON.stringify({
            personId: input.personId,
            joinedOn: String(open.joinedOn),
          }),
          afterSummary: JSON.stringify({ personId: input.personId, leftOn: today }),
        });
      });
      return { crewId: crew.id };
    }),

  close: protectedProcedure
    .input(
      z.object({
        crewId: uuid,
        reason: z.string().trim().min(3).max(300),
        clientMutationId: mutationId,
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const db = requireDb(await getDb());
      const crew = await loadCrew(db, input.crewId);
      const scope = await getSiteScope(ctx.user, crew.siteId, "workforce.manage");
      const replay = await replayOf(db, ctx.user.id, input.clientMutationId);
      if (replay) {
        if (replay.action !== "crew.closed" || replay.entityId !== crew.id)
          throw new TRPCError({ code: "CONFLICT", message: "This retry key was already used." });
        return { crewId: crew.id };
      }
      if (crew.status === "Closed")
        throw new TRPCError({ code: "BAD_REQUEST", message: "This crew is already closed." });
      const today = istDate(new Date());
      await db.transaction(async (tx) => {
        await tx.select({ id: crews.id }).from(crews).where(eq(crews.id, crew.id)).for("update");
        await tx.update(crews).set({ status: "Closed" }).where(eq(crews.id, crew.id));
        // Everyone still in the crew leaves today; their history stays.
        await tx
          .update(crewMembers)
          .set({ leftOn: today })
          .where(and(eq(crewMembers.crewId, crew.id), isNull(crewMembers.leftOn)));
        await tx.insert(auditEvents).values({
          id: randomUUID(),
          organizationId: scope.organizationId,
          siteId: scope.siteId,
          actorUserId: ctx.user.id,
          action: "crew.closed",
          entityType: "crew",
          entityId: crew.id,
          clientMutationId: input.clientMutationId,
          beforeSummary: JSON.stringify({ status: crew.status }),
          afterSummary: JSON.stringify({ status: "Closed", reason: input.reason }),
          reason: input.reason,
        });
      });
      return { crewId: crew.id };
    }),

  deploy: protectedProcedure
    .input(
      z.object({
        crewId: uuid,
        workDate: z.string(),
        taskId: uuid.nullable(),
        headcount: z.number(),
        note: z.string().max(300).optional(),
        clientMutationId: mutationId,
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const db = requireDb(await getDb());
      const crew = await loadCrew(db, input.crewId);
      const scope = await getSiteScope(ctx.user, crew.siteId, "workforce.manage");
      const [existing] = await db
        .select({ id: crewDeployments.id })
        .from(crewDeployments)
        .where(eq(crewDeployments.clientMutationId, input.clientMutationId))
        .limit(1);
      if (existing) return { id: existing.id };
      if (crew.status !== "Active")
        throw new TRPCError({ code: "BAD_REQUEST", message: "This crew is closed." });
      const problem = checkDeployment({
        workDate: input.workDate,
        today: istDate(new Date()),
        headcount: input.headcount,
      });
      if (problem) throw new TRPCError({ code: "BAD_REQUEST", message: problem });
      if (input.taskId) {
        const [task] = await db
          .select({ siteId: workTasks.siteId })
          .from(workTasks)
          .where(eq(workTasks.id, input.taskId))
          .limit(1);
        if (!task || task.siteId !== crew.siteId)
          throw new TRPCError({ code: "BAD_REQUEST", message: "Choose a task of this site." });
      }
      const members = await db
        .select({
          crewId: crewMembers.crewId,
          personId: crewMembers.personId,
          joinedOn: crewMembers.joinedOn,
          leftOn: crewMembers.leftOn,
        })
        .from(crewMembers)
        .where(eq(crewMembers.crewId, crew.id));
      const onDay = members.filter((row) =>
        memberOn(
          {
            ...row,
            joinedOn: String(row.joinedOn),
            leftOn: row.leftOn ? String(row.leftOn) : null,
          },
          input.workDate,
        ),
      ).length;
      if (onDay === 0)
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Nobody was in this crew on that day. Add members first.",
        });
      const id = randomUUID();
      const note = input.note?.trim() || null;
      await db.transaction(async (tx) => {
        await tx.insert(crewDeployments).values({
          id,
          crewId: crew.id,
          siteId: crew.siteId,
          workDate: input.workDate,
          taskId: input.taskId,
          headcount: input.headcount,
          note,
          createdBy: ctx.user.id,
          clientMutationId: input.clientMutationId,
        });
        await tx.insert(auditEvents).values({
          id: randomUUID(),
          organizationId: scope.organizationId,
          siteId: scope.siteId,
          actorUserId: ctx.user.id,
          action: "crew.deployed",
          entityType: "crew",
          entityId: crew.id,
          afterSummary: JSON.stringify({
            workDate: input.workDate,
            taskId: input.taskId,
            headcount: input.headcount,
          }),
        });
      });
      return { id };
    }),
});
