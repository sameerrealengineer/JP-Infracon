import { randomUUID } from "node:crypto";
import { and, asc, desc, eq, inArray, like, or } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import {
  auditEvents,
  contractItems,
  deptMeasurements,
  inventoryMovements,
  materialCoefficients,
  materialItems,
  qualityTests,
  sites,
} from "../../drizzle/schema";
import { netByItem } from "../../lib/jp/dept-mb";
import {
  TEST_TYPES,
  cubeDueDates,
  cubeVerdict,
  parseResults,
  rangeVerdict,
  reconcile,
  testState,
  theoretical,
} from "../../lib/jp/quality-domain";
import { protectedProcedure, router } from "../_core/trpc";
import { getDb } from "../db";
import { getSiteScope } from "./access";
import { commercialAccess, requireProject } from "./commercial-access";

const mutationIdSchema = z.string().trim().min(16).max(64);
const dateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

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

/** Parses a thousandths quantity text (up to 3 decimals). */
function thousandths(text: string, label: string): bigint {
  const t = text.trim();
  if (!/^\d{1,9}(\.\d{1,3})?$/.test(t))
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: `${label}: enter a number with up to 3 decimals.`,
    });
  const [w, f = ""] = t.split(".");
  return BigInt(w!) * 1000n + BigInt(f.padEnd(3, "0"));
}

/**
 * Quality test register per site (view `dpr.view`, write `dpr.create`) and cement/steel
 * reconciliation per project (client billing permissions, since it reads the contract BOQ).
 */
export const qualityRouter = router({
  list: protectedProcedure
    .input(z.object({ siteId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      await getSiteScope(ctx.user, input.siteId, "dpr.view");
      const db = requireDb(await getDb());
      const today = todayIst();
      const rows = await db
        .select()
        .from(qualityTests)
        .where(eq(qualityTests.siteId, input.siteId))
        .orderBy(asc(qualityTests.status), asc(qualityTests.dueDate), desc(qualityTests.sampledOn))
        .catch(() => []);
      const tests = rows.map((row) => ({
        ...row,
        state: testState(
          {
            dueDate: row.dueDate,
            status: row.status,
            pass: row.pass === null ? null : row.pass === "Yes",
          },
          today,
        ),
      }));
      return {
        today,
        types: TEST_TYPES,
        tests,
        summary: {
          dueToday: tests.filter((t) => t.status === "Pending" && t.dueDate === today).length,
          overdue: tests.filter((t) => t.state === "Overdue").length,
          failed: tests.filter((t) => t.state === "Failed").length,
          passed: tests.filter((t) => t.state === "Passed").length,
        },
      };
    }),

  /** A concrete pour: one cube set tested at 7 and 28 days, plus an optional slump result. */
  addCubeSet: protectedProcedure
    .input(
      z.object({
        siteId: z.string().uuid(),
        grade: z
          .string()
          .trim()
          .regex(/^M\d{1,2}(\.5)?$/i, "Grade like M20"),
        location: z.string().trim().min(2).max(200),
        castOn: dateSchema,
        slump: z.string().trim().max(20).optional(),
        clientMutationId: mutationIdSchema,
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const scope = await getSiteScope(ctx.user, input.siteId, "dpr.create");
      if (input.castOn > todayIst())
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "The casting date cannot be in the future.",
        });
      const db = requireDb(await getDb());
      const [prior] = await db
        .select({ setId: qualityTests.setId })
        .from(qualityTests)
        .where(eq(qualityTests.clientMutationId, `${input.clientMutationId}`))
        .limit(1);
      if (prior) return { setId: prior.setId };
      const setId = randomUUID();
      const due = cubeDueDates(input.castOn);
      const grade = input.grade.toUpperCase();
      const base = {
        organizationId: scope.organizationId,
        siteId: input.siteId,
        setId,
        grade,
        location: input.location,
        sampledOn: input.castOn,
        createdBy: ctx.user.id,
      };
      const slumpValues = input.slump ? parseResults(input.slump) : null;
      await db.transaction(async (tx) => {
        await tx.insert(qualityTests).values({
          ...base,
          id: randomUUID(),
          testType: "Concrete cube 7-day",
          dueDate: due.sevenDay,
          clientMutationId: input.clientMutationId,
        });
        await tx.insert(qualityTests).values({
          ...base,
          id: randomUUID(),
          testType: "Concrete cube 28-day",
          dueDate: due.twentyEightDay,
          clientMutationId: `${input.clientMutationId}:28`,
        });
        if (slumpValues) {
          await tx.insert(qualityTests).values({
            ...base,
            id: randomUUID(),
            testType: "Slump",
            dueDate: input.castOn,
            minValue: "25",
            maxValue: "100",
            results: slumpValues.join(", "),
            status: "Done",
            pass: slumpValues.every((v) => v >= 25 && v <= 100) ? "Yes" : "No",
            verdict: rangeVerdict(slumpValues, 25, 100)!.summary,
            resultBy: ctx.user.id,
            clientMutationId: `${input.clientMutationId}:sl`,
          });
        }
        await tx.insert(auditEvents).values({
          id: randomUUID(),
          organizationId: scope.organizationId,
          siteId: input.siteId,
          actorUserId: ctx.user.id,
          action: "quality.cubes_cast",
          entityType: "quality_test",
          entityId: setId,
          afterSummary: JSON.stringify({ grade, castOn: input.castOn, location: input.location }),
        });
      });
      return { setId };
    }),

  addTest: protectedProcedure
    .input(
      z.object({
        siteId: z.string().uuid(),
        testType: z.enum(TEST_TYPES),
        location: z.string().trim().min(2).max(200),
        sampledOn: dateSchema,
        dueDate: dateSchema.optional(),
        minValue: z.string().trim().max(20).optional(),
        maxValue: z.string().trim().max(20).optional(),
        clientMutationId: mutationIdSchema,
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const scope = await getSiteScope(ctx.user, input.siteId, "dpr.create");
      const db = requireDb(await getDb());
      const [prior] = await db
        .select({ id: qualityTests.id })
        .from(qualityTests)
        .where(eq(qualityTests.clientMutationId, input.clientMutationId))
        .limit(1);
      if (prior) return prior;
      const id = randomUUID();
      await db.insert(qualityTests).values({
        id,
        organizationId: scope.organizationId,
        siteId: input.siteId,
        testType: input.testType,
        location: input.location,
        sampledOn: input.sampledOn,
        dueDate: input.dueDate || input.sampledOn,
        minValue: input.minValue || null,
        maxValue: input.maxValue || null,
        clientMutationId: input.clientMutationId,
        createdBy: ctx.user.id,
      });
      await db.insert(auditEvents).values({
        id: randomUUID(),
        organizationId: scope.organizationId,
        siteId: input.siteId,
        actorUserId: ctx.user.id,
        action: "quality.test_added",
        entityType: "quality_test",
        entityId: id,
        afterSummary: JSON.stringify({ type: input.testType }),
      });
      return { id };
    }),

  /** Records results; the server decides pass or fail. */
  recordResult: protectedProcedure
    .input(
      z.object({
        siteId: z.string().uuid(),
        id: z.string().uuid(),
        results: z.string().trim().min(1).max(200),
        labName: z.string().trim().max(160).optional(),
        reportReference: z.string().trim().max(120).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const scope = await getSiteScope(ctx.user, input.siteId, "dpr.create");
      const db = requireDb(await getDb());
      const values = parseResults(input.results);
      if (!values)
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Enter the results as numbers, separated by commas.",
        });
      let verdictText = "";
      let pass: "Yes" | "No" | null = null;
      await db.transaction(async (tx) => {
        const [row] = await tx
          .select()
          .from(qualityTests)
          .where(and(eq(qualityTests.id, input.id), eq(qualityTests.siteId, input.siteId)))
          .for("update")
          .limit(1);
        if (!row) throw new TRPCError({ code: "NOT_FOUND", message: "Test not found." });
        if (row.status === "Done")
          throw new TRPCError({ code: "CONFLICT", message: "Results are already recorded." });
        const verdict = row.testType.startsWith("Concrete cube")
          ? cubeVerdict(row.grade ?? "", row.testType.includes("7") ? 7 : 28, values)
          : rangeVerdict(
              values,
              row.minValue ? Number(row.minValue) : null,
              row.maxValue ? Number(row.maxValue) : null,
            );
        pass = verdict ? (verdict.pass ? "Yes" : "No") : null;
        verdictText = verdict?.summary ?? "Results recorded.";
        await tx
          .update(qualityTests)
          .set({
            results: values.join(", "),
            pass,
            verdict: verdictText,
            labName: input.labName || null,
            reportReference: input.reportReference || null,
            status: "Done",
            resultBy: ctx.user.id,
          })
          .where(eq(qualityTests.id, row.id));
        await tx.insert(auditEvents).values({
          id: randomUUID(),
          organizationId: scope.organizationId,
          siteId: input.siteId,
          actorUserId: ctx.user.id,
          action: pass === "No" ? "quality.test_failed" : "quality.result_recorded",
          entityType: "quality_test",
          entityId: row.id,
          afterSummary: JSON.stringify({ results: values, pass }),
        });
      });
      return { pass, verdict: verdictText };
    }),

  /** Cement and steel: theoretical from measured MB work × consumption per unit, vs store issues. */
  reconciliation: protectedProcedure
    .input(z.object({ projectId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const access = await commercialAccess(ctx.user, "billing.view");
      requireProject(access, input.projectId);
      const db = access.db;
      const [items, coefficients, mb, projectSites] = await Promise.all([
        db
          .select()
          .from(contractItems)
          .where(
            and(eq(contractItems.projectId, input.projectId), eq(contractItems.status, "Active")),
          )
          .orderBy(asc(contractItems.itemCode)),
        db
          .select()
          .from(materialCoefficients)
          .where(eq(materialCoefficients.projectId, input.projectId))
          .catch(() => []),
        db
          .select()
          .from(deptMeasurements)
          .where(eq(deptMeasurements.projectId, input.projectId))
          .catch(() => []),
        db.select({ id: sites.id }).from(sites).where(eq(sites.projectId, input.projectId)),
      ]);
      const siteIds = projectSites.map((s) => s.id);
      const issued = siteIds.length
        ? await db
            .select({
              name: materialItems.name,
              category: materialItems.category,
              unit: inventoryMovements.unitCode,
              quantity: inventoryMovements.quantity,
              direction: inventoryMovements.direction,
              type: inventoryMovements.movementType,
            })
            .from(inventoryMovements)
            .innerJoin(materialItems, eq(inventoryMovements.materialItemId, materialItems.id))
            .where(
              and(
                inArray(inventoryMovements.siteId, siteIds),
                eq(inventoryMovements.status, "Posted"),
                or(
                  like(materialItems.name, "%ement%"),
                  like(materialItems.name, "%teel%"),
                  like(materialItems.name, "%TMT%"),
                  like(materialItems.category, "%ement%"),
                  like(materialItems.category, "%teel%"),
                ),
              ),
            )
        : [];
      const measured = netByItem(
        mb.map((row) => ({ ...row, quantityThousandths: String(row.quantityThousandths) })),
        ["Recorded", "Signed"],
      );
      const materials = (["Cement", "Steel"] as const).map((material) => {
        const lines = items
          .map((item) => {
            const coef = coefficients.find(
              (c) => c.contractItemId === item.id && c.material === material,
            );
            return coef
              ? {
                  item,
                  workThousandths: measured.get(item.id) ?? 0n,
                  perUnitThousandths: BigInt(String(coef.perUnitThousandths)),
                }
              : null;
          })
          .filter((line): line is NonNullable<typeof line> => line !== null);
        const theo = theoretical(lines);
        const isMaterial = (row: (typeof issued)[number]) =>
          material === "Cement"
            ? /cement/i.test(`${row.name} ${row.category ?? ""}`)
            : /steel|tmt|rebar/i.test(`${row.name} ${row.category ?? ""}`);
        let actual = 0n;
        const units = new Set<string>();
        for (const row of issued.filter(isMaterial)) {
          if (row.direction !== "Outbound") continue;
          units.add(row.unit);
          const [w, f = ""] = String(row.quantity).split(".");
          actual += BigInt(w || "0") * 1000n + BigInt((f + "000").slice(0, 3));
        }
        return {
          material,
          unit: material === "Cement" ? "bag" : "kg",
          storeUnits: [...units],
          theoreticalThousandths: theo.toString(),
          actualThousandths: actual.toString(),
          ...reconcile(material, theo, actual),
          lines: lines.map((line) => ({
            itemCode: line.item.itemCode,
            description: line.item.description,
            unit: line.item.unit,
            workThousandths: line.workThousandths.toString(),
            perUnitThousandths: line.perUnitThousandths.toString(),
          })),
        };
      });
      return {
        canEdit: access.can("billing.create"),
        items: items.map((item) => ({
          id: item.id,
          code: item.itemCode,
          description: item.description,
          unit: item.unit,
          cement:
            coefficients.find((c) => c.contractItemId === item.id && c.material === "Cement")
              ?.perUnitThousandths ?? null,
          steel:
            coefficients.find((c) => c.contractItemId === item.id && c.material === "Steel")
              ?.perUnitThousandths ?? null,
        })),
        materials,
      };
    }),

  setCoefficient: protectedProcedure
    .input(
      z.object({
        projectId: z.string().uuid(),
        contractItemId: z.string().uuid(),
        material: z.enum(["Cement", "Steel"]),
        perUnit: z.string().trim().max(20).nullable(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const access = await commercialAccess(ctx.user, "billing.create");
      requireProject(access, input.projectId);
      const [item] = await access.db
        .select({ id: contractItems.id })
        .from(contractItems)
        .where(
          and(
            eq(contractItems.id, input.contractItemId),
            eq(contractItems.projectId, input.projectId),
          ),
        )
        .limit(1);
      if (!item)
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Contract item not found on this project.",
        });
      await access.db.transaction(async (tx) => {
        await tx
          .delete(materialCoefficients)
          .where(
            and(
              eq(materialCoefficients.contractItemId, item.id),
              eq(materialCoefficients.material, input.material),
            ),
          );
        if (input.perUnit)
          await tx.insert(materialCoefficients).values({
            id: randomUUID(),
            organizationId: access.organizationId,
            projectId: input.projectId,
            contractItemId: item.id,
            material: input.material,
            perUnitThousandths: thousandths(input.perUnit, "Consumption per unit").toString(),
            updatedBy: ctx.user.id,
          });
        await tx.insert(auditEvents).values({
          id: randomUUID(),
          organizationId: access.organizationId,
          actorUserId: ctx.user.id,
          action: "quality.coefficient_set",
          entityType: "material_coefficient",
          entityId: item.id,
          afterSummary: JSON.stringify({ material: input.material, perUnit: input.perUnit }),
        });
      });
      return { ok: true as const };
    }),
});
