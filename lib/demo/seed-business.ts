import type { DemoWorkspace } from "./seed";
import { mutationId as id, signIn } from "./seed";

function day(offset: number): string {
  const date = new Date();
  date.setDate(date.getDate() + offset);
  return date.toISOString().slice(0, 10);
}

/**
 * Suppliers, materials, workers, tasks, reports, issues, bills, payments and petty cash for the
 * demo sites. Each step is done by the role that would do it, so maker-checker rules hold and
 * every screen has records in different states (draft, waiting for review, approved, posted).
 */
export async function seedBusinessData(workspace: DemoWorkspace): Promise<void> {
  const [siteA, siteB] = workspace.siteIds;
  const owner = await signIn("owner");
  const manager = await signIn("manager");
  const supervisor = await signIn("supervisor");
  const accounts = await signIn("accounts");
  const store = await signIn("store");

  const people = await owner.jp.accounts.list({ organizationId: workspace.organizationId });
  const userId = (username: string) => {
    const person = people.find((row) => row.username === username);
    if (!person) throw new Error(`Demo account ${username} is missing.`);
    return person.id;
  };

  // Site boundary for the GPS camera and arrival alerts (Patia, Bhubaneswar).
  await owner.jp.sitesAdmin.setGeofence({
    siteId: siteA,
    latitude: 20.3533,
    longitude: 85.8266,
    radiusM: 250,
  });

  // Schedule.
  const foundation = await manager.jp.tasks.create({
    siteId: siteA,
    title: "Foundation excavation, Block 1",
    workCategory: "Civil",
    locationLabel: "Block 1",
    plannedStart: day(-10),
    plannedEnd: day(-2),
    priority: "High",
    clientMutationId: id(),
  });
  const columns = await manager.jp.tasks.create({
    siteId: siteA,
    title: "Ground floor columns casting",
    workCategory: "RCC",
    locationLabel: "Block 1",
    plannedStart: day(-1),
    plannedEnd: day(8),
    priority: "Normal",
    dependencies: [{ taskId: foundation.id, lagDays: 0 }],
    clientMutationId: id(),
  });
  await manager.jp.tasks.create({
    siteId: siteB,
    title: "Boundary wall brickwork",
    workCategory: "Masonry",
    plannedStart: day(2),
    plannedEnd: day(12),
    clientMutationId: id(),
  });
  await supervisor.jp.tasks.updateStatus({
    taskId: foundation.id,
    status: "In Progress",
    clientMutationId: id(),
  });
  await supervisor.jp.tasks.updateStatus({
    taskId: foundation.id,
    status: "Completed",
    clientMutationId: id(),
  });
  await supervisor.jp.tasks.updateStatus({
    taskId: columns.id,
    status: "In Progress",
    clientMutationId: id(),
  });

  // Daily reports: one submitted for review, one draft.
  const dpr = await supervisor.jp.reports.createDraft({
    siteId: siteA,
    reportKind: "DPR",
    reportDate: day(-1),
    title: "Column reinforcement and shuttering",
    remarks: "12 columns shuttered, reinforcement checked by site engineer.",
    nextDayPlan: "Concrete pour for C1 to C6.",
    weatherCode: "Clear",
    overallStatus: "On track",
    items: [
      {
        taskId: columns.id,
        description: "Column shuttering",
        locationLabel: "Ground floor, grid A–C",
        unitCode: "nos",
        plannedQuantity: "24",
        completedQuantityToday: "12",
        cumulativeQuantity: "12",
      },
      {
        description: "Reinforcement check",
        locationLabel: "Ground floor columns",
        remarks: "Checked by site engineer",
      },
    ],
    clientMutationId: id(),
  });
  await supervisor.jp.reports.submit({ reportId: dpr.id });
  await supervisor.jp.reports.createDraft({
    siteId: siteA,
    reportKind: "DLR",
    reportDate: day(0),
    title: "Labour on site today",
    remarks: "18 masons and helpers, 2 bar benders.",
    clientMutationId: id(),
  });

  // Material request.
  await supervisor.jp.materialRequests.create({
    siteId: siteA,
    itemName: "OPC 53 grade cement",
    quantity: "120",
    unitCode: "bag",
    purpose: "Ground floor column casting",
    requiredBy: day(3),
    clientMutationId: id(),
  });

  // Inventory: catalogue, a posted receipt, an issue waiting for review.
  const cement = await owner.jp.inventory.createItem({
    siteId: siteA,
    itemCode: "CEM-OPC53",
    name: "OPC 53 grade cement",
    category: "Cement",
    baseUnitCode: "bag",
    reorderThreshold: "50",
    clientMutationId: id(),
  });
  const steel = await owner.jp.inventory.createItem({
    siteId: siteA,
    itemCode: "TMT-12",
    name: "TMT bar 12 mm",
    category: "Steel",
    baseUnitCode: "kg",
    reorderThreshold: "500",
    clientMutationId: id(),
  });
  const inward = await store.jp.inventory.submitMovement({
    siteId: siteA,
    materialItemId: cement.id,
    movementType: "Receipt/Inward",
    quantity: "200",
    sourceReference: "Challan 4512",
    reason: "Supplier delivery received and counted",
    clientMutationId: id(),
  });
  await manager.jp.inventory.reviewMovement({
    movementId: inward.id,
    decision: "Post",
    clientMutationId: id(),
  });
  const steelIn = await store.jp.inventory.submitMovement({
    siteId: siteA,
    materialItemId: steel.id,
    movementType: "Receipt/Inward",
    quantity: "1500",
    sourceReference: "Challan 4513",
    reason: "Supplier delivery received and weighed",
    clientMutationId: id(),
  });
  await manager.jp.inventory.reviewMovement({
    movementId: steelIn.id,
    decision: "Post",
    clientMutationId: id(),
  });
  await store.jp.inventory.submitMovement({
    siteId: siteA,
    materialItemId: cement.id,
    movementType: "Issue/Consumption",
    quantity: "40",
    reason: "Issued for column casting C1 to C6",
    clientMutationId: id(),
  });

  // Workforce: people, approved rates, today's attendance waiting for approval.
  const workers: string[] = [];
  for (const [fullName, tradeType, skill] of [
    ["Ramesh Behera", "Mason", "Skilled"],
    ["Sunita Nayak", "Helper", "Unskilled"],
    ["Prakash Sahoo", "Bar bender", "Semi-skilled"],
  ] as const) {
    const person = await supervisor.jp.workforce.createPerson({
      siteId: siteA,
      fullName,
      personType: "worker",
      skillCategory: skill,
      tradeType,
      clientMutationId: id(),
    });
    await manager.jp.workforce.reviewPerson({
      siteId: siteA,
      personId: person.id,
      status: "Active",
      reason: "Identity checked at site office",
      clientMutationId: id(),
    });
    workers.push(person.id);
  }
  const engagements: string[] = [];
  for (const [index, personId] of workers.entries()) {
    const rate = await accounts.jp.workforce.proposeRate({
      siteId: siteA,
      personId,
      engagementType: "Daily wage",
      rateType: "daily",
      rateRupees: ["850", "550", "700"][index],
      effectiveFrom: day(-30),
      clientMutationId: id(),
    });
    await owner.jp.workforce.reviewRate({
      siteId: siteA,
      engagementId: rate.id,
      decision: "Approve",
      reason: "Matches the agreed labour rate card",
      clientMutationId: id(),
    });
    engagements.push(rate.id);
  }
  await supervisor.jp.attendance.mark({
    siteId: siteA,
    workDate: day(-1),
    shiftCode: "GEN",
    entries: engagements.map((engagementId, index) => ({
      engagementId,
      status: index === 1 ? "Half Day" : "Full Day",
      regularHours: index === 1 ? "4" : "8",
      overtimeHours: index === 0 ? "2" : "0",
    })),
    clientMutationId: id(),
  });
  await manager.jp.attendance.approve({
    siteId: siteA,
    workDate: day(-1),
    shiftCode: "GEN",
    overtime: "approve",
    clientMutationId: id(),
  });
  await supervisor.jp.attendance.mark({
    siteId: siteA,
    workDate: day(0),
    shiftCode: "GEN",
    entries: engagements.map((engagementId) => ({
      engagementId,
      status: "Full Day",
      regularHours: "8",
      overtimeHours: "0",
    })),
    clientMutationId: id(),
  });

  // Safety and quality issues.
  const issue = await supervisor.jp.issues.create({
    siteId: siteA,
    category: "Safety Hazard",
    severity: "High",
    title: "Missing edge protection at first floor slab",
    description: "Open slab edge on the north side without guard rails.",
    locationLabel: "Block 1, north edge",
    immediateAction: "Area barricaded with tape, workers moved away.",
    clientMutationId: id(),
  });
  await manager.jp.issues.assign({
    issueId: issue.id,
    ownerUserId: userId("supervisor"),
    targetDate: day(1),
    note: "Install guard rails before any work on the slab.",
    clientMutationId: id(),
  });
  await supervisor.jp.issues.create({
    siteId: siteB,
    category: "Quality Defect",
    severity: "Medium",
    title: "Honeycombing in plinth beam",
    description: "Visible honeycombing on the plinth beam near gate.",
    clientMutationId: id(),
  });

  // Suppliers, bills and a payment.
  const supplier = await accounts.jp.finance.createVendor({
    siteId: siteA,
    vendorType: "Material Supplier",
    legalName: "Kalinga Building Materials Pvt Ltd",
    tradeName: "Kalinga Materials",
    contactName: "Bikash Mohanty",
    phone: "+91 90000 00001",
    paymentTermsDays: 30,
    clientMutationId: id(),
  });
  const transporter = await accounts.jp.finance.createVendor({
    siteId: siteA,
    vendorType: "Transporter",
    legalName: "Odisha Road Carriers",
    contactName: "Manoj Das",
    clientMutationId: id(),
  });
  const bill = await supervisor.jp.finance.createInvoice({
    siteId: siteA,
    vendorId: supplier.id,
    invoiceNumber: "KBM-2026-118",
    invoiceDate: day(-6),
    dueDate: day(24),
    taxRupees: "15120",
    chargesRupees: "1500",
    items: [
      {
        description: "OPC 53 grade cement",
        quantity: "200",
        unitCode: "bag",
        lineTotalRupees: "84000",
      },
    ],
    action: "Submitted",
    clientMutationId: id(),
  });
  await manager.jp.finance.reviewInvoice({
    siteId: siteA,
    invoiceId: bill.id,
    decision: "Approved",
    clientMutationId: id(),
  });
  await supervisor.jp.finance.createInvoice({
    siteId: siteA,
    vendorId: transporter.id,
    invoiceNumber: "ORC-771",
    invoiceDate: day(-2),
    taxRupees: "0",
    chargesRupees: "0",
    items: [
      {
        description: "Cement transport, 2 trips",
        quantity: "2",
        unitCode: "trip",
        lineTotalRupees: "6400",
      },
    ],
    action: "Submitted",
    clientMutationId: id(),
  });
  const payment = await accounts.jp.finance.payments.createPayment({
    siteId: siteA,
    vendorId: supplier.id,
    paymentDate: day(-1),
    amountRupees: "50000",
    paymentMode: "Bank Transfer",
    paidByName: "JP Infracon accounts",
    fundingSourceLabel: "Current account",
    category: "Material",
    purpose: "Part payment for cement bill KBM-2026-118",
    externalReference: "UTR 2026110100045",
    allocations: [{ invoiceId: bill.id, amountRupees: "50000" }],
    clientMutationId: id(),
  });
  await accounts.jp.finance.payments.submitPayment({
    siteId: siteA,
    paymentId: payment.id,
    clientMutationId: id(),
  });

  // Petty cash: a fund held by the supervisor, funded, with one expense waiting for review.
  const fund = await accounts.jp.finance.pettyCash.createFund({
    siteId: siteA,
    name: "Patia site cash",
    custodianUserId: userId("supervisor"),
    authorizedLimitRupees: "25000",
    reconciliationPeriod: "Weekly",
    clientMutationId: id(),
  });
  await supervisor.jp.finance.pettyCash.acknowledgeFund({
    siteId: siteA,
    fundId: fund.id,
    clientMutationId: id(),
  });
  const funding = await accounts.jp.finance.pettyCash.createMovement({
    siteId: siteA,
    fundId: fund.id,
    movementType: "Funding",
    amountRupees: "20000",
    movementDate: day(-5),
    paymentMode: "Cash",
    payeeName: "Demo Supervisor",
    paidByName: "Demo Accountant",
    fundingSource: "Company cash issue",
    category: "Site imprest",
    purpose: "Weekly site imprest for small purchases",
    receiptReference: "Cash voucher CV-101",
    clientMutationId: id(),
  });
  await accounts.jp.finance.pettyCash.submitMovement({
    siteId: siteA,
    movementId: funding.id,
    clientMutationId: id(),
  });
  await owner.jp.finance.pettyCash.reviewMovement({
    siteId: siteA,
    movementId: funding.id,
    decision: "Approved",
    reason: "Within the weekly limit",
    clientMutationId: id(),
  });
  await owner.jp.finance.pettyCash.postMovement({
    siteId: siteA,
    movementId: funding.id,
    clientMutationId: id(),
  });
  const expense = await supervisor.jp.finance.pettyCash.createMovement({
    siteId: siteA,
    fundId: fund.id,
    movementType: "Expense",
    amountRupees: "1850",
    movementDate: day(-1),
    paymentMode: "Cash",
    payeeName: "Local hardware store",
    paidByName: "Demo Supervisor",
    expenseFundingSource: "Site Petty Cash",
    fundSourceAttested: true,
    category: "Consumables",
    purpose: "Binding wire and nails for shuttering",
    receiptReference: "Bill 3321",
    clientMutationId: id(),
  });
  await supervisor.jp.finance.pettyCash.submitMovement({
    siteId: siteA,
    movementId: expense.id,
    clientMutationId: id(),
  });
}
