/**
 * Start data, round 4: one SAMPLE login for every other role, and work done by each of them,
 * so the client sees every role's screens with records in them; plus leave applications and
 * returns to suppliers. All of it is SAMPLE (listed for one-step removal by the caller).
 */
import { randomUUID } from "node:crypto";
import { and, eq, inArray, like } from "drizzle-orm";
import {
  dailyReports,
  inventoryMovements,
  materialItems,
  projectBudgets,
  projects,
  sites,
  subcontractBills,
  vendors,
} from "../../drizzle/schema";
import type { SeedCaller } from "./client-data";

const S = "SAMPLE · ";
const id = () => `seed-${randomUUID()}`;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Db = any;

function dayFrom(today: string, offset: number): string {
  const date = new Date(`${today}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + offset);
  return date.toISOString().slice(0, 10);
}

export async function seedRolesAndRequests(ctx: {
  db: Db;
  boss: SeedCaller;
  sipun: SeedCaller;
  acc: SeedCaller;
  callerFor: (userId: number) => Promise<SeedCaller>;
  today: string;
}) {
  const { db, boss, sipun, acc, callerFor, today } = ctx;
  const day = (offset: number) => dayFrom(today, offset);
  const [company] = await boss.jp.accounts.options();
  const organizationId = company!.id;
  const tankSites = await db
    .select({ id: sites.id, code: sites.siteCode })
    .from(sites)
    .where(like(sites.siteCode, "SHG-OHT%"));
  const tankIds = tankSites
    .sort((a: { code: string }, b: { code: string }) => a.code.localeCompare(b.code))
    .map((row: { id: string }) => row.id);
  const first = tankIds[0]!;

  // ── One login per role (SAMPLE) ───────────────────────────────────────────────────────────
  const logins: { name: string; role: string; username: string; temporaryPassword: string }[] = [];
  const made: Record<string, SeedCaller> = {};
  for (const [role, name, username, siteIds] of [
    ["director", "Director (Sample)", "director.sample", []],
    ["admin", "Admin (Sample)", "admin.sample", []],
    ["project_manager", "Project Manager (Sample)", "pm.sample", tankIds],
    ["site_engineer", "Site Engineer (Sample)", "engineer.sample", tankIds],
    ["storekeeper", "Storekeeper (Sample)", "store.sample", [first]],
    ["auditor", "Auditor (Sample)", "auditor.sample", tankIds],
  ] as const) {
    const account = await boss.jp.accounts.create({
      organizationId,
      displayName: name,
      username,
      businessRole: role,
      siteIds: [...siteIds],
    });
    logins.push({
      name,
      role,
      username: account.username,
      temporaryPassword: account.temporaryPassword,
    });
    made[role] = await callerFor(account.userId);
  }
  const director = made.director!;
  const pm = made.project_manager!;
  const engineer = made.site_engineer!;
  const store = made.storekeeper!;

  // Director approves the proposed budgets (a second leader, as the rules ask).
  const proposed = await db
    .select({ id: projectBudgets.id })
    .from(projectBudgets)
    .innerJoin(projects, eq(projectBudgets.projectId, projects.id))
    // A completed project takes no new approvals; only running projects' budgets.
    .where(and(eq(projectBudgets.status, "Proposed"), eq(projects.status, "Active")));
  for (const budget of proposed)
    await director.jp.budgets.review({
      budgetId: budget.id,
      decision: "Approve",
      reason: "Checked against the contract value",
      clientMutationId: id(),
    });

  // Site Engineer reviews the tank daily reports.
  const waiting = await db
    .select({ id: dailyReports.id })
    .from(dailyReports)
    .where(and(inArray(dailyReports.siteId, tankIds), eq(dailyReports.status, "Submitted")));
  for (const report of waiting)
    await engineer.jp.reports.review({ reportId: report.id, decision: "Approved" });

  // Project Manager approves Rabindra's tank RA bill.
  const bills = await db
    .select({ id: subcontractBills.id, siteId: subcontractBills.siteId })
    .from(subcontractBills)
    .where(
      and(inArray(subcontractBills.siteId, tankIds), eq(subcontractBills.status, "Submitted")),
    );
  for (const bill of bills)
    await pm.jp.subcontract.billTransition({
      siteId: bill.siteId,
      billId: bill.id,
      action: "approve",
      clientMutationId: id(),
    });

  // Storekeeper issues paint for OHT-04; the Project Manager posts it.
  const [weather] = await db
    .select({ id: materialItems.id })
    .from(materialItems)
    .where(eq(materialItems.itemCode, "PNT-EXT-WC"))
    .limit(1);
  if (weather) {
    const issued = await store.jp.inventory.submitMovement({
      siteId: first,
      materialItemId: weather.id,
      movementType: "Issue/Consumption",
      quantity: "40",
      reason: `${S}Weather coat issued for OHT-04`,
      clientMutationId: id(),
    });
    await pm.jp.inventory.reviewMovement({
      movementId: issued.id,
      decision: "Post",
      clientMutationId: id(),
    });
  }

  // ── Leave ─────────────────────────────────────────────────────────────────────────────────
  const people = (await boss.jp.people.search({ query: "" })).people;
  const person = (name: string) => people.find((row) => row.fullName.startsWith(name))!.id;
  await sipun.jp.leave.request({
    siteId: first,
    leaveType: "Casual",
    fromDate: day(5),
    toDate: day(6),
    halfDay: false,
    reason: `${S}Family function at home`,
    clientMutationId: id(),
  });
  const musha = await sipun.jp.leave.request({
    siteId: tankIds[3]!,
    personId: person("Musha"),
    leaveType: "Sick",
    fromDate: day(-2),
    toDate: day(-2),
    halfDay: false,
    reason: `${S}Fever`,
    clientMutationId: id(),
  });
  await pm.jp.leave.review({ leaveId: musha.id, decision: "Approved", note: "Get well soon" });
  await sipun.jp.leave.request({
    siteId: tankIds[3]!,
    personId: person("Rabindra"),
    leaveType: "Casual",
    fromDate: day(9),
    toDate: day(9),
    halfDay: true,
    reason: `${S}Bank work in Berhampur`,
    clientMutationId: id(),
  });

  // ── Returns to suppliers ──────────────────────────────────────────────────────────────────
  const [valve] = await db
    .select({ id: materialItems.id })
    .from(materialItems)
    .where(eq(materialItems.itemCode, "VLV-SL-100"))
    .limit(1);
  const [bhagabati] = await db
    .select({ id: vendors.id })
    .from(vendors)
    .where(eq(vendors.legalName, "Bhagabati Enterprises"))
    .limit(1);
  const back = await acc.jp.purchaseReturns.create({
    siteId: first,
    vendorId: bhagabati.id,
    returnDate: day(-6),
    reason: `${S}2 sluice valves leaking at the gland on arrival`,
    lines: [
      {
        materialItemId: valve?.id ?? null,
        description: "Sluice valve 100 mm, CI, PN10",
        unitCode: "nos",
        quantity: "2",
        rateRupees: "6900",
      },
    ],
    clientMutationId: id(),
  });
  // Goods received against orders wait in the store; post them so the stock is there to return.
  const received = await db
    .select({ id: inventoryMovements.id })
    .from(inventoryMovements)
    .where(
      and(
        eq(inventoryMovements.siteId, first),
        eq(inventoryMovements.status, "Submitted"),
        eq(inventoryMovements.movementType, "Receipt/Inward"),
      ),
    );
  for (const movement of received)
    await pm.jp.inventory.reviewMovement({
      movementId: movement.id,
      decision: "Post",
      clientMutationId: id(),
    });
  await boss.jp.purchaseReturns.review({ returnId: back.id, decision: "Approve" });
  // The store posts the stock going out.
  const outgoing = await db
    .select({ id: inventoryMovements.id })
    .from(inventoryMovements)
    .where(
      and(
        eq(inventoryMovements.sourceReference, back.returnNumber),
        eq(inventoryMovements.status, "Submitted"),
      ),
    );
  for (const movement of outgoing)
    await pm.jp.inventory.reviewMovement({
      movementId: movement.id,
      decision: "Post",
      clientMutationId: id(),
    });
  await acc.jp.purchaseReturns.settle({
    returnId: back.id,
    settlement: "Credit note",
    amountRupees: "13800",
    reference: "SAMPLE-CN-0007",
    settledOn: day(-2),
  });
  await acc.jp.purchaseReturns.create({
    siteId: first,
    vendorId: bhagabati.id,
    returnDate: day(-1),
    reason: `${S}Extra primer left after OHT-03`,
    lines: [
      {
        description: "Red oxide primer, 20 litre tin",
        unitCode: "tin",
        quantity: "1",
        rateRupees: "3150",
      },
    ],
    clientMutationId: id(),
  });

  return { logins };
}
