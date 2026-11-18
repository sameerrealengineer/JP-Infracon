import { randomUUID } from "node:crypto";
import { and, count, desc, eq, gte, inArray, isNull, lte, or } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { auditEvents, equipment, equipmentLogs } from "../../drizzle/schema";
import { parseRupeesToMinor } from "../../lib/jp/finance-domain";
import {
  EQUIPMENT_TYPES,
  HIRE_BASIS,
  equipmentCode,
  fuelCheck,
  hireCharge,
  logHours,
  parseThousandths,
  serviceLeft,
} from "../../lib/jp/plant-domain";
import { protectedProcedure, router } from "../_core/trpc";
import { getDb } from "../db";
import { getAccessibleSites, getSiteScope } from "./access";
import { siteCapabilities } from "./capabilities";

const mutationIdSchema = z.string().trim().min(16).max(64);
const dateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const qty = z.string().trim().max(20);

function todayIst() {
  return new Date(Date.now() + 330 * 60_000).toISOString().slice(0, 10);
}

function requireDb(db: Awaited<ReturnType<typeof getDb>>) {
  if (!db)
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message: "The business data service is temporarily unavailable.",
    });
  return db;
}

function needQty(text: string | undefined, label: string, optional = false): bigint | null {
  if (!text?.trim()) {
    if (optional) return null;
    throw new TRPCError({ code: "BAD_REQUEST", message: `Enter ${label}.` });
  }
  const value = parseThousandths(text);
  if (value === null)
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: `${label}: enter a number with up to 3 decimals.`,
    });
  return value;
}

/** Sites where the person holds a plant permission, with the organisation. */
async function plantSites(
  user: Parameters<typeof getAccessibleSites>[0],
  key: "plant.view" | "plant.log" | "plant.manage",
) {
  const accessible = await getAccessibleSites(user);
  const caps = await siteCapabilities(user, accessible);
  return accessible.filter((site) => caps.find((c) => c.siteId === site.id)?.[key]);
}

/**
 * Plant & machinery (site scoped `plant.view` / `plant.log` / `plant.manage`): equipment register
 * with this month's hours, fuel against norm, hire charge and service due; daily logsheets.
 */
export const plantRouter = router({
  register: protectedProcedure
    .input(
      z.object({
        month: z
          .string()
          .regex(/^\d{4}-\d{2}$/)
          .optional(),
      }),
    )
    .query(async ({ ctx, input }) => {
      const viewable = await plantSites(ctx.user, "plant.view");
      if (!viewable.length)
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "Your role does not include plant.view.",
        });
      const db = requireDb(await getDb());
      const today = todayIst();
      const month = input.month ?? today.slice(0, 7);
      const from = `${month}-01`;
      const to = `${month}-31`;
      const orgIds = [...new Set(viewable.map((s) => s.organizationId))];
      const siteIds = viewable.map((s) => s.id);
      const machines = await db
        .select()
        .from(equipment)
        .where(
          and(
            inArray(equipment.organizationId, orgIds),
            or(isNull(equipment.siteId), inArray(equipment.siteId, siteIds)),
          ),
        )
        .orderBy(equipment.code)
        .catch(() => []);
      const ids = machines.map((m) => m.id);
      const logs = ids.length
        ? await db
            .select()
            .from(equipmentLogs)
            .where(inArray(equipmentLogs.equipmentId, ids))
            .orderBy(desc(equipmentLogs.logDate))
            .limit(5000)
        : [];
      const managed = await plantSites(ctx.user, "plant.manage");
      const loggable = await plantSites(ctx.user, "plant.log");
      const siteName = new Map(viewable.map((s) => [s.id, s.name]));
      return {
        month,
        types: EQUIPMENT_TYPES,
        hireBases: HIRE_BASIS,
        sites: viewable.map((s) => ({
          id: s.id,
          name: s.name,
          canLog: loggable.some((x) => x.id === s.id),
          canManage: managed.some((x) => x.id === s.id),
        })),
        machines: machines.map((m) => {
          const own = logs.filter((l) => l.equipmentId === m.id);
          const monthLogs = own.filter((l) => l.logDate >= from && l.logDate <= to);
          let running = 0n;
          let working = 0n;
          let fuel = 0n;
          const perLog = monthLogs.map((l) => {
            const h = logHours({
              startMeter: BigInt(String(l.startMeterThousandths)),
              endMeter: BigInt(String(l.endMeterThousandths)),
              idle: BigInt(String(l.idleThousandths)),
            });
            const r = h.ok ? h.running : 0n;
            const w = h.ok ? h.working : 0n;
            running += r;
            working += w;
            fuel += BigInt(String(l.fuelThousandths));
            return { workingThousandths: w };
          });
          const norm =
            m.fuelNormThousandths === null ? null : BigInt(String(m.fuelNormThousandths));
          const fuelCheckResult = fuelCheck(fuel, running, norm);
          const lastMeter = own[0] ? BigInt(String(own[0].endMeterThousandths)) : null;
          const hireDays = (() => {
            if (m.ownership !== "Hired" || !m.hireFrom) return 0;
            const start = m.hireFrom > from ? m.hireFrom : from;
            const endCap = m.hireTo && m.hireTo < to ? m.hireTo : today < to ? today : to;
            const d =
              Math.floor(
                (Date.parse(`${endCap}T00:00:00Z`) - Date.parse(`${start}T00:00:00Z`)) / 86_400_000,
              ) + 1;
            return Math.max(0, d);
          })();
          return {
            ...m,
            hireRateMinor: m.hireRateMinor === null ? null : String(m.hireRateMinor),
            fuelNormThousandths: norm?.toString() ?? null,
            siteName: m.siteId ? (siteName.get(m.siteId) ?? "") : null,
            lastLogDate: own[0]?.logDate ?? null,
            lastMeterThousandths: lastMeter?.toString() ?? null,
            month: {
              days: monthLogs.length,
              runningThousandths: running.toString(),
              workingThousandths: working.toString(),
              fuelThousandths: fuel.toString(),
              expectedFuelThousandths: fuelCheckResult.expected?.toString() ?? null,
              fuelVariancePct: fuelCheckResult.variancePct,
              fuelHigh: fuelCheckResult.high,
              hireMinor:
                m.ownership === "Hired" && m.hireBasis && m.hireRateMinor !== null
                  ? hireCharge(
                      m.hireBasis,
                      BigInt(String(m.hireRateMinor)),
                      perLog,
                      hireDays,
                    ).toString()
                  : null,
            },
            serviceLeftThousandths:
              serviceLeft(
                m.lastServiceMeterThousandths === null
                  ? null
                  : BigInt(String(m.lastServiceMeterThousandths)),
                lastMeter,
                m.serviceIntervalHours,
              )?.toString() ?? null,
            recentLogs: own.slice(0, 7).map((l) => ({
              id: l.id,
              logDate: l.logDate,
              siteName: siteName.get(l.siteId) ?? "",
              startMeterThousandths: String(l.startMeterThousandths),
              endMeterThousandths: String(l.endMeterThousandths),
              idleThousandths: String(l.idleThousandths),
              fuelThousandths: String(l.fuelThousandths),
              operatorName: l.operatorName,
              workDone: l.workDone,
            })),
          };
        }),
      };
    }),

  addEquipment: protectedProcedure
    .input(
      z.object({
        siteId: z.string().uuid(),
        name: z.string().trim().min(2).max(160),
        equipmentType: z.enum(EQUIPMENT_TYPES),
        registrationNumber: z.string().trim().max(40).optional(),
        ownership: z.enum(["Owned", "Hired"]),
        ownerName: z.string().trim().max(180).optional(),
        hireBasis: z.enum(HIRE_BASIS).optional(),
        hireRateRupees: z.string().trim().max(20).optional(),
        hireFrom: dateSchema.optional(),
        fuelNorm: qty.optional(),
        serviceIntervalHours: z.number().int().min(10).max(5000).optional(),
        currentMeter: qty.optional(),
        clientMutationId: mutationIdSchema,
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const scope = await getSiteScope(ctx.user, input.siteId, "plant.manage");
      if (
        input.ownership === "Hired" &&
        (!input.hireBasis || !input.hireRateRupees || !input.hireFrom)
      )
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "For hired equipment enter the hire basis, rate and start date.",
        });
      const db = requireDb(await getDb());
      const [prior] = await db
        .select({ id: equipment.id, code: equipment.code })
        .from(equipment)
        .where(eq(equipment.clientMutationId, input.clientMutationId))
        .limit(1);
      if (prior) return prior;
      let rate: string | null = null;
      if (input.hireRateRupees) {
        try {
          rate = parseRupeesToMinor(input.hireRateRupees);
        } catch {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "Hire rate: enter rupees with up to 2 decimals.",
          });
        }
      }
      const id = randomUUID();
      let code = "";
      await db.transaction(async (tx) => {
        const [n] = await tx
          .select({ n: count() })
          .from(equipment)
          .where(eq(equipment.organizationId, scope.organizationId));
        code = equipmentCode(Number(n?.n ?? 0) + 1);
        await tx.insert(equipment).values({
          id,
          organizationId: scope.organizationId,
          code,
          name: input.name,
          equipmentType: input.equipmentType,
          registrationNumber: input.registrationNumber || null,
          ownership: input.ownership,
          ownerName: input.ownerName || null,
          hireBasis: input.ownership === "Hired" ? input.hireBasis! : null,
          hireRateMinor: input.ownership === "Hired" ? rate : null,
          hireFrom: input.ownership === "Hired" ? input.hireFrom! : null,
          fuelNormThousandths: needQty(input.fuelNorm, "Fuel norm", true)?.toString() ?? null,
          serviceIntervalHours: input.serviceIntervalHours ?? null,
          lastServiceMeterThousandths:
            needQty(input.currentMeter, "Current meter", true)?.toString() ?? null,
          siteId: input.siteId,
          clientMutationId: input.clientMutationId,
          createdBy: ctx.user.id,
        });
        await tx.insert(auditEvents).values({
          id: randomUUID(),
          organizationId: scope.organizationId,
          siteId: input.siteId,
          actorUserId: ctx.user.id,
          action: "plant.equipment_added",
          entityType: "equipment",
          entityId: id,
          afterSummary: JSON.stringify({ code, name: input.name, ownership: input.ownership }),
        });
      });
      return { id, code };
    }),

  /** Moves a machine to another site, changes its status, or ends the hire. */
  update: protectedProcedure
    .input(
      z.object({
        id: z.string().uuid(),
        siteId: z.string().uuid(),
        status: z.enum(["Working", "Idle", "Breakdown", "Off-hired", "Disposed"]),
        hireTo: dateSchema.optional(),
        note: z.string().trim().min(3).max(300),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const scope = await getSiteScope(ctx.user, input.siteId, "plant.manage");
      const db = requireDb(await getDb());
      const [row] = await db
        .select()
        .from(equipment)
        .where(and(eq(equipment.id, input.id), eq(equipment.organizationId, scope.organizationId)))
        .limit(1);
      if (!row) throw new TRPCError({ code: "NOT_FOUND", message: "Equipment not found." });
      if (row.siteId && row.siteId !== input.siteId)
        await getSiteScope(ctx.user, row.siteId, "plant.manage");
      await db
        .update(equipment)
        .set({
          siteId: input.siteId,
          status: input.status,
          hireTo: input.status === "Off-hired" ? (input.hireTo ?? todayIst()) : row.hireTo,
        })
        .where(eq(equipment.id, row.id));
      await db.insert(auditEvents).values({
        id: randomUUID(),
        organizationId: scope.organizationId,
        siteId: input.siteId,
        actorUserId: ctx.user.id,
        action: "plant.equipment_updated",
        entityType: "equipment",
        entityId: row.id,
        beforeSummary: JSON.stringify({ siteId: row.siteId, status: row.status }),
        afterSummary: JSON.stringify({ siteId: input.siteId, status: input.status }),
        reason: input.note,
      });
      return { ok: true as const };
    }),

  log: protectedProcedure
    .input(
      z.object({
        equipmentId: z.string().uuid(),
        siteId: z.string().uuid(),
        logDate: dateSchema,
        startMeter: qty,
        endMeter: qty,
        idle: qty.optional(),
        fuel: qty.optional(),
        operatorName: z.string().trim().max(160).optional(),
        workDone: z.string().trim().max(300).optional(),
        clientMutationId: mutationIdSchema,
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const scope = await getSiteScope(ctx.user, input.siteId, "plant.log");
      if (input.logDate > todayIst())
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "A logsheet cannot be for a future day.",
        });
      const start = needQty(input.startMeter, "Opening meter")!;
      const end = needQty(input.endMeter, "Closing meter")!;
      const idle = needQty(input.idle, "Idle hours", true) ?? 0n;
      const fuel = needQty(input.fuel, "Fuel", true) ?? 0n;
      const hours = logHours({ startMeter: start, endMeter: end, idle });
      if (!hours.ok) throw new TRPCError({ code: "BAD_REQUEST", message: hours.error });
      const db = requireDb(await getDb());
      const [prior] = await db
        .select({ id: equipmentLogs.id })
        .from(equipmentLogs)
        .where(eq(equipmentLogs.clientMutationId, input.clientMutationId))
        .limit(1);
      if (prior) return { id: prior.id, fuelHigh: false, fuelVariancePct: null as number | null };
      const [machine] = await db
        .select()
        .from(equipment)
        .where(
          and(
            eq(equipment.id, input.equipmentId),
            eq(equipment.organizationId, scope.organizationId),
          ),
        )
        .limit(1);
      if (!machine) throw new TRPCError({ code: "NOT_FOUND", message: "Equipment not found." });
      const [sameDay] = await db
        .select({ id: equipmentLogs.id })
        .from(equipmentLogs)
        .where(
          and(eq(equipmentLogs.equipmentId, machine.id), eq(equipmentLogs.logDate, input.logDate)),
        )
        .limit(1);
      if (sameDay)
        throw new TRPCError({
          code: "CONFLICT",
          message: "This machine already has a logsheet for that day.",
        });
      const [before] = await db
        .select({ end: equipmentLogs.endMeterThousandths, date: equipmentLogs.logDate })
        .from(equipmentLogs)
        .where(
          and(eq(equipmentLogs.equipmentId, machine.id), lte(equipmentLogs.logDate, input.logDate)),
        )
        .orderBy(desc(equipmentLogs.logDate))
        .limit(1);
      if (before && start < BigInt(String(before.end)))
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: `The opening meter is below the last closing reading (${before.date}).`,
        });
      const [after] = await db
        .select({ start: equipmentLogs.startMeterThousandths, date: equipmentLogs.logDate })
        .from(equipmentLogs)
        .where(
          and(eq(equipmentLogs.equipmentId, machine.id), gte(equipmentLogs.logDate, input.logDate)),
        )
        .orderBy(equipmentLogs.logDate)
        .limit(1);
      if (after && end > BigInt(String(after.start)))
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: `The closing meter is above the next day's opening reading (${after.date}).`,
        });
      const id = randomUUID();
      await db.transaction(async (tx) => {
        await tx.insert(equipmentLogs).values({
          id,
          organizationId: scope.organizationId,
          equipmentId: machine.id,
          siteId: input.siteId,
          logDate: input.logDate,
          startMeterThousandths: start.toString(),
          endMeterThousandths: end.toString(),
          idleThousandths: idle.toString(),
          fuelThousandths: fuel.toString(),
          operatorName: input.operatorName || null,
          workDone: input.workDone || null,
          clientMutationId: input.clientMutationId,
          createdBy: ctx.user.id,
        });
        await tx.insert(auditEvents).values({
          id: randomUUID(),
          organizationId: scope.organizationId,
          siteId: input.siteId,
          actorUserId: ctx.user.id,
          action: "plant.logsheet",
          entityType: "equipment_log",
          entityId: id,
          afterSummary: JSON.stringify({
            equipment: machine.code,
            date: input.logDate,
            running: hours.running.toString(),
            fuel: fuel.toString(),
          }),
        });
      });
      const check = fuelCheck(
        fuel,
        hours.running,
        machine.fuelNormThousandths === null ? null : BigInt(String(machine.fuelNormThousandths)),
      );
      return { id, fuelHigh: check.high, fuelVariancePct: check.variancePct };
    }),

  service: protectedProcedure
    .input(
      z.object({
        id: z.string().uuid(),
        siteId: z.string().uuid(),
        meter: qty,
        note: z.string().trim().min(3).max(300),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const scope = await getSiteScope(ctx.user, input.siteId, "plant.manage");
      const db = requireDb(await getDb());
      const meter = needQty(input.meter, "Meter at service")!;
      const [row] = await db
        .select()
        .from(equipment)
        .where(and(eq(equipment.id, input.id), eq(equipment.organizationId, scope.organizationId)))
        .limit(1);
      if (!row) throw new TRPCError({ code: "NOT_FOUND", message: "Equipment not found." });
      await db
        .update(equipment)
        .set({ lastServiceMeterThousandths: meter.toString() })
        .where(eq(equipment.id, row.id));
      await db.insert(auditEvents).values({
        id: randomUUID(),
        organizationId: scope.organizationId,
        siteId: input.siteId,
        actorUserId: ctx.user.id,
        action: "plant.serviced",
        entityType: "equipment",
        entityId: row.id,
        afterSummary: JSON.stringify({ meter: meter.toString() }),
        reason: input.note,
      });
      return { ok: true as const };
    }),
});
