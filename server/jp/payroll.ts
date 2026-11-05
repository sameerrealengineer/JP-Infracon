import { randomUUID } from "node:crypto";
import { and, asc, desc, eq, gte, inArray, isNotNull, isNull, lte, ne } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import {
  attendanceRecords,
  auditEvents,
  payrollLines,
  payrollProfiles,
  payrollRuns,
  payrollSettings,
  people,
  personSiteAssignments,
  sites,
  workerEngagements,
} from "../../drizzle/schema";
import { protectedProcedure, router } from "../_core/trpc";
import { getDb } from "../db";
import { getSiteScope, selfApprovalAllowed, type SiteScope } from "./access";
import { commercialAccess } from "./commercial-access";
import { parseHours, type AttendanceStatus, type RateType } from "../../lib/jp/attendance-domain";
import { parsePercentBps } from "../../lib/jp/billing-domain";
import { parseRupeesToMinor } from "../../lib/jp/finance-domain";
import {
  DEFAULT_RATES,
  RUN_TRANSITIONS,
  attendanceWages,
  checkIdentifiers,
  formatPtSlabs,
  monthBounds,
  parseDays,
  parsePtSlabs,
  payrollLine,
  prorate,
  runTotals,
  statutoryDues,
  type LineResult,
  type PayrollRates,
} from "../../lib/jp/payroll-domain";

/**
 * Payroll: a monthly pay run per site. Daily workers are paid from approved attendance (rate in
 * force on the day, overtime at the statutory multiplier); monthly staff from an approved payroll
 * profile, prorated by paid days. PF, ESI and professional tax use the company's dated rates,
 * snapshotted on the run. Accounts prepares, a different person approves, and "Paid" is a ledger
 * record of the wage payment, never a bank transfer. Every change is audited.
 */

const uuid = z.string().uuid();
const mutationId = z.string().trim().min(16).max(64);
const monthText = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, "Choose a month like 2026-10.");
const dateText = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use a date like 2026-11-04.");
const today = () => new Date().toISOString().slice(0, 10);

function requireDb(db: Awaited<ReturnType<typeof getDb>>) {
  if (!db)
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message: "The business data service is temporarily unavailable.",
    });
  return db;
}
type Db = ReturnType<typeof requireDb>;

function bad(message: string): never {
  throw new TRPCError({ code: "BAD_REQUEST", message });
}
function forbidden(message: string): never {
  throw new TRPCError({ code: "FORBIDDEN", message });
}
function rupees(value: string | null | undefined, label: string) {
  if (!value?.trim()) return 0n;
  try {
    return BigInt(parseRupeesToMinor(value, true));
  } catch {
    bad(`${label}: enter an amount in rupees, like 650 or 25000.50.`);
  }
}
function percent(value: string, label: string) {
  if (value.trim() === "0") return 0;
  const bps = parsePercentBps(value);
  if (bps === null) bad(`${label}: enter a percentage like 12 or 0.75.`);
  return bps;
}

async function audit(
  db: Db,
  scope: { organizationId: string; siteId: string | null },
  userId: number,
  args: {
    action: string;
    entityType: string;
    entityId: string;
    clientMutationId?: string;
    before?: unknown;
    after?: unknown;
    reason?: string | null;
  },
) {
  await db.insert(auditEvents).values({
    id: randomUUID(),
    organizationId: scope.organizationId,
    siteId: scope.siteId,
    actorUserId: userId,
    action: args.action,
    entityType: args.entityType,
    entityId: args.entityId,
    clientMutationId: args.clientMutationId ?? null,
    beforeSummary: args.before === undefined ? null : JSON.stringify(args.before),
    afterSummary: args.after === undefined ? null : JSON.stringify(args.after),
    reason: args.reason ?? null,
  });
}

async function replayed(db: Db, userId: number, clientMutationId: string) {
  const [event] = await db
    .select({ entityId: auditEvents.entityId })
    .from(auditEvents)
    .where(
      and(eq(auditEvents.actorUserId, userId), eq(auditEvents.clientMutationId, clientMutationId)),
    )
    .limit(1);
  return event ?? null;
}

async function can(user: Parameters<typeof getSiteScope>[0], siteId: string, key: string) {
  return getSiteScope(user, siteId, key)
    .then(() => true)
    .catch(() => false);
}

// ----- rates --------------------------------------------------------------------------------

type SettingsRow = typeof payrollSettings.$inferSelect;

function ratesFromRow(row: SettingsRow): PayrollRates {
  const slabs = row.ptSlabs ? parsePtSlabs(row.ptSlabs) : [];
  return {
    effectiveFrom: row.effectiveFrom,
    pfWageCeilingMinor: BigInt(row.pfWageCeilingMinor),
    pfEmployeeBps: row.pfEmployeeBps,
    pfEmployerBps: row.pfEmployerBps,
    epsBps: row.epsBps,
    epsCeilingMinor: BigInt(row.epsCeilingMinor),
    edliBps: row.edliBps,
    pfAdminBps: row.pfAdminBps,
    esiThresholdMinor: BigInt(row.esiThresholdMinor),
    esiEmployeeBps: row.esiEmployeeBps,
    esiEmployerBps: row.esiEmployerBps,
    overtimeMultiplierBps: row.overtimeMultiplierBps,
    wageShareBps: row.wageShareBps,
    ptSlabs: typeof slabs === "string" ? [] : slabs,
  };
}

export function ratesToJson(rates: PayrollRates) {
  return {
    ...rates,
    pfWageCeilingMinor: rates.pfWageCeilingMinor.toString(),
    epsCeilingMinor: rates.epsCeilingMinor.toString(),
    esiThresholdMinor: rates.esiThresholdMinor.toString(),
    ptSlabs: formatPtSlabs(rates.ptSlabs),
  };
}

/** Rates in force on a date: the latest company setting from on or before it, else defaults. */
async function ratesOn(db: Db, organizationId: string, date: string) {
  const [row] = await db
    .select()
    .from(payrollSettings)
    .where(
      and(
        eq(payrollSettings.organizationId, organizationId),
        lte(payrollSettings.effectiveFrom, date),
      ),
    )
    .orderBy(desc(payrollSettings.effectiveFrom))
    .limit(1);
  return row
    ? { rates: ratesFromRow(row), isDefault: false }
    : { rates: DEFAULT_RATES, isDefault: true };
}

// ----- profiles -----------------------------------------------------------------------------

type ProfileRow = typeof payrollProfiles.$inferSelect;

/** Profile in force for each person on the date (approved, latest effective date first). */
async function profilesInForce(db: Db, siteId: string, date: string) {
  const rows = await db
    .select()
    .from(payrollProfiles)
    .where(
      and(
        eq(payrollProfiles.siteId, siteId),
        inArray(payrollProfiles.status, ["Active", "Superseded"]),
        lte(payrollProfiles.effectiveFrom, date),
      ),
    )
    .orderBy(desc(payrollProfiles.effectiveFrom), desc(payrollProfiles.createdAt));
  const map = new Map<string, ProfileRow>();
  for (const row of rows) if (!map.has(row.personId)) map.set(row.personId, row);
  return map;
}

// ----- building a run -----------------------------------------------------------------------

type Adjustment = {
  paidDaysHundredths: bigint | null;
  tdsMinor: bigint;
  advanceMinor: bigint;
  otherDeductionMinor: bigint;
  otherDeductionNote: string | null;
};

type BuiltLine = {
  personId: string;
  personName: string;
  profileId: string | null;
  payType: "Daily" | "Monthly";
  workedDaysHundredths: bigint;
  paidDaysHundredths: bigint;
  paidDaysEdited: boolean;
  overtimeHundredths: bigint;
  basicMinor: bigint;
  hraMinor: bigint;
  otherAllowanceMinor: bigint;
  overtimeMinor: bigint;
  otherDeductionNote: string | null;
  result: LineResult;
  warnings: string[];
};

/**
 * Lines for a site and month from approved attendance and approved profiles. Manual entries
 * (paid days, TDS, advance, other deduction) are kept from the previous version of the run.
 */
async function buildRun(
  db: Db,
  scope: SiteScope,
  month: string,
  rates: PayrollRates,
  keep: Map<string, Adjustment>,
) {
  const bounds = monthBounds(month);
  if (!bounds) bad("Choose a month like 2026-10.");
  const attendance = await db
    .select({
      personId: workerEngagements.personId,
      status: attendanceRecords.attendanceStatus,
      rateType: workerEngagements.rateType,
      rate: attendanceRecords.rateSnapshotMinor,
      regular: attendanceRecords.regularHours,
      overtime: attendanceRecords.overtimeHours,
      overtimeStatus: attendanceRecords.overtimeApprovalStatus,
      reviewedBy: attendanceRecords.reviewedBy,
    })
    .from(attendanceRecords)
    .innerJoin(workerEngagements, eq(attendanceRecords.workerEngagementId, workerEngagements.id))
    .where(
      and(
        eq(attendanceRecords.siteId, scope.siteId),
        gte(attendanceRecords.workDate, bounds.first),
        lte(attendanceRecords.workDate, bounds.last),
      ),
    );
  const unapproved = attendance.filter((row) => row.reviewedBy === null).length;
  const approved = attendance.filter((row) => row.reviewedBy !== null);
  const profiles = await profilesInForce(db, scope.siteId, bounds.last);
  const personIds = new Set<string>(approved.map((row) => row.personId));
  for (const profile of profiles.values())
    if (profile.payType === "Monthly") personIds.add(profile.personId);
  const names = personIds.size
    ? await db
        .select({ id: people.id, name: people.fullName })
        .from(people)
        .where(inArray(people.id, [...personIds]))
    : [];
  const nameOf = new Map(names.map((row) => [row.id, row.name]));
  // People paid at another site this month: ceilings apply per person, so flag it.
  const elsewhere = personIds.size
    ? await db
        .select({ personId: payrollLines.personId, siteName: sites.name })
        .from(payrollLines)
        .innerJoin(payrollRuns, eq(payrollLines.runId, payrollRuns.id))
        .innerJoin(sites, eq(payrollRuns.siteId, sites.id))
        .where(
          and(
            eq(payrollRuns.organizationId, scope.organizationId),
            eq(payrollRuns.month, month),
            ne(payrollRuns.siteId, scope.siteId),
            ne(payrollRuns.status, "Cancelled"),
            inArray(payrollLines.personId, [...personIds]),
          ),
        )
    : [];
  const lines: BuiltLine[] = [];
  for (const personId of personIds) {
    const profile = profiles.get(personId) ?? null;
    const rows = approved.filter((row) => row.personId === personId);
    const adjust = keep.get(personId);
    const warnings: string[] = [];
    const wages = attendanceWages(
      rows.map((row) => ({
        status: row.status as AttendanceStatus,
        rateType: row.rateType as RateType,
        rateMinor: row.rate,
        regularHundredths: parseHours(String(row.regular)) ?? 0n,
        overtimeHundredths: parseHours(String(row.overtime)) ?? 0n,
        overtimeApproved: row.overtimeStatus === "Approved",
      })),
      rates.overtimeMultiplierBps,
    );
    if (wages.missingRate)
      warnings.push(
        `${wages.missingRate} attendance day(s) have no approved rate and are not paid.`,
      );
    if (wages.notAttendanceBased)
      warnings.push(
        `${wages.notAttendanceBased} day(s) are on piece or contract rates; pay those through a work order.`,
      );
    for (const other of elsewhere.filter((row) => row.personId === personId))
      warnings.push(
        `Also in the ${other.siteName} pay run this month. PF and ESI limits apply to total pay; check them.`,
      );
    let line: Omit<BuiltLine, "result" | "warnings">;
    if (profile?.payType === "Monthly") {
      const from = profile.effectiveFrom > bounds.first ? profile.effectiveFrom : bounds.first;
      const calendarDays = BigInt(Number(bounds.last.slice(8)) - Number(from.slice(8)) + 1) * 100n;
      const absent = BigInt(rows.filter((row) => row.status === "Absent").length) * 100n;
      const defaultPaid = calendarDays - absent > 0n ? calendarDays - absent : 0n;
      const paid = adjust?.paidDaysHundredths ?? defaultPaid;
      if (from !== bounds.first)
        warnings.push(`Salary starts on ${from}; paid days count from then.`);
      if (wages.overtimeHundredths > 0n)
        warnings.push(
          "Overtime for monthly staff is not added automatically; add it to the salary profile if due.",
        );
      line = {
        personId,
        personName: nameOf.get(personId) ?? "Unknown",
        profileId: profile.id,
        payType: "Monthly",
        workedDaysHundredths: wages.daysHundredths,
        paidDaysHundredths: paid,
        paidDaysEdited: adjust?.paidDaysHundredths != null,
        overtimeHundredths: 0n,
        basicMinor: prorate(BigInt(profile.basicMinor), paid, bounds.days),
        hraMinor: prorate(BigInt(profile.hraMinor), paid, bounds.days),
        otherAllowanceMinor: prorate(BigInt(profile.otherAllowanceMinor), paid, bounds.days),
        overtimeMinor: 0n,
        otherDeductionNote: adjust?.otherDeductionNote ?? null,
      };
    } else {
      if (!profile) warnings.push("No payroll profile: PF and ESI are not applied.");
      line = {
        personId,
        personName: nameOf.get(personId) ?? "Unknown",
        profileId: profile?.id ?? null,
        payType: "Daily",
        workedDaysHundredths: wages.daysHundredths,
        paidDaysHundredths: wages.daysHundredths,
        paidDaysEdited: false,
        overtimeHundredths: wages.overtimeHundredths,
        basicMinor: wages.basicMinor,
        hraMinor: 0n,
        otherAllowanceMinor: 0n,
        overtimeMinor: wages.overtimeMinor,
        otherDeductionNote: adjust?.otherDeductionNote ?? null,
      };
    }
    const input = {
      payType: line.payType,
      basicMinor: line.basicMinor,
      hraMinor: line.hraMinor,
      otherAllowanceMinor: line.otherAllowanceMinor,
      overtimeMinor: line.overtimeMinor,
      pfMember: profile?.pfMember === "Yes",
      esiMember: profile?.esiMember === "Yes",
      ptApplies: profile?.ptApplies === "Yes",
      tdsMinor: adjust?.tdsMinor ?? 0n,
      advanceMinor: adjust?.advanceMinor ?? 0n,
      otherDeductionMinor: adjust?.otherDeductionMinor ?? 0n,
    };
    let result = payrollLine(input, rates);
    if ("code" in result) {
      result = payrollLine({ ...input, advanceMinor: 0n, otherDeductionMinor: 0n }, rates);
      warnings.push(
        "Advance and other deduction were removed: they were more than this month's pay.",
      );
      line.otherDeductionNote = null;
    }
    if ("code" in result) {
      result = payrollLine(
        { ...input, tdsMinor: 0n, advanceMinor: 0n, otherDeductionMinor: 0n },
        rates,
      );
      warnings.push("TDS was removed: it was more than this month's pay.");
    }
    if ("code" in result) bad(result.message);
    if (result.grossMinor === 0n) warnings.push("Nothing to pay this month.");
    lines.push({ ...line, result, warnings });
  }
  lines.sort(
    (a, b) => a.payType.localeCompare(b.payType) || a.personName.localeCompare(b.personName),
  );
  return { lines, unapproved, bounds };
}

function totalsOf(lines: readonly BuiltLine[]) {
  const totals = runTotals(lines.map((line) => line.result));
  const dues = statutoryDues(totals);
  return {
    lineCount: lines.length,
    grossMinor: totals.grossMinor.toString(),
    deductionMinor: totals.totalDeductionMinor.toString(),
    netMinor: totals.netMinor.toString(),
    pfDueMinor: dues.pfMinor.toString(),
    esiDueMinor: dues.esiMinor.toString(),
    ptDueMinor: dues.ptMinor.toString(),
    tdsDueMinor: dues.tdsMinor.toString(),
    costMinor: totals.costMinor.toString(),
  };
}

function lineRow(runId: string, line: BuiltLine, id: string) {
  const r = line.result;
  return {
    id,
    runId,
    personId: line.personId,
    profileId: line.profileId,
    payType: line.payType,
    workedDaysHundredths: Number(line.workedDaysHundredths),
    paidDaysHundredths: Number(line.paidDaysHundredths),
    paidDaysEdited: line.paidDaysEdited ? ("Yes" as const) : ("No" as const),
    overtimeHundredths: Number(line.overtimeHundredths),
    basicMinor: line.basicMinor.toString(),
    hraMinor: line.hraMinor.toString(),
    otherAllowanceMinor: line.otherAllowanceMinor.toString(),
    overtimeMinor: line.overtimeMinor.toString(),
    grossMinor: r.grossMinor.toString(),
    pfWageMinor: r.pfWageMinor.toString(),
    pfEmployeeMinor: r.pfEmployeeMinor.toString(),
    esiEmployeeMinor: r.esiEmployeeMinor.toString(),
    ptMinor: r.ptMinor.toString(),
    tdsMinor: r.tdsMinor.toString(),
    advanceMinor: r.advanceMinor.toString(),
    otherDeductionMinor: r.otherDeductionMinor.toString(),
    otherDeductionNote: line.otherDeductionNote,
    netMinor: r.netMinor.toString(),
    employerEpfMinor: r.employerEpfMinor.toString(),
    employerEpsMinor: r.employerEpsMinor.toString(),
    edliAdminMinor: r.edliAdminMinor.toString(),
    esiEmployerMinor: r.esiEmployerMinor.toString(),
    costMinor: r.costMinor.toString(),
    warnings: line.warnings.length ? JSON.stringify(line.warnings) : null,
  };
}

function snapshotRates(text: string): PayrollRates {
  const raw = JSON.parse(text) as ReturnType<typeof ratesToJson>;
  const slabs = parsePtSlabs(raw.ptSlabs ?? "");
  return {
    ...raw,
    pfWageCeilingMinor: BigInt(raw.pfWageCeilingMinor),
    epsCeilingMinor: BigInt(raw.epsCeilingMinor),
    esiThresholdMinor: BigInt(raw.esiThresholdMinor),
    ptSlabs: typeof slabs === "string" ? [] : slabs,
  };
}

async function adjustmentsOf(db: Db, runId: string) {
  const rows = await db.select().from(payrollLines).where(eq(payrollLines.runId, runId));
  return new Map<string, Adjustment>(
    rows.map((row) => [
      row.personId,
      {
        paidDaysHundredths: row.paidDaysEdited === "Yes" ? BigInt(row.paidDaysHundredths) : null,
        tdsMinor: BigInt(row.tdsMinor),
        advanceMinor: BigInt(row.advanceMinor),
        otherDeductionMinor: BigInt(row.otherDeductionMinor),
        otherDeductionNote: row.otherDeductionNote,
      },
    ]),
  );
}

/** Replace a run's lines and totals inside the caller's transaction. */
async function writeLines(tx: Db, runId: string, lines: readonly BuiltLine[]) {
  // Keep each person's line id so a screen that is open keeps pointing at the same line.
  const previous = await tx
    .select({ id: payrollLines.id, personId: payrollLines.personId })
    .from(payrollLines)
    .where(eq(payrollLines.runId, runId));
  const idOf = new Map(previous.map((row) => [row.personId, row.id]));
  await tx.delete(payrollLines).where(eq(payrollLines.runId, runId));
  if (lines.length)
    await tx
      .insert(payrollLines)
      .values(lines.map((line) => lineRow(runId, line, idOf.get(line.personId) ?? randomUUID())));
  await tx.update(payrollRuns).set(totalsOf(lines)).where(eq(payrollRuns.id, runId));
}

async function loadRun(db: Db, siteId: string, runId: string) {
  const [run] = await db.select().from(payrollRuns).where(eq(payrollRuns.id, runId)).limit(1);
  if (!run || run.siteId !== siteId)
    throw new TRPCError({ code: "NOT_FOUND", message: "Pay run not found on this site." });
  return run;
}

const profileInput = z.object({
  siteId: uuid,
  personId: uuid,
  payType: z.enum(["Daily", "Monthly"]),
  basicRupees: z.string().trim().max(20).nullish(),
  hraRupees: z.string().trim().max(20).nullish(),
  otherAllowanceRupees: z.string().trim().max(20).nullish(),
  pfMember: z.boolean(),
  esiMember: z.boolean(),
  ptApplies: z.boolean(),
  uan: z.string().trim().max(12).nullish(),
  esiNumber: z.string().trim().max(10).nullish(),
  effectiveFrom: dateText,
  clientMutationId: mutationId,
});

export const payrollRouter = router({
  /** Company rates in force today, their history, and whether they are still the defaults. */
  settings: protectedProcedure.input(z.object({ siteId: uuid })).query(async ({ ctx, input }) => {
    const scope = await getSiteScope(ctx.user, input.siteId, "payroll.view");
    const db = requireDb(await getDb());
    const current = await ratesOn(db, scope.organizationId, today());
    const history = await db
      .select()
      .from(payrollSettings)
      .where(eq(payrollSettings.organizationId, scope.organizationId))
      .orderBy(desc(payrollSettings.effectiveFrom))
      .limit(20);
    const canEdit = await commercialAccess(ctx.user, "accounts.manage")
      .then(() => true)
      .catch(() => false);
    return {
      current: ratesToJson(current.rates),
      isDefault: current.isDefault,
      history: history.map((row) => ({
        ...ratesToJson(ratesFromRow(row)),
        note: row.note,
        id: row.id,
      })),
      canEdit,
    };
  }),

  /** New dated rates (accounts.manage). Applies to runs for months starting on or after the date. */
  saveSettings: protectedProcedure
    .input(
      z.object({
        effectiveFrom: dateText,
        pfWageCeilingRupees: z.string().trim().max(20),
        pfEmployeePercent: z.string().trim().max(10),
        pfEmployerPercent: z.string().trim().max(10),
        epsPercent: z.string().trim().max(10),
        epsCeilingRupees: z.string().trim().max(20),
        edliPercent: z.string().trim().max(10),
        pfAdminPercent: z.string().trim().max(10),
        esiThresholdRupees: z.string().trim().max(20),
        esiEmployeePercent: z.string().trim().max(10),
        esiEmployerPercent: z.string().trim().max(10),
        overtimeTimes: z.string().trim().max(10),
        wageSharePercent: z.string().trim().max(10),
        ptSlabs: z.string().max(2000),
        note: z.string().trim().max(1000).nullish(),
        clientMutationId: mutationId,
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const access = await commercialAccess(ctx.user, "accounts.manage");
      const db = access.db;
      if (await replayed(db, ctx.user.id, input.clientMutationId)) return { ok: true };
      const slabs = parsePtSlabs(input.ptSlabs);
      if (typeof slabs === "string") bad(`Professional tax: ${slabs}`);
      const times = parsePercentBps(input.overtimeTimes);
      if (times === null || times < 100 || times > 400)
        bad("Overtime: enter how many times the ordinary rate, like 2.");
      const row = {
        pfWageCeilingMinor: rupees(input.pfWageCeilingRupees, "PF wage ceiling"),
        pfEmployeeBps: percent(input.pfEmployeePercent, "PF employee"),
        pfEmployerBps: percent(input.pfEmployerPercent, "PF employer"),
        epsBps: percent(input.epsPercent, "EPS"),
        epsCeilingMinor: rupees(input.epsCeilingRupees, "EPS ceiling"),
        edliBps: percent(input.edliPercent, "EDLI"),
        pfAdminBps: percent(input.pfAdminPercent, "PF admin"),
        esiThresholdMinor: rupees(input.esiThresholdRupees, "ESI limit"),
        esiEmployeeBps: percent(input.esiEmployeePercent, "ESI employee"),
        esiEmployerBps: percent(input.esiEmployerPercent, "ESI employer"),
        // "2" is parsed as 2% (200 bps) → 2 times = 20000 bps.
        overtimeMultiplierBps: times * 100,
        wageShareBps: percent(input.wageSharePercent, "Wages share"),
      };
      if (row.pfWageCeilingMinor <= 0n || row.esiThresholdMinor <= 0n || row.epsCeilingMinor <= 0n)
        bad("Ceilings and limits must be more than 0.");
      if (row.epsBps > row.pfEmployerBps) bad("EPS cannot be more than the employer PF share.");
      if (row.wageShareBps < 1000 || row.wageShareBps > 10_000)
        bad("Wages share: enter a percentage between 10 and 100.");
      for (const [label, bps] of [
        ["PF employee", row.pfEmployeeBps],
        ["PF employer", row.pfEmployerBps],
        ["ESI employee", row.esiEmployeeBps],
        ["ESI employer", row.esiEmployerBps],
      ] as const)
        if (bps > 2500) bad(`${label} looks too high (over 25%).`);
      const [existing] = await db
        .select({ id: payrollSettings.id })
        .from(payrollSettings)
        .where(
          and(
            eq(payrollSettings.organizationId, access.organizationId),
            eq(payrollSettings.effectiveFrom, input.effectiveFrom),
          ),
        )
        .limit(1);
      if (existing) bad("Rates from this date already exist. Choose another date.");
      const id = randomUUID();
      await db.transaction(async (tx) => {
        await tx.insert(payrollSettings).values({
          id,
          organizationId: access.organizationId,
          effectiveFrom: input.effectiveFrom,
          ...row,
          pfWageCeilingMinor: row.pfWageCeilingMinor.toString(),
          epsCeilingMinor: row.epsCeilingMinor.toString(),
          esiThresholdMinor: row.esiThresholdMinor.toString(),
          ptSlabs: formatPtSlabs(slabs) || null,
          note: input.note ?? null,
          clientMutationId: input.clientMutationId,
          createdBy: ctx.user.id,
        });
        await audit(
          tx as unknown as Db,
          { organizationId: access.organizationId, siteId: null },
          ctx.user.id,
          {
            action: "payroll.settings_save",
            entityType: "payroll_settings",
            entityId: id,
            clientMutationId: input.clientMutationId,
            after: {
              ...ratesToJson({
                ...DEFAULT_RATES,
                ...row,
                effectiveFrom: input.effectiveFrom,
                ptSlabs: slabs,
              }),
            },
            reason: input.note ?? null,
          },
        );
      });
      return { ok: true, id };
    }),

  /** People on the site with the profile in force and any profile waiting for approval. */
  people: protectedProcedure.input(z.object({ siteId: uuid })).query(async ({ ctx, input }) => {
    const scope = await getSiteScope(ctx.user, input.siteId, "payroll.view");
    const db = requireDb(await getDb());
    const roster = await db
      .select({
        id: people.id,
        name: people.fullName,
        trade: people.tradeType,
        type: people.personType,
      })
      .from(personSiteAssignments)
      .innerJoin(people, eq(personSiteAssignments.personId, people.id))
      .where(
        and(
          eq(personSiteAssignments.siteId, scope.siteId),
          eq(personSiteAssignments.status, "Active"),
          ne(people.status, "Inactive"),
        ),
      )
      .orderBy(asc(people.fullName));
    const inForce = await profilesInForce(db, scope.siteId, today());
    const pending = await db
      .select()
      .from(payrollProfiles)
      .where(and(eq(payrollProfiles.siteId, scope.siteId), eq(payrollProfiles.status, "Pending")));
    const [canPrepare, canApprove, selfOk] = await Promise.all([
      can(ctx.user, scope.siteId, "payroll.prepare"),
      can(ctx.user, scope.siteId, "payroll.approve"),
      selfApprovalAllowed(ctx.user, scope.siteId),
    ]);
    return {
      people: roster.map((person) => {
        const waiting = pending.find((row) => row.personId === person.id) ?? null;
        return {
          ...person,
          profile: inForce.get(person.id) ?? null,
          pending: waiting
            ? { ...waiting, canReview: canApprove && (waiting.createdBy !== ctx.user.id || selfOk) }
            : null,
        };
      }),
      can: { prepare: canPrepare, approve: canApprove },
    };
  }),

  /** A new payroll profile for a person, waiting for a different person to approve it. */
  saveProfile: protectedProcedure.input(profileInput).mutation(async ({ ctx, input }) => {
    const scope = await getSiteScope(ctx.user, input.siteId, "payroll.prepare");
    const db = requireDb(await getDb());
    const prior = await replayed(db, ctx.user.id, input.clientMutationId);
    if (prior) return { id: prior.entityId };
    const [assigned] = await db
      .select({ id: personSiteAssignments.id })
      .from(personSiteAssignments)
      .innerJoin(people, eq(personSiteAssignments.personId, people.id))
      .where(
        and(
          eq(personSiteAssignments.siteId, scope.siteId),
          eq(personSiteAssignments.personId, input.personId),
          eq(personSiteAssignments.status, "Active"),
          eq(people.organizationId, scope.organizationId),
        ),
      )
      .limit(1);
    if (!assigned) bad("This person is not on this site's team.");
    const ids = checkIdentifiers(input.uan ?? "", input.esiNumber ?? "");
    if (ids) bad(ids.message);
    const basic = rupees(input.basicRupees, "Basic + DA");
    const hra = rupees(input.hraRupees, "HRA");
    const other = rupees(input.otherAllowanceRupees, "Other allowance");
    if (input.payType === "Monthly" && basic <= 0n) bad("Enter the monthly basic + DA.");
    if (input.payType === "Daily" && (basic > 0n || hra > 0n || other > 0n))
      bad("Daily workers are paid from attendance at their approved rate; leave the salary empty.");
    const id = randomUUID();
    await db.transaction(async (tx) => {
      // One waiting profile per person: a new one replaces the older request.
      await tx
        .update(payrollProfiles)
        .set({
          status: "Rejected",
          reviewReason: "Replaced by a newer request",
          reviewedAt: new Date(),
        })
        .where(
          and(
            eq(payrollProfiles.siteId, scope.siteId),
            eq(payrollProfiles.personId, input.personId),
            eq(payrollProfiles.status, "Pending"),
          ),
        );
      await tx.insert(payrollProfiles).values({
        id,
        organizationId: scope.organizationId,
        siteId: scope.siteId,
        personId: input.personId,
        payType: input.payType,
        basicMinor: basic.toString(),
        hraMinor: hra.toString(),
        otherAllowanceMinor: other.toString(),
        pfMember: input.pfMember ? "Yes" : "No",
        esiMember: input.esiMember ? "Yes" : "No",
        ptApplies: input.ptApplies ? "Yes" : "No",
        uan: input.uan?.trim() || null,
        esiNumber: input.esiNumber?.trim() || null,
        effectiveFrom: input.effectiveFrom,
        status: "Pending",
        clientMutationId: input.clientMutationId,
        createdBy: ctx.user.id,
      });
      await audit(tx as unknown as Db, scope, ctx.user.id, {
        action: "payroll.profile_create",
        entityType: "payroll_profile",
        entityId: id,
        clientMutationId: input.clientMutationId,
        after: {
          personId: input.personId,
          payType: input.payType,
          basicMinor: basic.toString(),
          hraMinor: hra.toString(),
          otherAllowanceMinor: other.toString(),
          pf: input.pfMember,
          esi: input.esiMember,
          effectiveFrom: input.effectiveFrom,
        },
      });
    });
    return { id };
  }),

  reviewProfile: protectedProcedure
    .input(
      z.object({
        siteId: uuid,
        profileId: uuid,
        action: z.enum(["approve", "reject"]),
        reason: z.string().trim().max(1000).nullish(),
        clientMutationId: mutationId,
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const scope = await getSiteScope(ctx.user, input.siteId, "payroll.approve");
      const db = requireDb(await getDb());
      if (await replayed(db, ctx.user.id, input.clientMutationId)) return { ok: true };
      if (input.action === "reject" && !input.reason?.trim()) bad("Give a reason.");
      const selfOk = await selfApprovalAllowed(ctx.user, scope.siteId);
      await db.transaction(async (tx) => {
        const [profile] = await tx
          .select()
          .from(payrollProfiles)
          .where(eq(payrollProfiles.id, input.profileId))
          .for("update");
        if (!profile || profile.siteId !== scope.siteId)
          throw new TRPCError({ code: "NOT_FOUND", message: "Profile not found." });
        if (profile.status !== "Pending") bad(`This profile is already ${profile.status}.`);
        if (profile.createdBy === ctx.user.id && !selfOk)
          forbidden("A different person must approve or reject this profile.");
        if (input.action === "approve")
          await tx
            .update(payrollProfiles)
            .set({ status: "Superseded" })
            .where(
              and(
                eq(payrollProfiles.siteId, scope.siteId),
                eq(payrollProfiles.personId, profile.personId),
                eq(payrollProfiles.status, "Active"),
              ),
            );
        await tx
          .update(payrollProfiles)
          .set({
            status: input.action === "approve" ? "Active" : "Rejected",
            reviewedBy: ctx.user.id,
            reviewedAt: new Date(),
            reviewReason: input.reason ?? null,
          })
          .where(eq(payrollProfiles.id, profile.id));
        await audit(tx as unknown as Db, scope, ctx.user.id, {
          action: `payroll.profile_${input.action}`,
          entityType: "payroll_profile",
          entityId: profile.id,
          clientMutationId: input.clientMutationId,
          before: { status: profile.status },
          after: { status: input.action === "approve" ? "Active" : "Rejected" },
          reason: input.reason ?? null,
        });
      });
      return { ok: true };
    }),

  runs: protectedProcedure.input(z.object({ siteId: uuid })).query(async ({ ctx, input }) => {
    const scope = await getSiteScope(ctx.user, input.siteId, "payroll.view");
    const db = requireDb(await getDb());
    const rows = await db
      .select()
      .from(payrollRuns)
      .where(eq(payrollRuns.siteId, scope.siteId))
      .orderBy(desc(payrollRuns.month), desc(payrollRuns.createdAt))
      .limit(60);
    return {
      runs: rows.map(({ ratesSnapshot: _rates, ...run }) => run),
      can: { prepare: await can(ctx.user, scope.siteId, "payroll.prepare") },
    };
  }),

  /** What a run for the month would contain, without saving it. */
  preview: protectedProcedure
    .input(z.object({ siteId: uuid, month: monthText }))
    .query(async ({ ctx, input }) => {
      const scope = await getSiteScope(ctx.user, input.siteId, "payroll.prepare");
      const db = requireDb(await getDb());
      const bounds = monthBounds(input.month);
      if (!bounds) bad("Choose a month like 2026-10.");
      const { rates, isDefault } = await ratesOn(db, scope.organizationId, bounds.first);
      const [existing] = await db
        .select({
          id: payrollRuns.id,
          runNumber: payrollRuns.runNumber,
          status: payrollRuns.status,
        })
        .from(payrollRuns)
        .where(
          and(
            eq(payrollRuns.siteId, scope.siteId),
            eq(payrollRuns.month, input.month),
            ne(payrollRuns.status, "Cancelled"),
          ),
        )
        .limit(1);
      const built = await buildRun(db, scope, input.month, rates, new Map());
      return {
        ...totalsOf(built.lines),
        unapproved: built.unapproved,
        ratesAreDefault: isDefault,
        monthNotOver: bounds.last >= today(),
        existing: existing ?? null,
        lines: built.lines.map((line) => ({
          personName: line.personName,
          payType: line.payType,
          grossMinor: line.result.grossMinor.toString(),
          netMinor: line.result.netMinor.toString(),
          warnings: line.warnings,
        })),
      };
    }),

  create: protectedProcedure
    .input(z.object({ siteId: uuid, month: monthText, clientMutationId: mutationId }))
    .mutation(async ({ ctx, input }) => {
      const scope = await getSiteScope(ctx.user, input.siteId, "payroll.prepare");
      const db = requireDb(await getDb());
      const prior = await replayed(db, ctx.user.id, input.clientMutationId);
      if (prior) return { id: prior.entityId };
      const bounds = monthBounds(input.month);
      if (!bounds) bad("Choose a month like 2026-10.");
      if (bounds.first > today())
        bad("You cannot make a pay run for a month that has not started.");
      const { rates } = await ratesOn(db, scope.organizationId, bounds.first);
      const id = randomUUID();
      await db.transaction(async (tx) => {
        const open = await tx
          .select({ runNumber: payrollRuns.runNumber, status: payrollRuns.status })
          .from(payrollRuns)
          .where(
            and(
              eq(payrollRuns.siteId, scope.siteId),
              eq(payrollRuns.month, input.month),
              ne(payrollRuns.status, "Cancelled"),
            ),
          )
          .for("update");
        if (open.length)
          bad(
            `${open[0].runNumber} (${open[0].status}) already covers this month. Cancel it first to make a new one.`,
          );
        const built = await buildRun(tx as unknown as Db, scope, input.month, rates, new Map());
        if (!built.lines.length)
          bad("Nobody to pay this month: no approved attendance and no monthly salary profiles.");
        const base = `PR-${scope.siteCode}-${input.month.replace("-", "")}`;
        const sameMonth = await tx
          .select({ runNumber: payrollRuns.runNumber })
          .from(payrollRuns)
          .where(
            and(
              eq(payrollRuns.organizationId, scope.organizationId),
              eq(payrollRuns.month, input.month),
            ),
          );
        const taken = new Set(sameMonth.map((row) => row.runNumber));
        let runNumber = base;
        for (let n = 2; taken.has(runNumber); n += 1) runNumber = `${base}-${n}`;
        await tx.insert(payrollRuns).values({
          id,
          organizationId: scope.organizationId,
          siteId: scope.siteId,
          runNumber,
          month: input.month,
          status: "Draft",
          ratesSnapshot: JSON.stringify(ratesToJson(rates)),
          ...totalsOf(built.lines),
          clientMutationId: input.clientMutationId,
          createdBy: ctx.user.id,
        });
        await writeLines(tx as unknown as Db, id, built.lines);
        await audit(tx as unknown as Db, scope, ctx.user.id, {
          action: "payroll.run_create",
          entityType: "payroll_run",
          entityId: id,
          clientMutationId: input.clientMutationId,
          after: { runNumber, month: input.month, ...totalsOf(built.lines) },
        });
      });
      return { id };
    }),

  run: protectedProcedure
    .input(z.object({ siteId: uuid, runId: uuid }))
    .query(async ({ ctx, input }) => {
      const scope = await getSiteScope(ctx.user, input.siteId, "payroll.view");
      const db = requireDb(await getDb());
      const run = await loadRun(db, scope.siteId, input.runId);
      const lines = await db
        .select({ line: payrollLines, name: people.fullName, trade: people.tradeType })
        .from(payrollLines)
        .innerJoin(people, eq(payrollLines.personId, people.id))
        .where(eq(payrollLines.runId, run.id));
      const profileIds = lines.map((row) => row.line.profileId).filter((id): id is string => !!id);
      const profiles = profileIds.length
        ? await db
            .select({
              id: payrollProfiles.id,
              uan: payrollProfiles.uan,
              esiNumber: payrollProfiles.esiNumber,
            })
            .from(payrollProfiles)
            .where(inArray(payrollProfiles.id, profileIds))
        : [];
      const bounds = monthBounds(run.month)!;
      const unapproved = await db
        .select({ id: attendanceRecords.id })
        .from(attendanceRecords)
        .where(
          and(
            eq(attendanceRecords.siteId, scope.siteId),
            gte(attendanceRecords.workDate, bounds.first),
            lte(attendanceRecords.workDate, bounds.last),
            isNull(attendanceRecords.reviewedBy),
          ),
        );
      const [canPrepare, canApprove, selfOk] = await Promise.all([
        can(ctx.user, scope.siteId, "payroll.prepare"),
        can(ctx.user, scope.siteId, "payroll.approve"),
        selfApprovalAllowed(ctx.user, scope.siteId),
      ]);
      const mine = run.createdBy === ctx.user.id;
      const editable = (run.status === "Draft" || run.status === "Returned") && mine && canPrepare;
      const { ratesSnapshot, ...rest } = run;
      return {
        run: rest,
        siteName: scope.siteName,
        rates: JSON.parse(ratesSnapshot) as ReturnType<typeof ratesToJson>,
        unapprovedAttendance: unapproved.length,
        lines: lines
          .map(({ line, name, trade }) => {
            const profile = profiles.find((p) => p.id === line.profileId);
            return {
              ...line,
              name,
              trade,
              uan: profile?.uan ?? null,
              esiNumber: profile?.esiNumber ?? null,
              warnings: line.warnings ? (JSON.parse(line.warnings) as string[]) : [],
            };
          })
          .sort((a, b) => a.payType.localeCompare(b.payType) || a.name.localeCompare(b.name)),
        can: {
          edit: editable,
          submit: editable,
          cancel: ["Draft", "Returned", "Submitted"].includes(run.status) && mine && canPrepare,
          review: run.status === "Submitted" && canApprove && (!mine || selfOk),
          pay: run.status === "Approved" && canPrepare,
        },
      };
    }),

  /** Manual entries on one line of a draft run; the server recomputes the line and totals. */
  updateLine: protectedProcedure
    .input(
      z.object({
        siteId: uuid,
        runId: uuid,
        lineId: uuid,
        paidDays: z.string().trim().max(6).nullish(),
        tdsRupees: z.string().trim().max(20).nullish(),
        advanceRupees: z.string().trim().max(20).nullish(),
        otherDeductionRupees: z.string().trim().max(20).nullish(),
        otherDeductionNote: z.string().trim().max(200).nullish(),
        clientMutationId: mutationId,
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const scope = await getSiteScope(ctx.user, input.siteId, "payroll.prepare");
      const db = requireDb(await getDb());
      if (await replayed(db, ctx.user.id, input.clientMutationId))
        return { ok: true, warnings: [] as string[] };
      const tds = rupees(input.tdsRupees, "TDS");
      const advance = rupees(input.advanceRupees, "Advance");
      const other = rupees(input.otherDeductionRupees, "Other deduction");
      if (other > 0n && !input.otherDeductionNote?.trim())
        bad("Say what the other deduction is for.");
      let warnings: string[] = [];
      await db.transaction(async (tx) => {
        const [run] = await tx
          .select()
          .from(payrollRuns)
          .where(eq(payrollRuns.id, input.runId))
          .for("update");
        if (!run || run.siteId !== scope.siteId)
          throw new TRPCError({ code: "NOT_FOUND", message: "Pay run not found." });
        if (run.status !== "Draft" && run.status !== "Returned")
          bad(`A ${run.status} pay run cannot be changed.`);
        if (run.createdBy !== ctx.user.id)
          forbidden("Only the person who made the pay run can change it.");
        const [line] = await tx
          .select()
          .from(payrollLines)
          .where(and(eq(payrollLines.id, input.lineId), eq(payrollLines.runId, run.id)))
          .limit(1);
        if (!line) throw new TRPCError({ code: "NOT_FOUND", message: "Line not found." });
        const bounds = monthBounds(run.month)!;
        let paidDays: bigint | null = null;
        if (input.paidDays?.trim()) {
          if (line.payType !== "Monthly")
            bad("Daily workers are paid for the attendance approved.");
          paidDays = parseDays(input.paidDays);
          if (paidDays === null || paidDays > BigInt(bounds.days) * 100n)
            bad(`Paid days must be between 0 and ${bounds.days}.`);
        }
        const keep = await adjustmentsOf(tx as unknown as Db, run.id);
        keep.set(line.personId, {
          paidDaysHundredths: paidDays,
          tdsMinor: tds,
          advanceMinor: advance,
          otherDeductionMinor: other,
          otherDeductionNote: other > 0n ? input.otherDeductionNote!.trim() : null,
        });
        const built = await buildRun(
          tx as unknown as Db,
          scope,
          run.month,
          snapshotRates(run.ratesSnapshot),
          keep,
        );
        const updated = built.lines.find((row) => row.personId === line.personId);
        if (!updated) bad("This person has nothing to pay this month any more. Refresh the run.");
        warnings = updated.warnings;
        await writeLines(tx as unknown as Db, run.id, built.lines);
        await audit(tx as unknown as Db, scope, ctx.user.id, {
          action: "payroll.line_update",
          entityType: "payroll_run",
          entityId: run.id,
          clientMutationId: input.clientMutationId,
          before: {
            personId: line.personId,
            paidDays: line.paidDaysHundredths,
            tdsMinor: line.tdsMinor,
            advanceMinor: line.advanceMinor,
            otherDeductionMinor: line.otherDeductionMinor,
          },
          after: {
            personId: line.personId,
            paidDays: updated.paidDaysHundredths.toString(),
            tdsMinor: updated.result.tdsMinor.toString(),
            advanceMinor: updated.result.advanceMinor.toString(),
            otherDeductionMinor: updated.result.otherDeductionMinor.toString(),
            netMinor: updated.result.netMinor.toString(),
          },
        });
      });
      return { ok: true, warnings };
    }),

  /** Rebuild a draft run from the latest approved attendance and profiles, keeping manual entries. */
  refresh: protectedProcedure
    .input(z.object({ siteId: uuid, runId: uuid, clientMutationId: mutationId }))
    .mutation(async ({ ctx, input }) => {
      const scope = await getSiteScope(ctx.user, input.siteId, "payroll.prepare");
      const db = requireDb(await getDb());
      if (await replayed(db, ctx.user.id, input.clientMutationId)) return { ok: true };
      await db.transaction(async (tx) => {
        const [run] = await tx
          .select()
          .from(payrollRuns)
          .where(eq(payrollRuns.id, input.runId))
          .for("update");
        if (!run || run.siteId !== scope.siteId)
          throw new TRPCError({ code: "NOT_FOUND", message: "Pay run not found." });
        if (run.status !== "Draft" && run.status !== "Returned")
          bad(`A ${run.status} pay run cannot be changed.`);
        if (run.createdBy !== ctx.user.id)
          forbidden("Only the person who made the pay run can change it.");
        const keep = await adjustmentsOf(tx as unknown as Db, run.id);
        const built = await buildRun(
          tx as unknown as Db,
          scope,
          run.month,
          snapshotRates(run.ratesSnapshot),
          keep,
        );
        await writeLines(tx as unknown as Db, run.id, built.lines);
        await audit(tx as unknown as Db, scope, ctx.user.id, {
          action: "payroll.run_refresh",
          entityType: "payroll_run",
          entityId: run.id,
          clientMutationId: input.clientMutationId,
          before: { grossMinor: run.grossMinor, lineCount: run.lineCount },
          after: totalsOf(built.lines),
        });
      });
      return { ok: true };
    }),

  transition: protectedProcedure
    .input(
      z.object({
        siteId: uuid,
        runId: uuid,
        action: z.enum(["submit", "approve", "return", "cancel"]),
        reason: z.string().trim().max(1000).nullish(),
        clientMutationId: mutationId,
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const step = RUN_TRANSITIONS[input.action];
      const scope = await getSiteScope(
        ctx.user,
        input.siteId,
        step.maker ? "payroll.prepare" : "payroll.approve",
      );
      const db = requireDb(await getDb());
      if (await replayed(db, ctx.user.id, input.clientMutationId)) return { ok: true };
      if ((input.action === "return" || input.action === "cancel") && !input.reason?.trim())
        bad("Give a reason.");
      const selfOk = await selfApprovalAllowed(ctx.user, scope.siteId);
      await db.transaction(async (tx) => {
        const [run] = await tx
          .select()
          .from(payrollRuns)
          .where(eq(payrollRuns.id, input.runId))
          .for("update");
        if (!run || run.siteId !== scope.siteId)
          throw new TRPCError({ code: "NOT_FOUND", message: "Pay run not found." });
        const verb = {
          submit: "submitted",
          approve: "approved",
          return: "returned",
          cancel: "cancelled",
        }[input.action];
        if (!(step.from as readonly string[]).includes(run.status))
          bad(`A ${run.status} pay run cannot be ${verb}.`);
        if (step.maker && run.createdBy !== ctx.user.id)
          forbidden("Only the person who made the pay run can do this.");
        if (!step.maker && run.createdBy === ctx.user.id && !selfOk)
          forbidden("A different person must approve or return this pay run.");
        if (input.action === "submit" || input.action === "approve") {
          const bounds = monthBounds(run.month)!;
          const pending = await tx
            .select({ id: attendanceRecords.id })
            .from(attendanceRecords)
            .where(
              and(
                eq(attendanceRecords.siteId, scope.siteId),
                gte(attendanceRecords.workDate, bounds.first),
                lte(attendanceRecords.workDate, bounds.last),
                isNull(attendanceRecords.reviewedBy),
              ),
            );
          if (pending.length)
            bad(
              `${pending.length} attendance entries for ${run.month} are not approved yet. Approve them, then refresh the run.`,
            );
          if (run.lineCount === 0) bad("This pay run has nobody on it.");
        }
        await tx
          .update(payrollRuns)
          .set({
            status: step.to,
            ...(input.action === "submit" ? { submittedAt: new Date() } : {}),
            ...(step.maker
              ? {}
              : {
                  reviewedBy: ctx.user.id,
                  reviewedAt: new Date(),
                  reviewReason: input.reason ?? null,
                }),
          })
          .where(eq(payrollRuns.id, run.id));
        await audit(tx as unknown as Db, scope, ctx.user.id, {
          action: `payroll.run_${input.action}`,
          entityType: "payroll_run",
          entityId: run.id,
          clientMutationId: input.clientMutationId,
          before: { status: run.status },
          after: { status: step.to, runNumber: run.runNumber, netMinor: run.netMinor },
          reason: input.reason ?? null,
        });
      });
      return { ok: true };
    }),

  /** Record that the approved wages were paid (an internal ledger record, not a bank transfer). */
  markPaid: protectedProcedure
    .input(
      z.object({
        siteId: uuid,
        runId: uuid,
        paidOn: dateText,
        mode: z.enum(["Bank transfer", "UPI", "Cheque", "Cash"]),
        reference: z.string().trim().max(120).nullish(),
        clientMutationId: mutationId,
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const scope = await getSiteScope(ctx.user, input.siteId, "payroll.prepare");
      const db = requireDb(await getDb());
      if (await replayed(db, ctx.user.id, input.clientMutationId)) return { ok: true };
      if (input.paidOn > today()) bad("The paid date cannot be in the future.");
      if (input.mode !== "Cash" && !input.reference?.trim())
        bad("Enter the bank, UPI or cheque reference.");
      await db.transaction(async (tx) => {
        const [run] = await tx
          .select()
          .from(payrollRuns)
          .where(eq(payrollRuns.id, input.runId))
          .for("update");
        if (!run || run.siteId !== scope.siteId)
          throw new TRPCError({ code: "NOT_FOUND", message: "Pay run not found." });
        if (run.status !== "Approved") bad(`A ${run.status} pay run cannot be marked paid.`);
        if (input.paidOn < `${run.month}-01`)
          bad("The paid date cannot be before the month it pays.");
        await tx
          .update(payrollRuns)
          .set({
            status: "Paid",
            paidOn: input.paidOn,
            paymentMode: input.mode,
            paymentReference: input.reference?.trim() || null,
            paidBy: ctx.user.id,
          })
          .where(eq(payrollRuns.id, run.id));
        await audit(tx as unknown as Db, scope, ctx.user.id, {
          action: "payroll.run_pay",
          entityType: "payroll_run",
          entityId: run.id,
          clientMutationId: input.clientMutationId,
          before: { status: run.status },
          after: {
            status: "Paid",
            netMinor: run.netMinor,
            paidOn: input.paidOn,
            mode: input.mode,
            reference: input.reference ?? null,
          },
        });
      });
      return { ok: true };
    }),
});

/** Approved or paid payroll for the company, used by Accounts (dues and project cost). */
export async function approvedPayroll(db: Db, organizationId: string) {
  return db
    .select({
      siteId: payrollRuns.siteId,
      month: payrollRuns.month,
      pfDueMinor: payrollRuns.pfDueMinor,
      esiDueMinor: payrollRuns.esiDueMinor,
      ptDueMinor: payrollRuns.ptDueMinor,
      tdsDueMinor: payrollRuns.tdsDueMinor,
      costMinor: payrollRuns.costMinor,
      runId: payrollRuns.id,
    })
    .from(payrollRuns)
    .where(
      and(
        eq(payrollRuns.organizationId, organizationId),
        inArray(payrollRuns.status, ["Approved", "Paid"]),
        isNotNull(payrollRuns.reviewedBy),
      ),
    );
}
