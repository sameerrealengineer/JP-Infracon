import { and, countDistinct, count, eq, ne } from "drizzle-orm";
import {
  attendanceRecords,
  dailyReports,
  materialRequests,
  organizationSettings,
  people,
  pettyCashMovements,
  sites,
  supplierInvoices,
  supplierPayments,
  workOrders,
} from "../../drizzle/schema";
import { getDb } from "../db";
import { defaultDisabledModules, parseDisabledModules, type ModuleKey } from "../../lib/jp/modules";
import {
  journeyLevel,
  lockedByJourney,
  parseJourney,
  type JourneyCounts,
  type JourneyState,
} from "../../lib/jp/journey";

/**
 * Which modules each company has turned off, cached briefly so every permission check does not
 * read the database. A change clears the company's entry at once on this server.
 * Off = the company's own choice (or the A-Class default) plus, in step-by-step mode, the steps
 * not reached yet (lib/jp/journey.ts), less anything a leader opened early.
 */
type Entry = {
  at: number;
  disabled: ModuleKey[];
  journey: JourneyState;
  level: number;
  counts: JourneyCounts | null;
};
const cache = new Map<string, Entry>();
const TTL_MS = 30_000;

/** Set only by the seed runner (its own process): sample data covers every module. */
let allOnWhileSeeding = false;

export async function withAllModulesOn<T>(work: () => Promise<T>): Promise<T> {
  allOnWhileSeeding = true;
  try {
    return await work();
  } finally {
    allOnWhileSeeding = false;
  }
}

type Db = NonNullable<Awaited<ReturnType<typeof getDb>>>;

async function safeCount(query: Promise<{ n: number | string }[]>) {
  try {
    const [row] = await query;
    return Number(row?.n ?? 0);
  } catch {
    return 0;
  }
}

/** Real records that move the company along the steps. */
export async function journeyCounts(db: Db, organizationId: string): Promise<JourneyCounts> {
  const org = organizationId;
  const [sitesN, workers, attendanceDays, dprs, invoices, payments, cash, requests, orders] =
    await Promise.all([
      safeCount(db.select({ n: count() }).from(sites).where(eq(sites.organizationId, org))),
      safeCount(db.select({ n: count() }).from(people).where(eq(people.organizationId, org))),
      safeCount(
        db
          .select({ n: countDistinct(attendanceRecords.workDate) })
          .from(attendanceRecords)
          .where(eq(attendanceRecords.organizationId, org)),
      ),
      safeCount(
        db
          .select({ n: count() })
          .from(dailyReports)
          .where(
            and(
              eq(dailyReports.organizationId, org),
              eq(dailyReports.reportKind, "DPR"),
              ne(dailyReports.status, "Draft"),
            ),
          ),
      ),
      safeCount(
        db
          .select({ n: count() })
          .from(supplierInvoices)
          .where(eq(supplierInvoices.organizationId, org)),
      ),
      safeCount(
        db
          .select({ n: count() })
          .from(supplierPayments)
          .where(eq(supplierPayments.organizationId, org)),
      ),
      safeCount(
        db
          .select({ n: count() })
          .from(pettyCashMovements)
          .where(eq(pettyCashMovements.organizationId, org)),
      ),
      safeCount(
        db
          .select({ n: count() })
          .from(materialRequests)
          .where(eq(materialRequests.organizationId, org)),
      ),
      safeCount(
        db.select({ n: count() }).from(workOrders).where(eq(workOrders.organizationId, org)),
      ),
    ]);
  return {
    sites: sitesN,
    workers,
    attendanceDays,
    dprs,
    moneyEntries: invoices + payments + cash,
    materialRequests: requests,
    workOrders: orders,
  };
}

async function load(organizationId: string): Promise<Entry> {
  const hit = cache.get(organizationId);
  if (hit && Date.now() - hit.at < TTL_MS) return hit;
  const db = await getDb();
  const empty: Entry = {
    at: Date.now(),
    disabled: [],
    journey: { mode: "all", early: [] },
    level: 1,
    counts: null,
  };
  if (!db) return empty;
  let entry = empty;
  try {
    let row: { disabledModules: string | null; journeyState: string | null } | undefined;
    try {
      [row] = await db
        .select({
          disabledModules: organizationSettings.disabledModules,
          journeyState: organizationSettings.journeyState,
        })
        .from(organizationSettings)
        .where(eq(organizationSettings.organizationId, organizationId))
        .limit(1);
    } catch {
      // Before migration 0037 there is no journey column: read the module choice alone.
      const [old] = await db
        .select({ disabledModules: organizationSettings.disabledModules })
        .from(organizationSettings)
        .where(eq(organizationSettings.organizationId, organizationId))
        .limit(1);
      row = old
        ? { disabledModules: old.disabledModules, journeyState: '{"mode":"all"}' }
        : undefined;
    }
    // A company that never saved its own choice starts with the A-Class set.
    const chosen =
      row?.disabledModules == null
        ? defaultDisabledModules()
        : parseDisabledModules(row.disabledModules);
    const journey = parseJourney(row?.journeyState);
    let level = 1;
    let counts: JourneyCounts | null = null;
    let locked: ModuleKey[] = [];
    if (journey.mode === "guided") {
      counts = await journeyCounts(db, organizationId);
      level = journeyLevel(counts);
      locked = lockedByJourney(level, journey);
    }
    entry = {
      at: Date.now(),
      disabled: [...new Set([...chosen, ...locked])],
      journey,
      level,
      counts,
    };
  } catch {
    // Before the settings table exists every module stays on.
    entry = empty;
  }
  cache.set(organizationId, entry);
  return entry;
}

export async function disabledModulesFor(organizationId: string): Promise<ModuleKey[]> {
  if (allOnWhileSeeding) return [];
  return (await load(organizationId)).disabled;
}

/** Step-by-step state for the progress card and the Modules screen. */
export async function journeyFor(organizationId: string) {
  return load(organizationId);
}

export function forgetModuleSettings(organizationId: string) {
  cache.delete(organizationId);
}
