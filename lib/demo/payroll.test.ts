import { beforeAll, describe, expect, it, vi } from "vitest";

// Payroll and accounts end to end over the demo SQLite database (never the shared MySQL):
// pay details → approval → pay run from approved attendance → deductions → maker-checker →
// paid → statutory dues and deposits, GST and project profit.
vi.mock("../../server/db", () => import("./server/db"));
vi.mock("../../server/_core/sdk", () => import("./server/sdk"));
vi.mock("../../server/storage", () => import("./server/storage"));

const { setDemoDriver } = await import("./runtime");
const { createNodeDriver } = await import("./testing/node-driver");
const { ensureDemoData } = await import("./backend");
const { signIn, mutationId } = await import("./seed");
const { previousMonth } = await import("../jp/payroll-domain");

type Caller = Awaited<ReturnType<typeof signIn>>;
let owner: Caller, manager: Caller, supervisor: Caller, accounts: Caller, auditor: Caller;
let store: Caller;
let siteId = "";
const today = new Date().toISOString().slice(0, 10);
const payMonth = previousMonth(today);

describe("payroll and accounts", () => {
  beforeAll(async () => {
    await setDemoDriver(createNodeDriver());
    await ensureDemoData();
    [owner, manager, supervisor, accounts, auditor, store] = await Promise.all(
      ["owner", "manager", "supervisor", "accounts", "auditor", "store"].map(signIn),
    );
    siteId = (await owner.jp.workspace.mySites()).find((s) => s.code === "PATIA-A")!.id;
  }, 120_000);

  it("sample pay run: exact PF, ESI and net, paid, with payslip data", async () => {
    const { runs } = await owner.jp.payroll.runs({ siteId });
    const run = runs.find((row) => row.month === payMonth)!;
    expect(run).toMatchObject({
      status: "Paid",
      runNumber: `PR-PATIA-A-${payMonth.replace("-", "")}`,
    });
    const sheet = await owner.jp.payroll.run({ siteId, runId: run.id });
    const by = (name: string) => sheet.lines.find((line) => line.name.startsWith(name))!;
    // Monthly ₹18,000 basic + ₹4,000 HRA: PF 12% of ₹18,000; ₹22,000 is above the ESI limit.
    expect(by("Anil")).toMatchObject({
      payType: "Monthly",
      grossMinor: "2200000",
      pfEmployeeMinor: "216000",
      esiEmployeeMinor: "0",
      netMinor: "1984000",
      employerEpsMinor: "149900",
      employerEpfMinor: "66100",
      uan: "100200300402",
    });
    const ramesh = by("Ramesh");
    expect(ramesh.payType).toBe("Daily");
    expect(ramesh.workedDaysHundredths).toBeGreaterThanOrEqual(500);
    // 2 approved overtime hours at twice ₹106.25 an hour.
    expect(ramesh.overtimeMinor).toBe("42500");
    expect(BigInt(ramesh.pfEmployeeMinor)).toBe(
      (((BigInt(ramesh.basicMinor) * 12n) / 100n + 50n) / 100n) * 100n,
    );
    expect(by("Sunita").advanceMinor).toBe("50000");
    expect(by("Prakash").warnings.join(" ")).toMatch(/No payroll profile/);
    expect(sheet.can).toMatchObject({ edit: false, review: false, pay: false });
    const total = sheet.lines.reduce((sum, line) => sum + BigInt(line.netMinor), 0n);
    expect(sheet.run.netMinor).toBe(total.toString());
  });

  it("pay details need a different person to approve them", async () => {
    const people = await accounts.jp.payroll.people({ siteId });
    const prakash = people.people.find((p) => p.name.startsWith("Prakash"))!;
    expect(prakash.pending).toMatchObject({ status: "Pending", canReview: false });
    await expect(
      accounts.jp.payroll.reviewProfile({
        siteId,
        profileId: prakash.pending!.id,
        action: "approve",
        clientMutationId: mutationId(),
      }),
    ).rejects.toThrow(/payroll.approve|different person/);
    const inbox = await manager.jp.workspace.inbox();
    expect(inbox.items.some((item) => item.kind === "payroll.profile")).toBe(true);
    await expect(
      accounts.jp.payroll.saveProfile({
        siteId,
        personId: prakash.id,
        payType: "Monthly",
        pfMember: true,
        esiMember: true,
        ptApplies: false,
        uan: "123",
        effectiveFrom: today,
        clientMutationId: mutationId(),
      }),
    ).rejects.toThrow(/UAN/);
    await expect(
      accounts.jp.payroll.saveProfile({
        siteId,
        personId: prakash.id,
        payType: "Daily",
        basicRupees: "500",
        pfMember: false,
        esiMember: true,
        ptApplies: false,
        effectiveFrom: today,
        clientMutationId: mutationId(),
      }),
    ).rejects.toThrow(/attendance/);
  });

  it("one run per site and month; nothing for a future month", async () => {
    await expect(
      accounts.jp.payroll.create({ siteId, month: payMonth, clientMutationId: mutationId() }),
    ).rejects.toThrow(/already covers/);
    const next = new Date();
    next.setUTCMonth(next.getUTCMonth() + 2, 1);
    await expect(
      accounts.jp.payroll.create({
        siteId,
        month: next.toISOString().slice(0, 7),
        clientMutationId: mutationId(),
      }),
    ).rejects.toThrow(/not started/);
  });

  it("this month: unapproved attendance blocks submit; maker-checker; deductions recomputed", async () => {
    const month = today.slice(0, 7);
    const preview = await accounts.jp.payroll.preview({ siteId, month });
    expect(preview.monthNotOver).toBe(true);
    const created = await accounts.jp.payroll.create({
      siteId,
      month,
      clientMutationId: mutationId(),
    });
    const sheet = await accounts.jp.payroll.run({ siteId, runId: created.id });
    expect(sheet.can.edit).toBe(true);
    if (sheet.unapprovedAttendance > 0)
      await expect(
        accounts.jp.payroll.transition({
          siteId,
          runId: created.id,
          action: "submit",
          clientMutationId: mutationId(),
        }),
      ).rejects.toThrow(/not approved yet/);
    // Approve today's attendance, then refresh picks it up.
    await manager.jp.attendance
      .approve({
        siteId,
        workDate: today,
        shiftCode: "GEN",
        overtime: "approve",
        clientMutationId: mutationId(),
      })
      .catch(() => null);
    await accounts.jp.payroll.refresh({
      siteId,
      runId: created.id,
      clientMutationId: mutationId(),
    });
    const fresh = await accounts.jp.payroll.run({ siteId, runId: created.id });
    expect(fresh.unapprovedAttendance).toBe(0);
    const anil = fresh.lines.find((line) => line.name.startsWith("Anil"))!;
    // Too large an advance is dropped with a warning, never a negative net.
    const big = await accounts.jp.payroll.updateLine({
      siteId,
      runId: created.id,
      lineId: anil.id,
      advanceRupees: "99999",
      clientMutationId: mutationId(),
    });
    expect(big.warnings.join(" ")).toMatch(/removed/);
    await expect(
      accounts.jp.payroll.updateLine({
        siteId,
        runId: created.id,
        lineId: anil.id,
        otherDeductionRupees: "100",
        clientMutationId: mutationId(),
      }),
    ).rejects.toThrow(/what the other deduction/);
    await accounts.jp.payroll.updateLine({
      siteId,
      runId: created.id,
      lineId: anil.id,
      paidDays: "15",
      tdsRupees: "200",
      clientMutationId: mutationId(),
    });
    const half = (await accounts.jp.payroll.run({ siteId, runId: created.id })).lines.find(
      (line) => line.id !== "" && line.name.startsWith("Anil"),
    )!;
    const days = Number(
      new Date(Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5)), 0)).getUTCDate(),
    );
    const expectedBasic =
      (1_800_000n * 1500n * 2n + BigInt(days) * 100n) / (BigInt(days) * 100n * 2n);
    expect(half.basicMinor).toBe(expectedBasic.toString());
    expect(half.tdsMinor).toBe("20000");
    // Supervisor cannot prepare; the maker cannot approve their own run.
    await expect(
      supervisor.jp.payroll.updateLine({
        siteId,
        runId: created.id,
        lineId: anil.id,
        clientMutationId: mutationId(),
      }),
    ).rejects.toThrow();
    await accounts.jp.payroll.transition({
      siteId,
      runId: created.id,
      action: "submit",
      clientMutationId: mutationId(),
    });
    await expect(
      accounts.jp.payroll.transition({
        siteId,
        runId: created.id,
        action: "approve",
        clientMutationId: mutationId(),
      }),
    ).rejects.toThrow();
    expect((await owner.jp.workspace.inbox()).items.some((i) => i.kind === "payroll.review")).toBe(
      true,
    );
    await expect(
      manager.jp.payroll.transition({
        siteId,
        runId: created.id,
        action: "return",
        clientMutationId: mutationId(),
      }),
    ).rejects.toThrow(/reason/);
    await manager.jp.payroll.transition({
      siteId,
      runId: created.id,
      action: "return",
      reason: "Check Anil's paid days",
      clientMutationId: mutationId(),
    });
    await accounts.jp.payroll.transition({
      siteId,
      runId: created.id,
      action: "cancel",
      reason: "Will redo at month end",
      clientMutationId: mutationId(),
    });
    expect((await accounts.jp.payroll.run({ siteId, runId: created.id })).run.status).toBe(
      "Cancelled",
    );
  });

  it("accounts: PF deposited, ESI and contractor TDS due; deposits checked and reversible", async () => {
    const overview = await accounts.jp.books.overview();
    const pf = overview.dues.find((d) => d.kind === "PF" && d.period === payMonth)!;
    expect(pf).toMatchObject({ state: "Paid", outstandingMinor: "0" });
    const esi = overview.dues.find((d) => d.kind === "ESI" && d.period === payMonth)!;
    expect(BigInt(esi.outstandingMinor)).toBeGreaterThan(0n);
    expect(esi.dueDate).toBe(`${today.slice(0, 7)}-15`);
    // RA-01 of the sample work order deducted TDS ₹769.73.
    const tds = overview.dues.find((d) => d.kind === "TDS contractor")!;
    expect(BigInt(tds.dueMinor)).toBeGreaterThanOrEqual(76_973n);
    expect(BigInt(overview.payableMinor)).toBeGreaterThan(0n);
    expect(overview.can.manage).toBe(true);
    await expect(
      accounts.jp.books.recordDeposit({
        kind: "ESI",
        period: payMonth,
        amountRupees: "100",
        paidOn: today,
        challan: "",
        clientMutationId: mutationId(),
      }),
    ).rejects.toThrow(/challan/);
    const key = mutationId();
    const esiRupees = `${BigInt(esi.outstandingMinor) / 100n}.${String(BigInt(esi.outstandingMinor) % 100n).padStart(2, "0")}`;
    const deposit = await accounts.jp.books.recordDeposit({
      kind: "ESI",
      period: payMonth,
      amountRupees: esiRupees,
      paidOn: today,
      challan: "ESIC 9988",
      clientMutationId: key,
    });
    const again = await accounts.jp.books.recordDeposit({
      kind: "ESI",
      period: payMonth,
      amountRupees: esiRupees,
      paidOn: today,
      challan: "ESIC 9988",
      clientMutationId: key,
    });
    expect(again.id).toBe(deposit.id);
    let after = await accounts.jp.books.overview();
    expect(after.dues.find((d) => d.kind === "ESI" && d.period === payMonth)!.state).toBe("Paid");
    await accounts.jp.books.reverseDeposit({
      depositId: deposit.id,
      reason: "Entered against the wrong month",
      clientMutationId: mutationId(),
    });
    after = await accounts.jp.books.overview();
    expect(after.dues.find((d) => d.kind === "ESI" && d.period === payMonth)!.state).not.toBe(
      "Paid",
    );
  });

  it("GST summary and project profit come from approved records", async () => {
    const overview = await owner.jp.books.overview();
    expect(overview.gst.length).toBeGreaterThan(0);
    for (const row of overview.gst)
      expect(BigInt(row.netMinor)).toBe(BigInt(row.outputMinor) - BigInt(row.inputMinor));
    const profit = await owner.jp.books.profit();
    const project = profit.find((row) => BigInt(row.totalCostMinor) > 0n)!;
    expect(BigInt(project.costs.Staff)).toBeGreaterThan(0n);
    expect(BigInt(project.costs.Subcontract)).toBeGreaterThan(0n);
    expect(BigInt(project.profitMinor)).toBe(
      BigInt(project.revenueMinor) - BigInt(project.totalCostMinor),
    );
  });

  it("who can see what", async () => {
    await expect(auditor.jp.payroll.runs({ siteId })).resolves.toBeTruthy();
    await expect(auditor.jp.books.overview()).resolves.toMatchObject({ can: { manage: false } });
    await expect(
      auditor.jp.books.recordDeposit({
        kind: "PF",
        period: payMonth,
        amountRupees: "1",
        paidOn: today,
        challan: "X123",
        clientMutationId: mutationId(),
      }),
    ).rejects.toThrow(/accounts.manage/);
    await expect(supervisor.jp.payroll.runs({ siteId })).rejects.toThrow();
    await expect(store.jp.books.overview()).rejects.toThrow();
    await expect(manager.jp.books.overview()).rejects.toThrow();
    const settings = await accounts.jp.payroll.settings({ siteId });
    expect(settings).toMatchObject({ isDefault: true, canEdit: true });
    expect(settings.current.pfWageCeilingMinor).toBe("2500000");
  });

  it("dated rates: a new ceiling applies from its date; bad slabs refused", async () => {
    const base = {
      pfWageCeilingRupees: "25000",
      pfEmployeePercent: "12",
      pfEmployerPercent: "12",
      epsPercent: "8.33",
      epsCeilingRupees: "25000",
      edliPercent: "0.5",
      pfAdminPercent: "0.5",
      esiThresholdRupees: "21000",
      esiEmployeePercent: "0.75",
      esiEmployerPercent: "3.25",
      overtimeTimes: "2",
      wageSharePercent: "50",
    };
    await expect(
      owner.jp.payroll.saveSettings({
        ...base,
        effectiveFrom: "2026-04-01",
        ptSlabs: "25000: 125\n10000: 0",
        clientMutationId: mutationId(),
      }),
    ).rejects.toThrow(/Professional tax/);
    await owner.jp.payroll.saveSettings({
      ...base,
      effectiveFrom: "2026-04-01",
      ptSlabs: "13304: 0\n25000: 125\nabove: 200",
      note: "Test slabs",
      clientMutationId: mutationId(),
    });
    const settings = await manager.jp.payroll.settings({ siteId });
    expect(settings.isDefault).toBe(false);
    expect(settings.current.ptSlabs).toBe("13304: 0\n25000: 125\nabove: 200");
    expect(settings.canEdit).toBe(false);
  });
});
