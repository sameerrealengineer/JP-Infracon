import { randomUUID } from "node:crypto";
import { and, eq, inArray, notInArray } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import {
  attendanceRecords,
  auditEvents,
  dailyReports,
  organizationMemberships,
  people,
  pettyCashMovements,
  sites,
  supplierPayments,
  userContactPreferences,
  users,
  workMeasurements,
  workerAdvances,
  type User,
} from "../../drizzle/schema";
import {
  formatDailySummary,
  istClock,
  summaryDue,
  type MoneyLine,
  type SiteDay,
} from "../../lib/jp/daily-summary";
import { normalizeIndianMobile } from "../../lib/jp/notify-policy";
import { protectedProcedure, router } from "../_core/trpc";
import { getDb } from "../db";
import { getAccessibleSites } from "./access";
import { siteCapabilities } from "./capabilities";
import { buildInbox } from "./inbox";
import { sendWhatsAppText } from "./notify";

const LEADERS = ["owner", "director", "admin"];
const SITE_MANAGERS = ["project_manager", "site_engineer", "supervisor"];

type Db = NonNullable<Awaited<ReturnType<typeof getDb>>>;

/** Sites this person gets in the summary: all for leaders, managed sites for site managers. */
async function summarySites(user: User) {
  const accessible = await getAccessibleSites(user);
  return accessible.filter(
    (site) =>
      user.role === "super_admin" ||
      LEADERS.includes(String(site.organizationRole)) ||
      SITE_MANAGERS.includes(String(site.businessRole)),
  );
}

/** The summary text for one person and day, or null when they have no sites to report. */
export async function summaryFor(db: Db, user: User, date: string): Promise<string | null> {
  const chosen = await summarySites(user);
  if (!chosen.length) return null;
  const caps = await siteCapabilities(user, chosen);
  const siteIds = chosen.map((site) => site.id);
  const [attendance, reports, measured, payments, cash, advances] = await Promise.all([
    db
      .select({
        siteId: attendanceRecords.siteId,
        status: attendanceRecords.attendanceStatus,
        reviewedBy: attendanceRecords.reviewedBy,
      })
      .from(attendanceRecords)
      .where(and(inArray(attendanceRecords.siteId, siteIds), eq(attendanceRecords.workDate, date))),
    db
      .select({
        siteId: dailyReports.siteId,
        kind: dailyReports.reportKind,
        status: dailyReports.status,
      })
      .from(dailyReports)
      .where(and(inArray(dailyReports.siteId, siteIds), eq(dailyReports.reportDate, date))),
    db
      .select({ siteId: workMeasurements.siteId })
      .from(workMeasurements)
      .where(and(inArray(workMeasurements.siteId, siteIds), eq(workMeasurements.measuredOn, date)))
      .catch(() => []),
    db
      .select({
        siteId: supplierPayments.siteId,
        who: supplierPayments.beneficiaryNameSnapshot,
        amountMinor: supplierPayments.amountMinor,
        why: supplierPayments.purpose,
      })
      .from(supplierPayments)
      .where(
        and(
          inArray(supplierPayments.siteId, siteIds),
          eq(supplierPayments.paymentDate, date),
          eq(supplierPayments.direction, "Outflow"),
          inArray(supplierPayments.status, ["Approved", "Posted"]),
        ),
      ),
    db
      .select({
        siteId: pettyCashMovements.siteId,
        who: pettyCashMovements.payeeName,
        amountMinor: pettyCashMovements.amountMinor,
        why: pettyCashMovements.purpose,
      })
      .from(pettyCashMovements)
      .where(
        and(
          inArray(pettyCashMovements.siteId, siteIds),
          eq(pettyCashMovements.movementDate, date),
          eq(pettyCashMovements.movementType, "Expense"),
          inArray(pettyCashMovements.status, ["Approved", "Posted"]),
        ),
      ),
    db
      .select({
        siteId: workerAdvances.siteId,
        who: people.fullName,
        amountMinor: workerAdvances.amountMinor,
        why: workerAdvances.reason,
      })
      .from(workerAdvances)
      .innerJoin(people, eq(workerAdvances.personId, people.id))
      .where(
        and(
          inArray(workerAdvances.siteId, siteIds),
          eq(workerAdvances.entryDate, date),
          eq(workerAdvances.entryType, "Advance"),
          notInArray(workerAdvances.status, ["Rejected", "Cancelled"]),
        ),
      )
      .catch(() => []),
  ]);
  const money = (
    rows: { siteId: string; who: string | null; amountMinor: string; why: string | null }[],
    siteId: string,
  ): MoneyLine[] =>
    rows
      .filter((row) => row.siteId === siteId)
      .map((row) => ({
        who: row.who ?? "",
        amountMinor: String(row.amountMinor),
        why: (row.why ?? "").replace(/\s+/g, " ").slice(0, 60),
      }));
  const days: SiteDay[] = chosen.map((site) => {
    const can = caps.find((row) => row.siteId === site.id);
    const marks = attendance.filter((row) => row.siteId === site.id);
    const report = (kind: "DPR" | "DLR") =>
      reports.find((row) => row.siteId === site.id && row.kind === kind)?.status ?? null;
    return {
      siteName: site.name,
      attendance: can?.["attendance.view"]
        ? {
            present: marks.filter(
              (row) => row.status === "Full Day" || row.status === "Present-hours-based",
            ).length,
            half: marks.filter((row) => row.status === "Half Day").length,
            absent: marks.filter((row) => row.status === "Absent").length,
            leave: marks.filter((row) => row.status === "Leave").length,
            waiting: marks.filter((row) => row.reviewedBy === null).length,
          }
        : null,
      reports: can?.["dpr.view"] ? { dpr: report("DPR"), dlr: report("DLR") } : null,
      measurements: can?.["subcontract.view"]
        ? measured.filter((row) => row.siteId === site.id).length
        : null,
      supplierPayments: can?.["finance.payment.view"] ? money(payments, site.id) : null,
      pettyCash: can?.["finance.cash.view"] ? money(cash, site.id) : null,
      advances: can?.["payroll.view"] || can?.["payroll.advance"] ? money(advances, site.id) : null,
    };
  });
  const inbox = await buildInbox(db, user.id, caps, { inboxVersion: 3 }).catch(() => null);
  return formatDailySummary({
    personName: user.name ?? "you",
    date,
    sites: days,
    waitingForYou: inbox?.items.length ?? 0,
  });
}

/** Leaders and site managers of a company, with a WhatsApp number they opted in with. */
async function recipients(db: Db, organizationId: string) {
  const rows = await db
    .select({
      user: users,
      role: organizationMemberships.businessRole,
      phone: userContactPreferences.phone,
      optIn: userContactPreferences.whatsappOptIn,
    })
    .from(organizationMemberships)
    .innerJoin(users, eq(organizationMemberships.userId, users.id))
    .innerJoin(userContactPreferences, eq(userContactPreferences.userId, users.id))
    .where(
      and(
        eq(organizationMemberships.organizationId, organizationId),
        eq(organizationMemberships.status, "Active"),
      ),
    );
  return rows.filter(
    (row) =>
      row.user.accountStatus === "Active" &&
      row.optIn === "Yes" &&
      normalizeIndianMobile(row.phone) &&
      [...LEADERS, ...SITE_MANAGERS].includes(row.role),
  );
}

/**
 * Sends today's summary for every company, once (an audit row per company and day is written
 * first, so a restart or a second server never sends it twice).
 */
export async function sendDailySummaries(now = new Date()) {
  const db = await getDb();
  if (!db) return { companies: 0, sent: 0 };
  const { date } = istClock(now);
  const companies = await db.selectDistinct({ organizationId: sites.organizationId }).from(sites);
  let sent = 0;
  for (const { organizationId } of companies) {
    const marker = `daily_summary:${date}`;
    const [done] = await db
      .select({ id: auditEvents.id })
      .from(auditEvents)
      .where(
        and(
          eq(auditEvents.action, "daily_summary.sent"),
          eq(auditEvents.entityType, marker),
          eq(auditEvents.entityId, organizationId),
        ),
      )
      .limit(1);
    if (done) continue;
    const list = await recipients(db, organizationId);
    const [leader] = await db
      .select({ userId: organizationMemberships.userId })
      .from(organizationMemberships)
      .where(
        and(
          eq(organizationMemberships.organizationId, organizationId),
          inArray(organizationMemberships.businessRole, ["owner", "director", "admin"]),
        ),
      )
      .limit(1);
    if (!leader) continue;
    await db.insert(auditEvents).values({
      id: randomUUID(),
      organizationId,
      actorUserId: leader.userId,
      action: "daily_summary.sent",
      entityType: marker,
      entityId: organizationId,
      afterSummary: JSON.stringify({ recipients: list.length }),
    });
    for (const person of list) {
      const text = await summaryFor(db, person.user, date).catch(() => null);
      if (!text) continue;
      const ok = await sendWhatsAppText(normalizeIndianMobile(person.phone)!, text).catch(
        () => false,
      );
      if (ok) sent += 1;
    }
  }
  return { companies: companies.length, sent };
}

let lastSentDate: string | null = null;

/** Checks every minute; sends at 11 PM India time. Off with DAILY_SUMMARY=off. */
export function startDailySummaryScheduler() {
  if (process.env.DAILY_SUMMARY === "off") return;
  const tick = () => {
    const now = new Date();
    if (!summaryDue(now, lastSentDate)) return;
    lastSentDate = istClock(now).date;
    void sendDailySummaries(now)
      .then((result) => console.log(`[summary] ${lastSentDate}: sent ${result.sent}`))
      .catch((error) =>
        console.error("[summary] failed", error instanceof Error ? error.message : error),
      );
  };
  setInterval(tick, 60_000).unref?.();
}

export const dailySummaryRouter = router({
  /** Today's summary (so far) for me, as text: the same as the 11 PM WhatsApp message. */
  today: protectedProcedure.query(async ({ ctx }) => {
    const db = await getDb();
    if (!db)
      throw new TRPCError({
        code: "PRECONDITION_FAILED",
        message: "The business data service is temporarily unavailable.",
      });
    const { date } = istClock(new Date());
    const text = await summaryFor(db, ctx.user, date);
    return { date, text };
  }),
});
