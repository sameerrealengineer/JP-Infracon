/**
 * The second round of start data, through the real procedures:
 *
 * 1. Kalyan Mandap, Aska, completed A to Z: every task done, daily reports reviewed, issue
 *    closed, store, UPVC delivered and billed, all bills paid, final RA bills, both contractors'
 *    work measured, billed and closed with retention released, payroll paid, handover papers,
 *    then the site and project are marked Completed (real: the client says it is complete).
 * 2. Rural Water Supply O&M, Sheragada Block (real, from jpinfracon.com: RWS & S Berhampur,
 *    9 villages, 5-year maintenance) with its current work: repainting and renovating 10
 *    overhead tanks, one site per tank.
 *
 * Everything except the project, its sites and the completion is SAMPLE and is listed for
 * one-step removal (see sample-registry.ts).
 */
import { randomUUID } from "node:crypto";
import type { SeedCaller } from "./client-data";
import { simplePdf } from "./client-data";

const S = "SAMPLE · ";
const id = () => `seed-${randomUUID()}`;

function dayFrom(today: string, offset: number): string {
  const date = new Date(`${today}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + offset);
  return date.toISOString().slice(0, 10);
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const rowsOf = (value: any): any[] => value?.items ?? value?.rows ?? value?.runs ?? value ?? [];

export const SHERAGADA_PROJECT_CODE = "SHG-RWS";
export const OHT_COUNT = 10;

export type MoreContext = {
  boss: SeedCaller;
  sipun: SeedCaller;
  acc: SeedCaller;
  organizationId: string;
  sipunUserId: number;
  accountsUserId: number;
  today: string;
};

/** Real part 1: the Sheragada project and its 10 tank sites. Returns their ids. */
export async function createSheragada(ctx: MoreContext) {
  const { boss, organizationId } = ctx;
  const projectId = (
    await boss.jp.sitesAdmin.createProject({
      organizationId,
      projectCode: SHERAGADA_PROJECT_CODE,
      name: "Rural Water Supply O&M, Sheragada Block",
      clientDepartment: "RWS & S Division, Berhampur",
      projectType: "Water supply operation and maintenance",
      startDate: "2023-04-01",
      targetEndDate: "2028-03-31",
      clientMutationId: id(),
    })
  ).id;
  const siteIds: string[] = [];
  for (let n = 1; n <= OHT_COUNT; n += 1) {
    const code = String(n).padStart(2, "0");
    siteIds.push(
      (
        await boss.jp.sitesAdmin.createSite({
          projectId,
          siteCode: `SHG-OHT${code}`,
          name: `Sheragada OHT-${code}`,
          address: `Overhead tank ${code}, Sheragada Block, Ganjam, Odisha (village to be named)`,
          district: "Ganjam",
          state: "Odisha",
          clientMutationId: id(),
        })
      ).id,
    );
  }
  return { projectId, siteIds };
}

/** SAMPLE: finish every open item of Kalyan Mandap, A to Z. */
export async function completeKalyanMandap(
  ctx: MoreContext,
  ids: { projectId: string; siteId: string },
) {
  const { boss, sipun, acc, today } = ctx;
  const { projectId, siteId } = ids;
  const day = (offset: number) => dayFrom(today, offset);

  // Tasks: everything in progress, then completed.
  for (const task of rowsOf(await boss.jp.tasks.list({ siteId }))) {
    if (task.status === "Completed") continue;
    if (task.status !== "In Progress")
      await sipun.jp.tasks.updateStatus({
        taskId: task.id,
        status: "In Progress",
        clientMutationId: id(),
      });
    await sipun.jp.tasks.updateStatus({
      taskId: task.id,
      status: "Completed",
      clientMutationId: id(),
    });
  }

  // Reports: review the waiting DPR, submit the draft DLR, add a run of daily reports.
  for (const report of rowsOf(await boss.jp.reports.list({ siteId }))) {
    if (report.status === "Draft") await sipun.jp.reports.submit({ reportId: report.id });
  }
  const dailyWork = [
    [-12, "First floor slab reinforcement", "Slab reinforcement tied and checked."],
    [-10, "First floor slab concreting", "Slab cast with 52 cum M20; curing started."],
    [-8, "Ground floor brickwork", "Pahalad crew on outer walls."],
    [-6, "Plaster and electrical conduits", "Conduits fixed before plaster."],
    [-4, "UPVC doors and windows fixed", "Rajdhani UPVC team fixed 24 windows and 8 doors."],
    [-3, "Painting first coat", "Rabindra crew on interior putty and primer."],
    [-2, "Pump and electrical testing", "Pump run for 2 hours; all points tested."],
  ] as const;
  for (const [offset, title, remarks] of dailyWork) {
    const draft = await sipun.jp.reports.createDraft({
      siteId,
      reportKind: "DPR",
      reportDate: day(offset),
      title: `${S}${title}`,
      remarks,
      weatherCode: "Clear",
      overallStatus: "On track",
      clientMutationId: id(),
    });
    await sipun.jp.reports.submit({ reportId: draft.id });
  }
  for (const report of rowsOf(await boss.jp.reports.list({ siteId })))
    if (report.status === "Submitted")
      await boss.jp.reports.review({ reportId: report.id, decision: "Approved" });

  // Attendance waiting today: approve.
  await boss.jp.attendance.approve({
    siteId,
    workDate: day(0),
    shiftCode: "GEN",
    overtime: "approve",
    clientMutationId: id(),
  });

  // Material request approved; issue fixed and closed.
  for (const request of rowsOf(await boss.jp.materialRequests.list({ siteId })))
    if (request.status === "Submitted")
      await boss.jp.materialRequests.review({ requestId: request.id, decision: "Approved" });
  for (const issue of rowsOf(await boss.jp.issues.list({ siteId }))) {
    if (issue.status !== "Open" && issue.status !== "Assigned") continue;
    await sipun.jp.issues.transition({
      issueId: issue.id,
      action: "start",
      clientMutationId: id(),
    });
    await sipun.jp.issues.transition({
      issueId: issue.id,
      action: "resolve",
      correctiveAction: "Toe boards fitted on all scaffolding levels.",
      preventiveAction: "Daily scaffold checklist before work starts.",
      clientMutationId: id(),
    });
    await boss.jp.issues.transition({
      issueId: issue.id,
      action: "close",
      note: "Checked at site.",
      clientMutationId: id(),
    });
  }

  // Store: wastage and a return.
  const items = (await boss.jp.inventory.list({ siteId })).catalogue;
  const cement = items.find((row) => row.itemCode === "CEM-PPC");
  if (cement) {
    const back = await sipun.jp.inventory.submitMovement({
      siteId,
      materialItemId: cement.id,
      movementType: "Return to Store",
      quantity: "5",
      reason: `${S}Unused bags returned after casting`,
      clientMutationId: id(),
    });
    await boss.jp.inventory.reviewMovement({
      movementId: back.id,
      decision: "Post",
      clientMutationId: id(),
    });
    const waste = await sipun.jp.inventory.submitMovement({
      siteId,
      materialItemId: cement.id,
      movementType: "Wastage",
      quantity: "3",
      reason: `${S}Bags set hard in rain`,
      clientMutationId: id(),
    });
    await boss.jp.inventory.reviewMovement({
      movementId: waste.id,
      decision: "Post",
      clientMutationId: id(),
    });
  }

  // UPVC order delivered in full.
  for (const po of rowsOf(await boss.jp.purchase.list({ siteId }))) {
    if (po.status !== "Approved") continue;
    const detail = await sipun.jp.purchase.detail({ siteId, poId: po.id });
    await sipun.jp.purchase.receive({
      siteId,
      poId: po.id,
      receivedOn: day(-5),
      challanNumber: "SAMPLE-RU-DC-118",
      vehicleNumber: "OD07 SAMPLE",
      lines: detail.lines.map(
        (line: { id: string; quantityThousandths: string; receivedThousandths: string }) => ({
          poLineId: line.id,
          accepted: String(
            (Number(line.quantityThousandths) - Number(line.receivedThousandths)) / 1000,
          ),
        }),
      ),
      clientMutationId: id(),
    });
  }

  // Supplier bills: Rajdhani UPVC and Bhagabati's pump, approved and paid in full.
  const vendors = rowsOf(await boss.jp.finance.listVendors({ siteId }));
  const vendorId = (name: string) => vendors.find((row) => row.legalName === name)!.id as string;
  const payBill = async (
    vendor: string,
    invoiceNumber: string,
    description: string,
    quantity: string,
    unitCode: string,
    lineTotalRupees: string,
    taxRupees: string,
    paidRupees: string,
  ) => {
    const bill = await sipun.jp.finance.createInvoice({
      siteId,
      vendorId: vendorId(vendor),
      invoiceNumber,
      invoiceDate: day(-5),
      dueDate: day(10),
      taxRupees,
      chargesRupees: "0",
      items: [{ description, quantity, unitCode, lineTotalRupees }],
      action: "Submitted",
      clientMutationId: id(),
    });
    await boss.jp.finance.reviewInvoice({
      siteId,
      invoiceId: bill.id,
      decision: "Approved",
      clientMutationId: id(),
    });
    const payment = await acc.jp.finance.payments.createPayment({
      siteId,
      vendorId: vendorId(vendor),
      paymentDate: day(-1),
      amountRupees: paidRupees,
      paymentMode: "Bank Transfer",
      paidByName: "JP Infracon accounts",
      fundingSourceLabel: "Current account",
      category: "Material",
      purpose: `${S}Full payment for ${invoiceNumber}`,
      externalReference: `SAMPLE-UTR-${invoiceNumber.slice(-4)}`,
      allocations: [{ invoiceId: bill.id, amountRupees: paidRupees }],
      clientMutationId: id(),
    });
    await acc.jp.finance.payments.submitPayment({
      siteId,
      paymentId: payment.id,
      clientMutationId: id(),
    });
  };
  await payBill(
    "Rajdhani UPVC",
    "SAMPLE-RU-0118",
    "UPVC windows (24) and doors (8), supplied and fixed",
    "1",
    "lot",
    "351200",
    "63216",
    "414416",
  );
  await payBill(
    "Bhagabati Enterprises",
    "SAMPLE-BE-0477",
    "Submersible pump 1.5 HP with starter panel",
    "1",
    "nos",
    "52000",
    "9360",
    "61360",
  );
  // Approve and post every waiting payment.
  for (const payment of rowsOf(await boss.jp.finance.payments.listPayments({ siteId }))) {
    if (payment.status !== "Submitted") continue;
    await boss.jp.finance.payments.reviewPayment({
      siteId,
      paymentId: payment.id,
      decision: "Approved",
      reason: "Matches the approved bill",
      clientMutationId: id(),
    });
    await boss.jp.finance.payments.postPayment({
      siteId,
      paymentId: payment.id,
      clientMutationId: id(),
    });
  }
  // The rest of Bhagabati's first bill.
  const firstBill = rowsOf(await boss.jp.finance.listInvoices({ siteId })).find(
    (row) => row.invoiceNumber === "SAMPLE-BE-0451",
  );
  if (firstBill) {
    const rest = await acc.jp.finance.payments.createPayment({
      siteId,
      vendorId: vendorId("Bhagabati Enterprises"),
      paymentDate: day(0),
      amountRupees: "27820",
      paymentMode: "UPI",
      paidByName: "JP Infracon accounts",
      fundingSourceLabel: "Current account",
      category: "Material",
      purpose: `${S}Balance of bill SAMPLE-BE-0451`,
      externalReference: "SAMPLE-UPI-0002",
      allocations: [{ invoiceId: firstBill.id, amountRupees: "27820" }],
      clientMutationId: id(),
    });
    await acc.jp.finance.payments.submitPayment({
      siteId,
      paymentId: rest.id,
      clientMutationId: id(),
    });
    await boss.jp.finance.payments.reviewPayment({
      siteId,
      paymentId: rest.id,
      decision: "Approved",
      reason: "Balance of the approved bill",
      clientMutationId: id(),
    });
    await boss.jp.finance.payments.postPayment({
      siteId,
      paymentId: rest.id,
      clientMutationId: id(),
    });
  }

  // Petty cash: approve and post the waiting expense; one more, then the cash returned.
  const fund = rowsOf(await boss.jp.finance.pettyCash.listFunds({ siteId }))[0];
  if (fund) {
    for (const movement of rowsOf(
      await boss.jp.finance.pettyCash.listMovements({ siteId, fundId: fund.id }),
    )) {
      if (movement.status !== "Submitted") continue;
      await boss.jp.finance.pettyCash.reviewMovement({
        siteId,
        movementId: movement.id,
        decision: "Approved",
        reason: "Bill seen",
        clientMutationId: id(),
      });
      await boss.jp.finance.pettyCash.postMovement({
        siteId,
        movementId: movement.id,
        clientMutationId: id(),
      });
    }
  }

  // Contractors: Pahalad's last measurement and final bill; Rabindra's painting approved,
  // measured and billed; both closed with retention released.
  const wos = rowsOf(await boss.jp.subcontract.list({ siteId }));
  const masonry = wos.find((row) => row.title.includes("Brickwork"));
  const planned = wos.find((row) => row.title.includes("Painting"));
  // The first painting order was dated for later; painting was done earlier, so it is replaced.
  if (planned && planned.status !== "Cancelled")
    await acc.jp.subcontract.transition({
      siteId,
      woId: planned.id,
      action: "cancel",
      reason: "Replaced by the order with the actual painting dates",
      clientMutationId: id(),
    });
  const vendorsNow = rowsOf(await boss.jp.finance.listVendors({ siteId }));
  const painting = await acc.jp.subcontract.create({
    siteId,
    vendorId: vendorsNow.find((row) => row.legalName.startsWith("Rabindra"))!.id,
    title: `${S}Painting inside and outside (actual)`,
    scope: "Labour for putty, primer and two coats; paint from JP Infracon.",
    startDate: day(-12),
    endDate: day(-2),
    gstPercent: "0",
    retentionPercent: "5",
    tdsPercent: "1",
    items: [
      {
        itemCode: "P1",
        description: "Interior putty, primer and two coats emulsion (labour)",
        unit: "sqm",
        quantity: "3600",
        rateRupees: "32",
      },
      {
        itemCode: "P2",
        description: "Exterior primer and two coats weather coat (labour)",
        unit: "sqm",
        quantity: "1450",
        rateRupees: "38",
      },
    ],
    clientMutationId: id(),
  });
  await acc.jp.subcontract.transition({
    siteId,
    woId: painting.id,
    action: "submit",
    clientMutationId: id(),
  });
  await boss.jp.subcontract.transition({
    siteId,
    woId: painting.id,
    action: "approve",
    clientMutationId: id(),
  });
  const measureAndBill = async (
    woId: string,
    lines: {
      itemCode: string;
      location: string;
      length: string;
      breadth?: string;
      depth: string;
    }[],
  ) => {
    const detail = await sipun.jp.subcontract.detail({ siteId, woId });
    const measured: string[] = [];
    for (const line of lines) {
      const itemId = detail.items.find(
        (row: { itemCode: string }) => row.itemCode === line.itemCode,
      )!.id;
      const made = await sipun.jp.subcontract.measure({
        siteId,
        woId,
        itemId,
        measuredOn: day(-3),
        location: line.location,
        nos: "1",
        length: line.length,
        breadth: line.breadth,
        depth: line.depth,
        clientMutationId: id(),
      });
      measured.push(made.id);
    }
    await boss.jp.subcontract.checkMeasurement({
      siteId,
      measurementIds: measured,
      action: "check",
      clientMutationId: id(),
    });
    const bill = await acc.jp.subcontract.createBill({
      siteId,
      woId,
      billDate: day(-1),
      periodTo: day(-2),
      submit: true,
      clientMutationId: id(),
    });
    await boss.jp.subcontract.billTransition({
      siteId,
      billId: bill.id,
      action: "approve",
      clientMutationId: id(),
    });
    await boss.jp.subcontract.transition({
      siteId,
      woId,
      action: "close",
      reason: "All work measured, billed and handed over",
      clientMutationId: id(),
    });
    await boss.jp.subcontract.releaseRetention({
      siteId,
      woId,
      reason: "Work handed over without defects",
      clientMutationId: id(),
    });
  };
  if (masonry)
    await measureAndBill(masonry.id, [
      {
        itemCode: "M1",
        location: "Ground floor inner walls",
        length: "58",
        breadth: "0.23",
        depth: "3",
      },
      { itemCode: "M2", location: "Ground floor, all rooms", length: "180", depth: "3" },
    ]);
  await measureAndBill(painting.id, [
    { itemCode: "P1", location: "Inside, all rooms", length: "300", depth: "3.4" },
    { itemCode: "P2", location: "Outside, all faces", length: "96", depth: "7.2" },
  ]);

  // Client billing: second and final RA bills, everything received.
  const contract = await acc.jp.billing.contract.get({ projectId });
  const remaining = contract.items
    .filter((row) => row.status === "Active" && BigInt(row.balanceThousandths) > 0n)
    .map((row) => ({
      contractItemId: row.id,
      quantity: String(Number(row.balanceThousandths) / 1000),
    }));
  const half = Math.ceil(remaining.length / 2);
  for (const [index, lines] of [remaining.slice(0, half), remaining.slice(half)].entries()) {
    if (!lines.length) continue;
    const bill = await acc.jp.billing.bills.create({
      projectId,
      billDate: day(index === 0 ? -10 : -1),
      periodFrom: day(index === 0 ? -20 : -9),
      periodTo: day(index === 0 ? -11 : -2),
      lines,
      clientMutationId: id(),
    });
    await acc.jp.billing.bills.transition({
      billId: bill.id,
      action: "submit",
      clientMutationId: id(),
    });
    await boss.jp.billing.bills.transition({
      billId: bill.id,
      action: "approve",
      clientMutationId: id(),
    });
  }
  for (const bill of rowsOf(await boss.jp.billing.bills.list({ projectId }))) {
    const due = BigInt(bill.netReceivableMinor) - BigInt(bill.receivedMinor ?? "0");
    if (due <= 0n) continue;
    await acc.jp.billing.receipts.record({
      billId: bill.id,
      amountRupees: `${due / 100n}.${String(due % 100n).padStart(2, "0")}`,
      receivedOn: day(0),
      mode: "Bank transfer",
      reference: `SAMPLE-NEFT-${bill.billNumber.slice(-2)}`,
      clientMutationId: id(),
    });
  }

  // Payroll: last month's run paid.
  for (const run of rowsOf(await boss.jp.payroll.runs({ siteId })))
    if (run.status === "Approved")
      await acc.jp.payroll.markPaid({
        siteId,
        runId: run.id,
        paidOn: day(0),
        mode: "Bank transfer",
        reference: "SAMPLE-PAY-1001",
        clientMutationId: id(),
      });

  // Handover papers.
  const papers: [string, string, string, string[]][] = [
    [
      "Completion certificates",
      "Completion certificate",
      "sample-completion-certificate.pdf",
      [
        "Certified that the G+1 Govt Kalyan Mandap at Pakalapoli, Aska is complete",
        "as per the agreement, drawings and specifications.",
        "",
        "Contractor: JP Infracon",
        "Engineer-in-charge: (name and signature)",
        "Date: ____________",
      ],
    ],
    [
      "Agreements and work orders",
      "Handover and taking over note",
      "sample-handover-note.pdf",
      [
        "Building, keys (32 doors), pump and electrical panel handed over.",
        "Defect liability period: 12 months from handover.",
        "Warranties: UPVC (Rajdhani UPVC) 10 years; pump (Bhagabati) 2 years.",
      ],
    ],
    [
      "Measurements",
      "Final measurement abstract",
      "sample-final-measurement.pdf",
      [
        "Earthwork 420 cum; PCC 38 cum; RCC 265 cum; steel 31.5 MT;",
        "Brickwork 310 cum; plaster 2850 sqm; tiles 780 sqm; UPVC 145 sqm;",
        "Painting 3600 + 1450 sqm; electrical 260 points; pump 1 no.",
      ],
    ],
    [
      "Inspection and quality",
      "Concrete cube test results",
      "sample-cube-tests.pdf",
      [
        "M20 cubes, 28 days: 26.8, 27.4, 25.9 N/mm2 (required 20). Passed.",
        "Slab cast on the 10th: 28-day average 26.7 N/mm2. Passed.",
      ],
    ],
    [
      "Safety",
      "Site safety checklist",
      "sample-safety-checklist.pdf",
      [
        "Helmets and shoes for all workers: Yes",
        "Scaffolding with toe boards and guard rails: Yes",
        "First aid box at site office: Yes",
        "Electrical DB with ELCB: Yes",
      ],
    ],
  ];
  for (const [category, title, fileName, lines] of papers)
    await boss.jp.documents.upload({
      projectId,
      siteId,
      category: category as never,
      title: `${S}${title}`,
      tags: "kalyan mandap, handover, sample",
      fileName,
      base64: Buffer.from(
        simplePdf(`SAMPLE ${title} - Kalyan Mandap, Aska`, lines),
        "latin1",
      ).toString("base64"),
      clientMutationId: id(),
    });

  // Budget: proposed by accounts, approved by the Super Admin.
  // Proposed here; a second leader (Owner/Director) approves it.
  await boss.jp.budgets.propose({
    projectId,
    contractValueMinor: "15500000000",
    lines: [
      {
        costHead: "Materials",
        amountMinor: "8200000000",
        note: "Cement, steel, bricks, UPVC, tiles",
      },
      { costHead: "Labour", amountMinor: "1800000000", note: "Site labour and supervision" },
      { costHead: "Subcontract", amountMinor: "2900000000", note: "Masonry and painting" },
      { costHead: "Equipment and transport", amountMinor: "600000000", note: "Mixer, vehicle" },
      { costHead: "Site expenses", amountMinor: "300000000", note: "Petty cash, water, power" },
    ],
    reason: `${S}Budget at award`,
    clientMutationId: id(),
  });
}

/** SAMPLE: the current tank repainting and renovation work at Sheragada. */
export async function sheragadaWork(
  ctx: MoreContext,
  ids: { projectId: string; siteIds: string[]; people: Record<string, string> },
) {
  const { boss, sipun, acc, sipunUserId, today } = ctx;
  const { projectId, siteIds, people } = ids;
  const day = (offset: number) => dayFrom(today, offset);
  const [first] = siteIds as [string];

  // Sipun runs all ten tanks; the example accounts login keeps their books.
  for (const siteId of siteIds) {
    await boss.jp.sitesAdmin.assignMember({
      siteId,
      userId: sipunUserId,
      role: "supervisor",
      clientMutationId: id(),
    });
    await boss.jp.sitesAdmin.assignMember({
      siteId,
      userId: ctx.accountsUserId,
      role: "accounts",
      clientMutationId: id(),
    });
  }

  // Tasks per tank: three done tanks, two in progress, five waiting.
  const steps = [
    ["Drain, clean and disinfect the tank", "Cleaning", 3],
    ["Scrape old paint and repair cracks", "Repair", 3],
    ["Food-grade epoxy coating inside, 2 coats", "Painting", 4],
    ["Exterior weather coat, 2 coats", "Painting", 3],
    ["Ladder and railing repair and enamel", "Repair", 2],
    ["Replace inlet/outlet sluice valves", "Plumbing", 1],
    ["Fill, test and hand back to the village", "Commissioning", 1],
  ] as const;
  for (const [index, siteId] of siteIds.entries()) {
    let start = -45 + index * 9;
    let previous: string | undefined;
    for (const [stepIndex, [title, category, days]] of steps.entries()) {
      const task = await boss.jp.tasks.create({
        siteId,
        title: `${S}${title}`,
        workCategory: category,
        locationLabel: `OHT-${String(index + 1).padStart(2, "0")}`,
        plannedStart: day(start),
        plannedEnd: day(start + days - 1),
        priority: stepIndex === 0 ? "High" : "Normal",
        dependencies: previous ? [{ taskId: previous, lagDays: 0 }] : undefined,
        clientMutationId: id(),
      });
      start += days;
      previous = task.id;
      const done = index < 3 || (index < 5 && stepIndex < 3);
      const going = index < 5 && stepIndex === 3;
      if (done || going)
        await sipun.jp.tasks.updateStatus({
          taskId: task.id,
          status: "In Progress",
          clientMutationId: id(),
        });
      if (done)
        await sipun.jp.tasks.updateStatus({
          taskId: task.id,
          status: "Completed",
          clientMutationId: id(),
        });
    }
  }

  // Materials for all tanks, kept at OHT-01 store.
  const item = (itemCode: string, name: string, category: string, unit: string, reorder: string) =>
    boss.jp.inventory.createItem({
      siteId: first,
      itemCode,
      name,
      category,
      baseUnitCode: unit,
      reorderThreshold: reorder,
      clientMutationId: id(),
    });
  const epoxy = await item("PNT-EPX-FG", "Food-grade epoxy coating", "Paint", "litre", "40");
  const weather = await item("PNT-EXT-WC", "Exterior weather coat", "Paint", "litre", "40");
  await item("PNT-ENM", "Synthetic enamel (ladders, railings)", "Paint", "litre", "10");
  const valve = await item("VLV-SL-100", "Sluice valve 100 mm", "Plumbing", "nos", "2");

  // Paint and valves bought: valves from Bhagabati Enterprises.
  const vendors = rowsOf(await boss.jp.finance.listVendors({ siteId: first }));
  const bhagabati = vendors.find((row) => row.legalName === "Bhagabati Enterprises")!.id;
  const rabindraFirm = vendors.find((row) => row.legalName.startsWith("Rabindra"))!.id;
  const po = await acc.jp.purchase.create({
    siteId: first,
    vendorId: bhagabati,
    orderDate: day(-30),
    expectedDate: day(-25),
    terms: `${S}Delivery to OHT-01 store; payment 30 days.`,
    lines: [
      {
        materialItemId: valve.id,
        description: "Sluice valve 100 mm, CI, PN10",
        unitCode: "nos",
        quantity: "20",
        rateRupees: "6900",
        gstPercent: "18",
      },
    ],
    clientMutationId: id(),
  });
  await acc.jp.purchase.transition({
    siteId: first,
    poId: po.id,
    action: "submit",
    clientMutationId: id(),
  });
  await boss.jp.purchase.transition({
    siteId: first,
    poId: po.id,
    action: "approve",
    clientMutationId: id(),
  });
  const poDetail = await sipun.jp.purchase.detail({ siteId: first, poId: po.id });
  await sipun.jp.purchase.receive({
    siteId: first,
    poId: po.id,
    receivedOn: day(-24),
    challanNumber: "SAMPLE-BE-DC-301",
    lines: [{ poLineId: poDetail.lines[0].id, accepted: "12" }],
    clientMutationId: id(),
  });
  for (const [material, quantity, ref] of [
    [epoxy.id, "260", "SAMPLE-PAINT-INV-91"],
    [weather.id, "380", "SAMPLE-PAINT-INV-92"],
  ] as const) {
    const inward = await sipun.jp.inventory.submitMovement({
      siteId: first,
      materialItemId: material,
      movementType: "Receipt/Inward",
      quantity,
      sourceReference: ref,
      reason: "Delivered at OHT-01 store",
      clientMutationId: id(),
    });
    await boss.jp.inventory.reviewMovement({
      movementId: inward.id,
      decision: "Post",
      clientMutationId: id(),
    });
  }
  const used = await sipun.jp.inventory.submitMovement({
    siteId: first,
    materialItemId: epoxy.id,
    movementType: "Issue/Consumption",
    quantity: "128",
    reason: `${S}Inside coating, OHT-01 to OHT-03`,
    clientMutationId: id(),
  });
  await boss.jp.inventory.reviewMovement({
    movementId: used.id,
    decision: "Post",
    clientMutationId: id(),
  });

  // Painting work order to Rabindra for all ten tanks; three tanks measured and billed.
  const wo = await acc.jp.subcontract.create({
    siteId: first,
    vendorId: rabindraFirm,
    title: `${S}Repaint 10 overhead tanks, inside and outside`,
    scope: "Labour, scaffolding and tools; paint and valves from JP Infracon.",
    startDate: day(-45),
    endDate: day(45),
    gstPercent: "0",
    retentionPercent: "5",
    tdsPercent: "1",
    items: [
      {
        itemCode: "T1",
        description: "Inside epoxy coating, 2 coats (labour)",
        unit: "sqm",
        quantity: "2600",
        rateRupees: "95",
      },
      {
        itemCode: "T2",
        description: "Outside weather coat, 2 coats (labour)",
        unit: "sqm",
        quantity: "3800",
        rateRupees: "42",
      },
    ],
    clientMutationId: id(),
  });
  await acc.jp.subcontract.transition({
    siteId: first,
    woId: wo.id,
    action: "submit",
    clientMutationId: id(),
  });
  await boss.jp.subcontract.transition({
    siteId: first,
    woId: wo.id,
    action: "approve",
    clientMutationId: id(),
  });
  const woDetail = await sipun.jp.subcontract.detail({ siteId: first, woId: wo.id });
  const inside = woDetail.items.find((row: { itemCode: string }) => row.itemCode === "T1")!.id;
  const measured: string[] = [];
  for (const tank of ["01", "02", "03"]) {
    const made = await sipun.jp.subcontract.measure({
      siteId: first,
      woId: wo.id,
      itemId: inside,
      measuredOn: day(-10),
      location: `OHT-${tank} inside (wall + floor + roof)`,
      nos: "1",
      length: "86",
      depth: "3",
      clientMutationId: id(),
    });
    measured.push(made.id);
  }
  await boss.jp.subcontract.checkMeasurement({
    siteId: first,
    measurementIds: measured,
    action: "check",
    clientMutationId: id(),
  });
  await acc.jp.subcontract.createBill({
    siteId: first,
    woId: wo.id,
    billDate: day(-2),
    periodTo: day(-3),
    submit: true,
    clientMutationId: id(),
  });

  // Rates and attendance at OHT-04 and OHT-05 (the tanks in progress).
  for (const siteId of siteIds.slice(3, 5)) {
    for (const personId of [people.Rabindra!, people.Musha!])
      await sipun.jp.workforce.assignToSite({ siteId, personId, clientMutationId: id() });
    const engagements: string[] = [];
    for (const [personId, rate] of [
      [people.Rabindra, "850"],
      [people.Musha, "500"],
    ] as const) {
      const proposed = await acc.jp.workforce.proposeRate({
        siteId,
        personId,
        engagementType: "Daily wage",
        rateType: "daily",
        rateRupees: rate,
        effectiveFrom: day(-20),
        clientMutationId: id(),
      });
      await boss.jp.workforce.reviewRate({
        siteId,
        engagementId: proposed.id,
        decision: "Approve",
        reason: `${S}example rate`,
        clientMutationId: id(),
      });
      engagements.push(proposed.id);
    }
    for (const offset of [-3, -2, -1]) {
      await sipun.jp.attendance.mark({
        siteId,
        workDate: day(offset),
        shiftCode: "GEN",
        entries: engagements.map((engagementId) => ({
          engagementId,
          status: "Full Day" as const,
          regularHours: "8",
          overtimeHours: "0",
        })),
        clientMutationId: id(),
      });
      if (offset < -1)
        await boss.jp.attendance.approve({
          siteId,
          workDate: day(offset),
          shiftCode: "GEN",
          overtime: "approve",
          clientMutationId: id(),
        });
    }
  }

  // Daily reports on the tanks in progress.
  for (const [index, siteId] of siteIds.slice(3, 5).entries()) {
    const report = await sipun.jp.reports.createDraft({
      siteId,
      reportKind: "DPR",
      reportDate: day(-1),
      title: `${S}OHT-0${index + 4} outside weather coat`,
      remarks: "First coat outside done on two faces; inside epoxy cured.",
      nextDayPlan: "Second coat outside; ladder repair.",
      weatherCode: "Clear",
      overallStatus: "On track",
      clientMutationId: id(),
    });
    await sipun.jp.reports.submit({ reportId: report.id });
  }

  // Safety at height and a quality point.
  const height = await sipun.jp.issues.create({
    siteId: siteIds[3]!,
    category: "Safety Hazard",
    severity: "High",
    title: `${S}Full-body harness to be anchored before climbing`,
    description: "One painter climbed the OHT-04 ladder without anchoring the harness.",
    locationLabel: "OHT-04 ladder",
    immediateAction: "Work stopped; toolbox talk given to the crew.",
    clientMutationId: id(),
  });
  await boss.jp.issues.assign({
    issueId: height.id,
    ownerUserId: sipunUserId,
    targetDate: day(1),
    note: "Lifeline rope on every ladder before work restarts.",
    clientMutationId: id(),
  });
  await sipun.jp.issues.create({
    siteId: siteIds[1]!,
    category: "Quality Defect",
    severity: "Medium",
    title: `${S}Rust under old paint at OHT-02 inlet pipe`,
    description: "Pitting found on the inlet pipe after scraping.",
    locationLabel: "OHT-02 inlet",
    clientMutationId: id(),
  });

  // Site cash for the tank work.
  const fund = await acc.jp.finance.pettyCash.createFund({
    siteId: first,
    name: "Sheragada tank work cash",
    custodianUserId: sipunUserId,
    authorizedLimitRupees: "25000",
    reconciliationPeriod: "Weekly",
    clientMutationId: id(),
  });
  await sipun.jp.finance.pettyCash.acknowledgeFund({
    siteId: first,
    fundId: fund.id,
    clientMutationId: id(),
  });

  // Client side: RWS & S as a client, the tank work BOQ accepted, first RA bill waiting.
  const client = await boss.jp.crm.clients.create({
    name: "RWS & S Division, Berhampur",
    clientType: "Government",
    contactPerson: "Executive Engineer",
    address: "Berhampur, Ganjam, Odisha",
    clientMutationId: id(),
  });
  const boq = [
    ["1", "Cleaning and disinfection of OHT", "nos", "10", "6500"],
    ["2", "Scraping and surface preparation", "sqm", "6400", "45"],
    ["3", "Food-grade epoxy coating inside, 2 coats", "sqm", "2600", "420"],
    ["4", "Exterior weather-proof paint, 2 coats", "sqm", "3800", "120"],
    ["5", "Ladder and railing repair and enamel paint", "nos", "10", "18000"],
    ["6", "Replace sluice valves 100 mm", "nos", "20", "14500"],
    ["7", "RCC leak repair with polymer mortar", "sqm", "300", "950"],
  ] as const;
  const quote = await boss.jp.crm.quotations.create({
    clientId: client.id,
    title: `${S}Repainting and renovation of 10 OHTs, Sheragada`,
    quotationDate: day(-60),
    validUntil: day(-30),
    gstPercent: "18",
    terms: "Bills on completion of each group of tanks; 5% security deposit.",
    lines: boq.map(([itemCode, description, unit, quantity, rateRupees]) => ({
      itemCode,
      description,
      unit,
      quantity,
      rateRupees,
    })),
    clientMutationId: id(),
  });
  await boss.jp.crm.quotations.setStatus({
    quotationId: quote.id,
    status: "Sent",
    clientMutationId: id(),
  });
  await boss.jp.crm.quotations.setStatus({
    quotationId: quote.id,
    status: "Accepted",
    clientMutationId: id(),
  });
  await acc.jp.billing.contract.fromQuotation({
    projectId,
    quotationId: quote.id,
    retentionPercent: "5",
    tdsPercent: "2",
    clientMutationId: id(),
  });
  const contract = await acc.jp.billing.contract.get({ projectId });
  const line = (code: string) =>
    contract.items.find((row: { itemCode: string }) => row.itemCode === code)!.id;
  const ra = await acc.jp.billing.bills.create({
    projectId,
    billDate: day(-4),
    periodFrom: day(-45),
    periodTo: day(-5),
    lines: [
      { contractItemId: line("1"), quantity: "3" },
      { contractItemId: line("2"), quantity: "1920" },
      { contractItemId: line("3"), quantity: "774" },
      { contractItemId: line("4"), quantity: "1140" },
      { contractItemId: line("5"), quantity: "3" },
      { contractItemId: line("6"), quantity: "6" },
    ],
    clientMutationId: id(),
  });
  await acc.jp.billing.bills.transition({
    billId: ra.id,
    action: "submit",
    clientMutationId: id(),
  });
  // A lead for next year's maintenance renewal.
  const lead = await boss.jp.crm.leads.create({
    title: `${S}O&M renewal 2028-33, Sheragada`,
    clientId: client.id,
    source: "Tender",
    estimatedValueRupees: "4500000",
    location: "Sheragada Block",
    nextFollowUpOn: day(30),
    note: "Watch for the RWS & S tender notice.",
    clientMutationId: id(),
  });
  await boss.jp.crm.leads.addActivity({
    leadId: lead.id,
    kind: "Meeting",
    note: "EE asked for the tank condition report of all ten tanks.",
    clientMutationId: id(),
  });

  // Budget and documents.
  // Proposed here; a second leader (Owner/Director) approves it.
  await boss.jp.budgets.propose({
    projectId,
    contractValueMinor: "390000000",
    lines: [
      {
        costHead: "Materials",
        amountMinor: "140000000",
        note: "Epoxy, weather coat, enamel, valves",
      },
      { costHead: "Subcontract", amountMinor: "40700000", note: "Rabindra painting labour" },
      { costHead: "Labour", amountMinor: "45000000", note: "Cleaning crew and helpers" },
      {
        costHead: "Equipment and transport",
        amountMinor: "30000000",
        note: "Scaffolding, pump, vehicle",
      },
      { costHead: "Site expenses", amountMinor: "15000000", note: "Petty cash" },
    ],
    reason: `${S}Budget for the tank work`,
    clientMutationId: id(),
  });
  const docs: [string, string, string, string[]][] = [
    [
      "Agreements and work orders",
      "Work order: repainting of 10 OHTs",
      "sample-work-order-oht.pdf",
      [
        "From: Executive Engineer, RWS & S Division, Berhampur",
        "To: JP Infracon",
        "Work: Repainting and renovation of 10 overhead tanks, Sheragada Block",
        "Time: 90 days from the date of this order",
      ],
    ],
    [
      "BOQ and estimates",
      "BOQ: tank repainting and renovation",
      "sample-boq-oht.pdf",
      boq.map(([code, text, unit, qty, rate]) => `${code}. ${text} - ${qty} ${unit} @ Rs ${rate}`),
    ],
    [
      "Inspection and quality",
      "Tank inspection checklist",
      "sample-oht-inspection.pdf",
      [
        "Structure: cracks, spalling, exposed steel",
        "Inside: old coating, scaling, leaks",
        "Ladder, railing, manhole cover, lightning arrester",
        "Valves: inlet, outlet, washout, overflow",
        "Water quality test after filling (chlorine, turbidity)",
      ],
    ],
    [
      "Safety",
      "Work at height permit",
      "sample-height-permit.pdf",
      [
        "Harness anchored to lifeline before climbing: Yes / No",
        "Helmet chin strap fastened: Yes / No",
        "Tools tied; area below barricaded: Yes / No",
        "Permit issued by: ________  Time: ______",
      ],
    ],
  ];
  for (const [category, title, fileName, lines] of docs)
    await boss.jp.documents.upload({
      projectId,
      siteId: first,
      category: category as never,
      title: `${S}${title}`,
      tags: "sheragada, oht, sample",
      fileName,
      base64: Buffer.from(simplePdf(`SAMPLE ${title}`, lines), "latin1").toString("base64"),
      clientMutationId: id(),
    });
}

/** Real part 2: the client says Kalyan Mandap is complete. */
export async function markKalyanMandapCompleted(
  ctx: MoreContext,
  ids: { projectId: string; siteId: string },
) {
  await ctx.boss.jp.sitesAdmin.setSiteStatus({
    siteId: ids.siteId,
    status: "Completed",
    reason: "Work complete and handed over.",
    clientMutationId: id(),
  });
  await ctx.boss.jp.sitesAdmin.setProjectStatus({
    projectId: ids.projectId,
    status: "Completed",
    reason: "Work complete and handed over.",
    clientMutationId: id(),
  });
}
