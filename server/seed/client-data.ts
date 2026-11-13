/**
 * The client's starting data for production, put in through the real procedures, so every
 * record passes the same rules, permissions and maker-checker steps and has its audit trail.
 *
 * Real (from the client): the site G+1 Govt Kalyan Mandap at Pakalapoli, Aska; Sipun Gouda
 * (site supervisor and driver), Musha Behera (permanent site worker and cook), Pahalad (mason
 * contractor and mistri), Rabindra Ku Nayak (painting contractor and mistri), Bhagabati
 * Enterprises (electrical and pumping material) and Rajdhani UPVC (UPVC doors and windows), all
 * at Berhampur.
 *
 * Everything else (rates, BOQ, tasks, reports, bills, payroll) is example data so the client can
 * see how each form is filled. Every example record says SAMPLE, and admins can edit, cancel or
 * delete it like any other record.
 */
import { randomUUID } from "node:crypto";
import type { appRouter } from "../routers";
import { previousMonth } from "../../lib/jp/payroll-domain";

export type SeedCaller = ReturnType<typeof appRouter.createCaller>;

export const SEED_SITE_CODE = "ASKA-KM1";
const S = "SAMPLE · ";

export type SeedResult = {
  organizationId: string;
  projectId: string;
  siteId: string;
  logins: { name: string; role: string; username: string; temporaryPassword: string }[];
};

/** A date `offset` days from `today` (YYYY-MM-DD). */
function dayFrom(today: string, offset: number): string {
  const date = new Date(`${today}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + offset);
  return date.toISOString().slice(0, 10);
}

const id = () => `seed-${randomUUID()}`;

/** A one-page A4 PDF with plain text lines (Helvetica), for the sample BOQ document. */
export function simplePdf(title: string, lines: string[]): string {
  const esc = (text: string) => text.replace(/[\\()]/g, (c) => `\\${c}`);
  const rows = [title, "", ...lines].slice(0, 60);
  const body = rows
    .map((line, index) => {
      const size = index === 0 ? 14 : 9;
      const y = 800 - index * 13;
      return `BT /F1 ${size} Tf 40 ${y} Td (${esc(line)}) Tj ET`;
    })
    .join("\n");
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>",
    `<< /Length ${body.length} >>\nstream\n${body}\nendstream`,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
  ];
  let pdf = "%PDF-1.4\n";
  const offsets: number[] = [];
  objects.forEach((object, index) => {
    offsets.push(pdf.length);
    pdf += `${index + 1} 0 obj\n${object}\nendobj\n`;
  });
  const xref = pdf.length;
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const offset of offsets) pdf += `${String(offset).padStart(10, "0")} 00000 n \n`;
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return pdf;
}

/** The sample BOQ for a G+1 community hall (rates are examples, not the tender's). */
export const SAMPLE_BOQ = [
  ["1.1", "Earthwork excavation in foundation, all soils", "cum", "420", "210"],
  ["2.1", "PCC M10 (1:3:6) below footings", "cum", "38", "5200"],
  ["3.1", "RCC M20 in footings, columns, beams and slabs", "cum", "265", "7650"],
  ["3.2", "TMT reinforcement Fe500D, cut, bent and tied", "MT", "31.5", "72000"],
  ["4.1", "Fly ash brick masonry in CM 1:6", "cum", "310", "5900"],
  ["5.1", "12 mm cement plaster in CM 1:6", "sqm", "2850", "265"],
  ["6.1", "Vitrified tile flooring 600 x 600 mm", "sqm", "780", "1150"],
  ["7.1", "UPVC doors and windows with glazing (Rajdhani UPVC)", "sqm", "145", "4200"],
  ["8.1", "Interior acrylic emulsion, two coats over putty", "sqm", "3600", "115"],
  ["8.2", "Exterior weather coat, two coats", "sqm", "1450", "140"],
  ["9.1", "Internal electrification: wiring, points and DB (Bhagabati)", "point", "260", "1350"],
  ["9.2", "Submersible pump 1.5 HP with starter panel and piping", "nos", "1", "68000"],
] as const;

export async function seedClientData(opts: {
  /** The Super Admin, who approves. */
  boss: SeedCaller;
  /** A caller acting as an account the seed has just created. */
  callerFor: (userId: number) => Promise<SeedCaller>;
  /** Defaults to the server's own date (UTC), the one attendance checks use. */
  today?: string;
}): Promise<SeedResult> {
  const { boss, callerFor } = opts;
  const today = opts.today ?? new Date().toISOString().slice(0, 10);
  const day = (offset: number) => dayFrom(today, offset);

  // ── Company, project and site ────────────────────────────────────────────────────────────
  const companies = await boss.jp.accounts.options();
  let organizationId: string;
  let projectId: string;
  let siteId: string;
  const site = {
    name: "G+1 Govt Kalyan Mandap, Aska",
    address: "Pakalapoli, Aska, Ganjam district, Odisha (near Berhampur)",
  };
  if (!companies.length) {
    const first = await boss.jp.workspace.initializeFirstWorkspace({
      organizationName: "JP Infracon",
      organizationCode: "JPI",
      projectName: "Govt Kalyan Mandap, Aska",
      projectCode: "ASKA-KM",
      projectType: "Government building",
      siteName: site.name,
      siteCode: SEED_SITE_CODE,
      address: site.address,
    });
    ({ organizationId, projectId, siteId } = first);
  } else {
    organizationId = companies[0]!.id;
    projectId = (
      await boss.jp.sitesAdmin.createProject({
        organizationId,
        projectCode: "ASKA-KM",
        name: "Govt Kalyan Mandap, Aska",
        projectType: "Government building",
        clientDepartment: "Government of Odisha",
        clientMutationId: id(),
      })
    ).id;
    siteId = (
      await boss.jp.sitesAdmin.createSite({
        projectId,
        siteCode: SEED_SITE_CODE,
        name: site.name,
        address: site.address,
        village: "Pakalapoli",
        district: "Ganjam",
        state: "Odisha",
        clientMutationId: id(),
      })
    ).id;
  }

  // ── Logins: Sipun (real) and an example accounts login ───────────────────────────────────
  const logins: SeedResult["logins"] = [];
  const makeLogin = async (
    displayName: string,
    username: string,
    businessRole: "supervisor" | "accounts",
  ) => {
    const made = await boss.jp.accounts.create({
      organizationId,
      displayName,
      username,
      businessRole,
      siteIds: [siteId],
    });
    logins.push({
      name: displayName,
      role: businessRole,
      username: made.username,
      temporaryPassword: made.temporaryPassword,
    });
    return made.userId;
  };
  const sipunUserId = await makeLogin("Sipun Gouda", "sipun.gouda", "supervisor");
  const accountsUserId = await makeLogin("Accounts (Sample)", "accounts.sample", "accounts");
  const sipun = await callerFor(sipunUserId);
  const acc = await callerFor(accountsUserId);

  // ── People (real) ────────────────────────────────────────────────────────────────────────
  const person = async (
    fullName: string,
    personType: "worker" | "technician",
    tradeType: string,
    skill: "Skilled" | "Semi-skilled" | "Unskilled",
  ) => {
    const made = await sipun.jp.workforce.createPerson({
      siteId,
      fullName,
      personType,
      skillCategory: skill,
      tradeType,
      clientMutationId: id(),
    });
    await boss.jp.workforce.reviewPerson({
      siteId,
      personId: made.id,
      status: "Active",
      reason: "Known to the company; added at handover",
      clientMutationId: id(),
    });
    return made.id;
  };
  const sipunPerson = await person(
    "Sipun Gouda",
    "technician",
    "Site supervisor / Driver",
    "Skilled",
  );
  const musha = await person(
    "Musha Behera",
    "worker",
    "Site worker / Cook (permanent)",
    "Semi-skilled",
  );
  const pahalad = await person("Pahalad", "worker", "Mason (mistri) and contractor", "Skilled");
  const rabindra = await person(
    "Rabindra Ku Nayak",
    "worker",
    "Painter (mistri) and contractor",
    "Skilled",
  );

  // ── Suppliers and contractors (real) ─────────────────────────────────────────────────────
  const vendor = (
    vendorType: "Material Supplier" | "Subcontractor",
    legalName: string,
    tradeName: string,
    contactName?: string,
  ) =>
    acc.jp.finance.createVendor({
      siteId,
      vendorType,
      legalName,
      tradeName,
      contactName,
      address: "Berhampur, Ganjam, Odisha",
      paymentTermsDays: vendorType === "Subcontractor" ? 15 : 30,
      clientMutationId: id(),
    });
  const bhagabati = await vendor(
    "Material Supplier",
    "Bhagabati Enterprises",
    "Electrical and pumping materials",
  );
  const rajdhani = await vendor("Material Supplier", "Rajdhani UPVC", "UPVC doors and windows");
  const pahaladFirm = await vendor(
    "Subcontractor",
    "Pahalad Mason Works",
    "Masonry contractor",
    "Pahalad",
  );
  const rabindraFirm = await vendor(
    "Subcontractor",
    "Rabindra Ku Nayak Painting Works",
    "Painting contractor",
    "Rabindra Ku Nayak",
  );
  for (const [personId, vendorId, note] of [
    [sipunPerson, null, "Also drives the site vehicle."],
    [musha, null, "Permanent site worker; cooks for the site team."],
    [pahalad, pahaladFirm.id, "Mason mistri; also takes masonry work on contract."],
    [rabindra, rabindraFirm.id, "Painter mistri; also takes painting work on contract."],
  ] as const)
    await sipun.jp.people.saveDetails({
      personId,
      siteId,
      city: "Berhampur",
      district: "Ganjam",
      pincode: "760001",
      vendorId,
      notes: note,
      clientMutationId: id(),
    });

  // ── Wage rates (example) and attendance ──────────────────────────────────────────────────
  const payMonth = previousMonth(today);
  const rateFrom = `${payMonth}-01`;
  const engagements: Record<string, string> = {};
  for (const [personId, rate] of [
    [musha, "500"],
    [pahalad, "900"],
    [rabindra, "850"],
  ] as const) {
    const proposed = await acc.jp.workforce.proposeRate({
      siteId,
      personId,
      engagementType: "Daily wage",
      rateType: "daily",
      rateRupees: rate,
      effectiveFrom: rateFrom,
      clientMutationId: id(),
    });
    await boss.jp.workforce.reviewRate({
      siteId,
      engagementId: proposed.id,
      decision: "Approve",
      reason: `${S}example daily rate; change it to the agreed rate`,
      clientMutationId: id(),
    });
    engagements[personId] = proposed.id;
  }
  const marks = (overtimeFor?: string) =>
    Object.entries(engagements).map(([personId, engagementId]) => ({
      engagementId,
      status: "Full Day" as const,
      regularHours: "8",
      overtimeHours: personId === overtimeFor ? "2" : "0",
    }));
  // Last month: five approved days, so a pay run can be made.
  for (const date of ["03", "04", "05", "06", "07"]) {
    const workDate = `${payMonth}-${date}`;
    await sipun.jp.attendance.mark({
      siteId,
      workDate,
      shiftCode: "GEN",
      entries: marks(date === "05" ? pahalad : undefined),
      clientMutationId: id(),
    });
    await boss.jp.attendance.approve({
      siteId,
      workDate,
      shiftCode: "GEN",
      overtime: "approve",
      clientMutationId: id(),
    });
  }
  await sipun.jp.attendance.mark({
    siteId,
    workDate: day(-1),
    shiftCode: "GEN",
    entries: marks(),
    clientMutationId: id(),
  });
  await boss.jp.attendance.approve({
    siteId,
    workDate: day(-1),
    shiftCode: "GEN",
    overtime: "approve",
    clientMutationId: id(),
  });
  // Today's attendance waits for approval.
  await sipun.jp.attendance.mark({
    siteId,
    workDate: day(0),
    shiftCode: "GEN",
    entries: marks(),
    clientMutationId: id(),
  });

  // ── Crew ─────────────────────────────────────────────────────────────────────────────────
  const crew = await sipun.jp.crews.create({
    siteId,
    name: "Pahalad masonry crew",
    trade: "Masonry",
    clientMutationId: id(),
  });
  await sipun.jp.crews.addMember({ crewId: crew.id, personId: pahalad, clientMutationId: id() });

  // ── Schedule (example) ───────────────────────────────────────────────────────────────────
  const task = (
    title: string,
    workCategory: string,
    start: number,
    end: number,
    dependsOn?: string,
  ) =>
    boss.jp.tasks.create({
      siteId,
      title: `${S}${title}`,
      workCategory,
      locationLabel: "Kalyan Mandap",
      plannedStart: day(start),
      plannedEnd: day(end),
      priority: "Normal",
      dependencies: dependsOn ? [{ taskId: dependsOn, lagDays: 0 }] : undefined,
      clientMutationId: id(),
    });
  const t1 = await task("Excavation and PCC for footings", "Civil", -60, -45);
  const t2 = await task("Footings, plinth beam and filling", "RCC", -44, -25, t1.id);
  const t3 = await task("Ground floor columns and first floor slab", "RCC", -24, 6, t2.id);
  const t4 = await task("Ground floor brickwork", "Masonry", 7, 30, t3.id);
  await task("Plaster, ground floor", "Finishing", 31, 50, t4.id);
  await task("Electrical wiring and pump (Bhagabati)", "Electrical", 35, 60, t4.id);
  await task("UPVC doors and windows (Rajdhani UPVC)", "Finishing", 50, 65, t4.id);
  await task("Painting inside and outside (Rabindra)", "Finishing", 60, 80, t4.id);
  for (const [taskId, statuses] of [
    [t1.id, ["In Progress", "Completed"]],
    [t2.id, ["In Progress", "Completed"]],
    [t3.id, ["In Progress"]],
  ] as const)
    for (const status of statuses)
      await sipun.jp.tasks.updateStatus({ taskId, status, clientMutationId: id() });

  // ── Daily reports, material request, issue (example) ─────────────────────────────────────
  const dpr = await sipun.jp.reports.createDraft({
    siteId,
    reportKind: "DPR",
    reportDate: day(-1),
    title: `${S}First floor slab shuttering`,
    remarks: "Shuttering for first floor slab 60% done. Column C1 to C12 cured.",
    nextDayPlan: "Finish slab shuttering; start reinforcement.",
    weatherCode: "Clear",
    overallStatus: "On track",
    items: [
      {
        taskId: t3.id,
        description: "Slab shuttering",
        locationLabel: "First floor slab",
        unitCode: "sqm",
        plannedQuantity: "420",
        completedQuantityToday: "85",
        cumulativeQuantity: "250",
      },
    ],
    clientMutationId: id(),
  });
  await sipun.jp.reports.submit({ reportId: dpr.id });
  await sipun.jp.reports.createDraft({
    siteId,
    reportKind: "DLR",
    reportDate: day(0),
    title: `${S}Labour on site today`,
    remarks: "Pahalad with 4 helpers on shuttering; Musha on site work and cooking.",
    clientMutationId: id(),
  });
  await sipun.jp.materialRequests.create({
    siteId,
    itemName: "PPC cement",
    quantity: "150",
    unitCode: "bag",
    purpose: `${S}First floor slab casting`,
    requiredBy: day(3),
    clientMutationId: id(),
  });
  const issue = await sipun.jp.issues.create({
    siteId,
    category: "Safety Hazard",
    severity: "Medium",
    title: `${S}Toe boards missing on scaffolding`,
    description: "Scaffolding on the east side has no toe boards at the slab level.",
    locationLabel: "East side scaffolding",
    immediateAction: "Workers told to keep tools off the planks until fixed.",
    clientMutationId: id(),
  });
  await boss.jp.issues.assign({
    issueId: issue.id,
    ownerUserId: sipunUserId,
    targetDate: day(2),
    note: "Fit toe boards before the slab pour.",
    clientMutationId: id(),
  });

  // ── Store (example) ──────────────────────────────────────────────────────────────────────
  const item = (itemCode: string, name: string, category: string, unit: string, reorder: string) =>
    boss.jp.inventory.createItem({
      siteId,
      itemCode,
      name,
      category,
      baseUnitCode: unit,
      reorderThreshold: reorder,
      clientMutationId: id(),
    });
  const cement = await item("CEM-PPC", "PPC cement", "Cement", "bag", "60");
  const steel = await item("TMT-10", "TMT bar 10 mm Fe500D", "Steel", "kg", "500");
  await item("BRK-FLY", "Fly ash bricks", "Masonry", "nos", "2000");
  const inward = await sipun.jp.inventory.submitMovement({
    siteId,
    materialItemId: cement.id,
    movementType: "Receipt/Inward",
    quantity: "200",
    sourceReference: `${S}Challan 1021`,
    reason: "Delivered and counted at site",
    clientMutationId: id(),
  });
  await boss.jp.inventory.reviewMovement({
    movementId: inward.id,
    decision: "Post",
    clientMutationId: id(),
  });
  const steelIn = await sipun.jp.inventory.submitMovement({
    siteId,
    materialItemId: steel.id,
    movementType: "Receipt/Inward",
    quantity: "1800",
    sourceReference: `${S}Challan 1022`,
    reason: "Delivered and weighed at site",
    clientMutationId: id(),
  });
  await boss.jp.inventory.reviewMovement({
    movementId: steelIn.id,
    decision: "Post",
    clientMutationId: id(),
  });
  await sipun.jp.inventory.submitMovement({
    siteId,
    materialItemId: cement.id,
    movementType: "Issue/Consumption",
    quantity: "45",
    reason: `${S}Issued for column casting`,
    clientMutationId: id(),
  });

  // ── Purchase from Rajdhani UPVC (example) ────────────────────────────────────────────────
  const po = await acc.jp.purchase.create({
    siteId,
    vendorId: rajdhani.id,
    orderDate: day(-4),
    expectedDate: day(40),
    terms: `${S}Supply and fix at site; 30% advance, balance after fixing.`,
    lines: [
      {
        description: "UPVC casement window with glass, 1200 x 1200 mm",
        unitCode: "nos",
        quantity: "24",
        rateRupees: "9800",
        gstPercent: "18",
      },
      {
        description: "UPVC door with frame, 900 x 2100 mm",
        unitCode: "nos",
        quantity: "8",
        rateRupees: "14500",
        gstPercent: "18",
      },
    ],
    clientMutationId: id(),
  });
  await acc.jp.purchase.transition({
    siteId,
    poId: po.id,
    action: "submit",
    clientMutationId: id(),
  });
  await boss.jp.purchase.transition({
    siteId,
    poId: po.id,
    action: "approve",
    clientMutationId: id(),
  });

  // ── Supplier bill and part payment, Bhagabati (example) ──────────────────────────────────
  const bill = await sipun.jp.finance.createInvoice({
    siteId,
    vendorId: bhagabati.id,
    invoiceNumber: "SAMPLE-BE-0451",
    invoiceDate: day(-8),
    dueDate: day(22),
    taxRupees: "8820",
    chargesRupees: "0",
    items: [
      {
        description: "PVC conduit 25 mm and bends",
        quantity: "120",
        unitCode: "nos",
        lineTotalRupees: "14400",
      },
      {
        description: "FR copper wire 2.5 sq mm, 90 m coil",
        quantity: "8",
        unitCode: "nos",
        lineTotalRupees: "34600",
      },
    ],
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
    vendorId: bhagabati.id,
    paymentDate: day(-1),
    amountRupees: "30000",
    paymentMode: "Bank Transfer",
    paidByName: "JP Infracon accounts",
    fundingSourceLabel: "Current account",
    category: "Material",
    purpose: `${S}Part payment for bill SAMPLE-BE-0451`,
    externalReference: "SAMPLE-UTR-0001",
    allocations: [{ invoiceId: bill.id, amountRupees: "30000" }],
    clientMutationId: id(),
  });
  await acc.jp.finance.payments.submitPayment({
    siteId,
    paymentId: payment.id,
    clientMutationId: id(),
  });

  // ── Petty cash held by Sipun (example) ───────────────────────────────────────────────────
  const fund = await acc.jp.finance.pettyCash.createFund({
    siteId,
    name: "Aska site cash",
    custodianUserId: sipunUserId,
    authorizedLimitRupees: "20000",
    reconciliationPeriod: "Weekly",
    clientMutationId: id(),
  });
  await sipun.jp.finance.pettyCash.acknowledgeFund({
    siteId,
    fundId: fund.id,
    clientMutationId: id(),
  });
  const funding = await acc.jp.finance.pettyCash.createMovement({
    siteId,
    fundId: fund.id,
    movementType: "Funding",
    amountRupees: "15000",
    movementDate: day(-6),
    paymentMode: "Cash",
    payeeName: "Sipun Gouda",
    paidByName: "Accounts (Sample)",
    fundingSource: "Company cash issue",
    category: "Site imprest",
    purpose: `${S}Weekly site cash for small purchases and diesel`,
    receiptReference: "SAMPLE-CV-001",
    clientMutationId: id(),
  });
  await acc.jp.finance.pettyCash.submitMovement({
    siteId,
    movementId: funding.id,
    clientMutationId: id(),
  });
  await boss.jp.finance.pettyCash.reviewMovement({
    siteId,
    movementId: funding.id,
    decision: "Approved",
    reason: "Within the weekly limit",
    clientMutationId: id(),
  });
  await boss.jp.finance.pettyCash.postMovement({
    siteId,
    movementId: funding.id,
    clientMutationId: id(),
  });
  const expense = await sipun.jp.finance.pettyCash.createMovement({
    siteId,
    fundId: fund.id,
    movementType: "Expense",
    amountRupees: "2400",
    movementDate: day(-1),
    paymentMode: "Cash",
    payeeName: "Fuel station, Aska",
    paidByName: "Sipun Gouda",
    expenseFundingSource: "Site Petty Cash",
    fundSourceAttested: true,
    category: "Fuel",
    purpose: `${S}Diesel for the site vehicle`,
    receiptReference: "SAMPLE-BILL-77",
    clientMutationId: id(),
  });
  await sipun.jp.finance.pettyCash.submitMovement({
    siteId,
    movementId: expense.id,
    clientMutationId: id(),
  });

  // ── Client, BOQ, contract and RA bill (example) ──────────────────────────────────────────
  const client = await boss.jp.crm.clients.create({
    name: "Block Development Office, Aska (Sample)",
    clientType: "Government",
    contactPerson: "Block Development Officer",
    address: "Aska, Ganjam, Odisha",
    clientMutationId: id(),
  });
  const quote = await boss.jp.crm.quotations.create({
    clientId: client.id,
    title: `${S}BOQ: G+1 Govt Kalyan Mandap, Aska`,
    quotationDate: day(-90),
    validUntil: day(-60),
    gstPercent: "18",
    terms: "Monthly RA bills; 5% retention till handover; TDS as per law.",
    lines: SAMPLE_BOQ.map(([itemCode, description, unit, quantity, rateRupees]) => ({
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
  const boqItem = (code: string) => contract.items.find((row) => row.itemCode === code)!.id;
  const ra1 = await acc.jp.billing.bills.create({
    projectId,
    billDate: day(-20),
    periodFrom: day(-60),
    periodTo: day(-21),
    lines: [
      { contractItemId: boqItem("1.1"), quantity: "420" },
      { contractItemId: boqItem("2.1"), quantity: "38" },
      { contractItemId: boqItem("3.1"), quantity: "62.5" },
    ],
    clientMutationId: id(),
  });
  await acc.jp.billing.bills.transition({
    billId: ra1.id,
    action: "submit",
    clientMutationId: id(),
  });
  await boss.jp.billing.bills.transition({
    billId: ra1.id,
    action: "approve",
    clientMutationId: id(),
  });
  await acc.jp.billing.receipts.record({
    billId: ra1.id,
    amountRupees: "400000",
    receivedOn: day(-5),
    mode: "Bank transfer",
    reference: "SAMPLE-NEFT-0001",
    clientMutationId: id(),
  });

  // ── Subcontract: Pahalad's masonry (approved, measured, billed), Rabindra's painting ─────
  const wo = await acc.jp.subcontract.create({
    siteId,
    vendorId: pahaladFirm.id,
    title: `${S}Brickwork and plaster, ground floor`,
    scope: "Labour with tools; cement, sand and bricks from JP Infracon.",
    startDate: day(-10),
    endDate: day(45),
    gstPercent: "0",
    retentionPercent: "5",
    tdsPercent: "1",
    advanceRupees: "20000",
    advanceRecoveryPercent: "20",
    items: [
      {
        itemCode: "M1",
        description: "Fly ash brick masonry in CM 1:6 (labour)",
        unit: "cum",
        quantity: "150",
        rateRupees: "1650",
      },
      {
        itemCode: "M2",
        description: "12 mm cement plaster in CM 1:6 (labour)",
        unit: "sqm",
        quantity: "1400",
        rateRupees: "85",
      },
    ],
    clientMutationId: id(),
  });
  await acc.jp.subcontract.transition({
    siteId,
    woId: wo.id,
    action: "submit",
    clientMutationId: id(),
  });
  await boss.jp.subcontract.transition({
    siteId,
    woId: wo.id,
    action: "approve",
    clientMutationId: id(),
  });
  const woDetail = await sipun.jp.subcontract.detail({ siteId, woId: wo.id });
  const brick = woDetail.items.find((row) => row.itemCode === "M1")!.id;
  const m1 = await sipun.jp.subcontract.measure({
    siteId,
    woId: wo.id,
    itemId: brick,
    measuredOn: day(-4),
    location: "Ground floor outer walls, grid A to D",
    nos: "1",
    length: "72",
    breadth: "0.23",
    depth: "3",
    clientMutationId: id(),
  });
  const m2 = await sipun.jp.subcontract.measure({
    siteId,
    woId: wo.id,
    itemId: brick,
    measuredOn: day(-4),
    location: "Door openings D1",
    nos: "4",
    length: "1",
    breadth: "0.23",
    depth: "2.1",
    deduction: true,
    clientMutationId: id(),
  });
  await boss.jp.subcontract.checkMeasurement({
    siteId,
    measurementIds: [m1.id, m2.id],
    action: "check",
    clientMutationId: id(),
  });
  const subBill = await acc.jp.subcontract.createBill({
    siteId,
    woId: wo.id,
    billDate: day(-2),
    periodTo: day(-3),
    submit: true,
    clientMutationId: id(),
  });
  await boss.jp.subcontract.billTransition({
    siteId,
    billId: subBill.id,
    action: "approve",
    clientMutationId: id(),
  });
  const paint = await acc.jp.subcontract.create({
    siteId,
    vendorId: rabindraFirm.id,
    title: `${S}Painting inside and outside`,
    scope: "Labour for putty, primer and two coats; paint from JP Infracon.",
    startDate: day(60),
    endDate: day(80),
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
  // Waits for the Super Admin's approval, to show the approval step.
  await acc.jp.subcontract.transition({
    siteId,
    woId: paint.id,
    action: "submit",
    clientMutationId: id(),
  });

  // ── Payroll (example): pay details, last month's pay run waiting to be marked paid ───────
  const profiles: Parameters<typeof acc.jp.payroll.saveProfile>[0][] = [
    {
      siteId,
      personId: musha,
      payType: "Daily",
      pfMember: false,
      esiMember: false,
      ptApplies: false,
      effectiveFrom: rateFrom,
      clientMutationId: id(),
    },
    {
      siteId,
      personId: pahalad,
      payType: "Daily",
      pfMember: false,
      esiMember: false,
      ptApplies: false,
      effectiveFrom: rateFrom,
      clientMutationId: id(),
    },
    {
      siteId,
      personId: rabindra,
      payType: "Daily",
      pfMember: false,
      esiMember: false,
      ptApplies: false,
      effectiveFrom: rateFrom,
      clientMutationId: id(),
    },
  ];
  for (const profile of profiles) {
    const saved = await acc.jp.payroll.saveProfile(profile);
    await boss.jp.payroll.reviewProfile({
      siteId,
      profileId: saved.id,
      action: "approve",
      clientMutationId: id(),
    });
  }
  const advance = await sipun.jp.advances.request({
    siteId,
    personId: musha,
    entryType: "Advance",
    amountRupees: "1000",
    installmentRupees: "500",
    entryDate: `${payMonth}-05`,
    mode: "Cash",
    reason: `${S}Festival advance`,
    clientMutationId: id(),
  });
  await boss.jp.advances.review({
    siteId,
    entryId: advance.id,
    action: "approve",
    clientMutationId: id(),
  });
  const run = await acc.jp.payroll.create({ siteId, month: payMonth, clientMutationId: id() });
  await acc.jp.payroll.transition({
    siteId,
    runId: run.id,
    action: "submit",
    clientMutationId: id(),
  });
  await boss.jp.payroll.transition({
    siteId,
    runId: run.id,
    action: "approve",
    clientMutationId: id(),
  });

  // ── Documents: the sample BOQ as a PDF and a spreadsheet file (CSV) ──────────────────────
  const csv = [
    "Item,Description,Unit,Quantity,Rate (Rs),Amount (Rs)",
    ...SAMPLE_BOQ.map(([code, description, unit, quantity, rate]) => {
      const amount = Math.round(Number(quantity) * Number(rate));
      return `${code},"${description}",${unit},${quantity},${rate},${amount}`;
    }),
  ].join("\r\n");
  await boss.jp.documents.upload({
    projectId,
    siteId,
    category: "BOQ and estimates",
    title: `${S}BOQ, G+1 Govt Kalyan Mandap (spreadsheet)`,
    tags: "boq, estimate, sample",
    fileName: "sample-boq-kalyan-mandap.csv",
    base64: Buffer.from(`﻿${csv}`, "utf8").toString("base64"),
    clientMutationId: id(),
  });
  const pdf = simplePdf("SAMPLE BOQ - G+1 Govt Kalyan Mandap, Pakalapoli, Aska", [
    "Example only: replace with the tender BOQ.",
    "",
    ...SAMPLE_BOQ.map(
      ([code, description, unit, quantity, rate]) =>
        `${code}  ${description}  -  ${quantity} ${unit} @ Rs ${rate}`,
    ),
  ]);
  await boss.jp.documents.upload({
    projectId,
    siteId,
    category: "BOQ and estimates",
    title: `${S}BOQ, G+1 Govt Kalyan Mandap (PDF)`,
    tags: "boq, estimate, sample",
    fileName: "sample-boq-kalyan-mandap.pdf",
    base64: Buffer.from(pdf, "latin1").toString("base64"),
    clientMutationId: id(),
  });

  return { organizationId, projectId, siteId, logins };
}
