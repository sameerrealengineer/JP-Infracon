import { randomUUID } from "node:crypto";
import { beforeAll, describe, expect, it, vi } from "vitest";

// The same swaps metro.config.js makes in the demo APK.
vi.mock("../../server/db", () => import("./server/db"));
vi.mock("../../server/_core/sdk", () => import("./server/sdk"));
vi.mock("../../server/storage", () => import("./server/storage"));

const { setDemoDriver } = await import("./runtime");
const { createNodeDriver } = await import("./testing/node-driver");
const { ensureDemoData } = await import("./backend");
const { signIn, callerFor } = await import("./seed");
const { exportKinds } = await import("../../server/jp/exports");

type Caller = Awaited<ReturnType<typeof signIn>>;
const id = () => `test-${randomUUID()}`;
const today = new Date().toISOString().slice(0, 10);
const monthAgo = new Date(Date.now() - 30 * 86_400_000).toISOString().slice(0, 10);

let owner: Caller,
  manager: Caller,
  supervisor: Caller,
  accounts: Caller,
  store: Caller,
  auditor: Caller;
let organizationId: string, siteA: string, siteB: string;

describe("offline demo: every screen and workflow runs on the phone database", () => {
  beforeAll(async () => {
    await setDemoDriver(createNodeDriver());
    await ensureDemoData();
    [owner, manager, supervisor, accounts, store, auditor] = await Promise.all(
      ["owner", "manager", "supervisor", "accounts", "store", "auditor"].map(signIn),
    );
    const sites = await owner.jp.workspace.mySites();
    siteA = sites.find((site) => site.code === "PATIA-A")!.id;
    siteB = sites.find((site) => site.code === "KGIRI-B")!.id;
    organizationId = (await owner.jp.accounts.options())[0].id;
  }, 120_000);

  it("home, inbox, sites and audit load for every role", async () => {
    for (const caller of [owner, manager, supervisor, accounts, store, auditor]) {
      await caller.jp.workspace.onboardingState();
      await caller.jp.workspace.dashboard();
      await caller.jp.workspace.inbox();
      await caller.jp.workspace.myCapabilities();
      await caller.jp.workspace.mySites();
      await caller.jp.delegation.mine();
      await caller.jp.notifications.preferences();
      await caller.jp.presence.myFences();
      await caller.jp.exports.options();
      await caller.jp.ai.status();
    }
    const dashboard = await manager.jp.workspace.dashboard();
    expect(dashboard.siteCount).toBe(2);
    expect(dashboard.reportsNeedingReview).toBeGreaterThan(0);
    expect((await owner.jp.workspace.auditEvents()).length).toBeGreaterThan(10);
  });

  it("site administration, accounts and invites", async () => {
    await owner.jp.sitesAdmin.overview();
    const detail = await owner.jp.sitesAdmin.siteDetail({ siteId: siteA });
    expect(detail).toBeTruthy();
    await owner.jp.sitesAdmin.assignmentCandidates({ siteId: siteA });
    expect((await owner.jp.accounts.list({ organizationId })).length).toBe(7);

    const invite = await owner.jp.accounts.createInvite({
      organizationId,
      inviteeName: "New Site Engineer",
      businessRole: "supervisor",
      siteId: siteB,
    });
    expect((await owner.jp.accounts.listInvites({ organizationId })).length).toBe(1);
    const guest = await callerFor(null);
    const joined = await guest.auth.registerWithInvite({
      code: invite.code,
      username: "engineer",
      password: "NewPassword@2026",
    });
    const engineer = await callerFor(joined.sessionToken);
    expect((await engineer.jp.workspace.mySites()).map((site) => site.id)).toEqual([siteB]);
  });

  it("schedule: list, history, reschedule preview and confirm", async () => {
    const tasks = await manager.jp.tasks.list({ siteId: siteA });
    expect(tasks.length).toBe(2);
    const task = tasks.find((row) => row.status === "In Progress")!;
    await manager.jp.tasks.history({ taskId: task.id });
    const later = new Date(Date.now() + 3 * 86_400_000).toISOString().slice(0, 10);
    const preview = await manager.jp.tasks.previewReschedule({
      taskId: task.id,
      newStartDate: later,
      strategy: "shift_dependents",
    });
    await manager.jp.tasks.reschedule({
      taskId: task.id,
      newStartDate: later,
      strategy: "shift_dependents",
      reasonCode: "weather_rain",
      expectedScheduleSnapshot: preview.scheduleSnapshot,
      clientMutationId: id(),
    });
  });

  it("reports and material requests", async () => {
    const reports = await manager.jp.reports.list({ siteId: siteA });
    expect(reports.length).toBe(2);
    expect((await supervisor.jp.materialRequests.list({ siteId: siteA })).length).toBe(1);
  });

  it("inventory: stock is derived from posted movements only", async () => {
    const stock = await manager.jp.inventory.list({ siteId: siteA });
    const cement = stock.catalogue.find((item) => item.itemCode === "CEM-OPC53")!;
    expect(Number(cement.onHand)).toBe(200); // the 40 bag issue is still waiting for review
    // The 40 bag issue, plus two goods-receipt inwards from the sample purchase order.
    expect(stock.pendingReviewCount).toBe(3);
    expect(
      stock.movements.filter(
        (row) => row.status === "Submitted" && row.movementType === "Receipt/Inward",
      ),
    ).toHaveLength(2);
    const pending = stock.movements.find(
      (row) => row.status === "Submitted" && row.movementType === "Issue/Consumption",
    )!;
    await manager.jp.inventory.reviewMovement({
      movementId: pending.id,
      decision: "Post",
      clientMutationId: id(),
    });
    const after = await store.jp.inventory.list({ siteId: siteA });
    expect(Number(after.catalogue.find((item) => item.itemCode === "CEM-OPC53")!.onHand)).toBe(160);
  });

  it("workforce, rates and attendance", async () => {
    expect((await supervisor.jp.workforce.list({ siteId: siteA })).length).toBe(3);
    await accounts.jp.workforce.rates({ siteId: siteA });
    const roster = await manager.jp.attendance.roster({
      siteId: siteA,
      workDate: today,
      shiftCode: "GEN",
    });
    expect(roster).toBeTruthy();
    await manager.jp.attendance.approve({
      siteId: siteA,
      workDate: today,
      shiftCode: "GEN",
      overtime: "approve",
      clientMutationId: id(),
    });
    const labour = await accounts.jp.attendance.labourSummary({
      siteId: siteA,
      from: monthAgo,
      to: today,
    });
    expect(labour).toBeTruthy();
  });

  it("issues: comment, resolve, close by a different person", async () => {
    const list = await manager.jp.issues.list({ siteId: siteA });
    const issue = list.rows.find((row) => row.severity === "High")!;
    await manager.jp.issues.owners({ siteId: siteA });
    await supervisor.jp.issues.comment({
      issueId: issue.id,
      note: "Guard rails ordered",
      clientMutationId: id(),
    });
    await supervisor.jp.issues.transition({
      issueId: issue.id,
      action: "start",
      note: "Work started on guard rails",
      clientMutationId: id(),
    });
    await supervisor.jp.issues.transition({
      issueId: issue.id,
      action: "resolve",
      note: "Guard rails fixed along the full edge",
      correctiveAction: "Guard rails installed",
      preventiveAction: "Edge protection added to the slab checklist",
      clientMutationId: id(),
    });
    await manager.jp.issues.transition({
      issueId: issue.id,
      action: "close",
      note: "Checked on site, rails secure",
      clientMutationId: id(),
    });
    const detail = await manager.jp.issues.detail({ issueId: issue.id });
    expect(detail.issue.status).toBe("Closed");
  });

  it("evidence: upload a photo and open it", async () => {
    const issue = (await supervisor.jp.issues.list({ siteId: siteB })).rows[0];
    // A 1 x 1 PNG.
    const png =
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
    const uploaded = await supervisor.jp.attachments.upload({
      entityType: "site_issue",
      entityId: issue.id,
      fileName: "plinth.png",
      base64: png,
      sourceType: "Selected from device",
      clientMutationId: id(),
    });
    const files = await manager.jp.attachments.list({
      entityType: "site_issue",
      entityId: issue.id,
    });
    expect(files.length).toBe(1);
    const opened = await manager.jp.attachments.open({ attachmentId: uploaded.id });
    expect(opened.contentType).toBe("image/png");
  });

  it("supplier bills and payments: review and post by different people", async () => {
    await accounts.jp.finance.listVendors({ siteId: siteA });
    const invoices = await accounts.jp.finance.listInvoices({ siteId: siteA });
    expect(invoices.rows.length).toBe(2);
    await accounts.jp.finance.invoiceDetail({ siteId: siteA, invoiceId: invoices.rows[0].id });
    const payments = await manager.jp.finance.payments.listPayments({ siteId: siteA });
    const payment = payments.rows[0];
    await manager.jp.finance.payments.paymentDetail({ siteId: siteA, paymentId: payment.id });
    await accounts.jp.finance.payments.listInvoiceCandidates({
      siteId: siteA,
      vendorId: payment.vendorId,
    });
    await manager.jp.finance.payments.reviewPayment({
      siteId: siteA,
      paymentId: payment.id,
      decision: "Approved",
      reason: "Matches the approved bill",
      clientMutationId: id(),
    });
    await owner.jp.finance.payments.postPayment({
      siteId: siteA,
      paymentId: payment.id,
      clientMutationId: id(),
    });
    const posted = await owner.jp.finance.payments.paymentDetail({
      siteId: siteA,
      paymentId: payment.id,
    });
    expect(posted.payment.status).toBe("Posted");
  });

  it("petty cash: balance follows posted movements", async () => {
    const funds = await accounts.jp.finance.pettyCash.listFunds({ siteId: siteA });
    const fund = funds.items[0];
    expect(fund.balanceMinor).toBe("2000000");
    await accounts.jp.finance.pettyCash.listCustodianCandidates({ siteId: siteA });
    await supervisor.jp.finance.pettyCash.listTaskOptions({ siteId: siteA });
    await supervisor.jp.finance.pettyCash.listReturnCandidates({ siteId: siteA, fundId: fund.id });
    const movements = await owner.jp.finance.pettyCash.listMovements({
      siteId: siteA,
      fundId: fund.id,
    });
    const expense = movements.items.find((row) => row.status === "Submitted")!;
    await owner.jp.finance.pettyCash.reviewMovement({
      siteId: siteA,
      movementId: expense.id,
      decision: "Approved",
      reason: "Receipt checked",
      clientMutationId: id(),
    });
    await owner.jp.finance.pettyCash.postMovement({
      siteId: siteA,
      movementId: expense.id,
      clientMutationId: id(),
    });
    const after = await accounts.jp.finance.pettyCash.listFunds({ siteId: siteA });
    expect(after.items[0].balanceMinor).toBe("1815000");
  });

  it("delegation: grant and revoke", async () => {
    const candidates = await owner.jp.delegation.candidates({ organizationId });
    const target = candidates.find((row) => row.name === "Demo Project Manager")!;
    const created = await owner.jp.delegation.create({
      organizationId,
      userId: target.userId,
      scopeType: "site",
      scopeId: siteA,
      bundles: ["site_operations"],
      duration: "1d",
      reason: "Covering while the owner travels",
      clientMutationId: id(),
    });
    expect((await owner.jp.delegation.list({ organizationId })).length).toBe(1);
    await owner.jp.delegation.revoke({
      delegationId: created.id,
      reason: "Back on site",
      clientMutationId: id(),
    });
  });

  it("exports: every kind produces a file", async () => {
    for (const kind of exportKinds) {
      const file = await owner.jp.exports.generate({ kind, from: monthAgo, to: today });
      expect(file.rowCount).toBeGreaterThanOrEqual(0);
    }
  });

  it("alerts settings and site arrival records", async () => {
    await supervisor.jp.notifications.updatePreferences({
      phone: "9000000001",
      whatsappOptIn: false,
      smsOptIn: false,
      pushOptIn: true,
    });
    await supervisor.jp.presence.record({
      siteId: siteA,
      eventType: "Arrived",
      latitude: 20.3533,
      longitude: 85.8266,
      accuracyM: 20,
      occurredAt: new Date(),
      clientMutationId: id(),
    });
    await manager.jp.presence.log({ siteId: siteA, date: today });
  });

  it("people management: reset a password and suspend an account", async () => {
    const people = await owner.jp.accounts.list({ organizationId });
    const auditorRow = people.find((row) => row.username === "auditor")!;
    await owner.jp.accounts.resetPassword({ organizationId, userId: auditorRow.id });
    await owner.jp.accounts.setStatus({
      organizationId,
      userId: auditorRow.id,
      status: "Suspended",
    });
    const guest = await callerFor(null);
    await expect(
      guest.auth.login({ username: "auditor", password: "JPDemo@12345" }),
    ).rejects.toThrow();
  });
});
