import { beforeAll, describe, expect, it, vi } from "vitest";

// Worker khaata end to end over the demo SQLite database (never the shared MySQL): advances
// approved by a different person, recovered once through pay runs, repayments, the worker's
// paid/due position, and the PF ECR / ESIC upload files.
vi.mock("../../server/db", () => import("./server/db"));
vi.mock("../../server/_core/sdk", () => import("./server/sdk"));
vi.mock("../../server/storage", () => import("./server/storage"));

const { setDemoDriver } = await import("./runtime");
const { createNodeDriver } = await import("./testing/node-driver");
const { ensureDemoData } = await import("./backend");
const { signIn, mutationId } = await import("./seed");
const { previousMonth } = await import("../jp/payroll-domain");

type Caller = Awaited<ReturnType<typeof signIn>>;
let owner: Caller, manager: Caller, supervisor: Caller, accounts: Caller, store: Caller;
let siteId = "";
const today = new Date().toISOString().slice(0, 10);
const payMonth = previousMonth(today);
const personNamed = async (name: string) =>
  (await accounts.jp.advances.list({ siteId })).people.find((p) => p.name.startsWith(name))!;

describe("worker khaata", () => {
  beforeAll(async () => {
    await setDemoDriver(createNodeDriver());
    await ensureDemoData();
    [owner, manager, supervisor, accounts, store] = await Promise.all(
      ["owner", "manager", "supervisor", "accounts", "store"].map(signIn),
    );
    siteId = (await owner.jp.workspace.mySites()).find((s) => s.code === "PATIA-A")!.id;
  }, 120_000);

  it("sample: Sunita's advance recovered once by the paid run; paid and due shown", async () => {
    const sunita = await personNamed("Sunita");
    expect(sunita).toMatchObject({
      advanceGivenMinor: "100000",
      advanceRecoveredMinor: "50000",
      advanceOutstandingMinor: "50000",
    });
    expect(BigInt(sunita.paidMinor!)).toBeGreaterThan(0n);
    const anil = await personNamed("Anil");
    expect(anil.paidMinor).toBe("1984000");
    const detail = await owner.jp.advances.person({ siteId, personId: sunita.id });
    expect(detail.runs[0]).toMatchObject({
      month: payMonth,
      status: "Paid",
      deductionMinor: "50000",
    });
    expect(detail.entries[0]).toMatchObject({ entryType: "Advance", status: "Approved" });
  });

  it("a supervisor asks for advances but does not see wages, and cannot approve their own", async () => {
    const list = await supervisor.jp.advances.list({ siteId });
    expect(list.can).toMatchObject({ wages: false, request: true, approve: false });
    expect(list.people[0].paidMinor).toBeNull();
    expect(list.totals.dueMinor).toBeNull();
    const ramesh = list.pending.find((row) => row.personName.startsWith("Ramesh"))!;
    expect(ramesh).toMatchObject({ canReview: false, canCancel: true });
    await expect(
      supervisor.jp.advances.review({
        siteId,
        entryId: ramesh.id,
        action: "approve",
        clientMutationId: mutationId(),
      }),
    ).rejects.toThrow(/payroll.approve/);
    expect(
      (await manager.jp.workspace.inbox()).items.some((i) => i.kind === "payroll.advance"),
    ).toBe(true);
    await expect(store.jp.advances.list({ siteId })).rejects.toThrow();
    await expect(
      supervisor.jp.advances.request({
        siteId,
        personId: ramesh.personId,
        entryType: "Advance",
        amountRupees: "500",
        entryDate: today,
        mode: "UPI",
        reason: "Travel",
        clientMutationId: mutationId(),
      }),
    ).rejects.toThrow(/reference/);
  });

  it("repayments cannot pass what is left; a manual deduction cannot recover money not given", async () => {
    const sunita = await personNamed("Sunita");
    await expect(
      accounts.jp.advances.request({
        siteId,
        personId: sunita.id,
        entryType: "Repayment",
        amountRupees: "600",
        entryDate: today,
        mode: "Cash",
        reason: "Paid back",
        clientMutationId: mutationId(),
      }),
    ).rejects.toThrow(/more than the advance/);
    // This month's draft run suggests the ₹500 installment by itself.
    const run = await accounts.jp.payroll.create({
      siteId,
      month: today.slice(0, 7),
      clientMutationId: mutationId(),
    });
    const sheet = await accounts.jp.payroll.run({ siteId, runId: run.id });
    const line = sheet.lines.find((l) => l.name.startsWith("Sunita"));
    if (line) {
      // ₹500 a month, or less when this month's pay so far is lower.
      expect(BigInt(line.advanceMinor)).toBeGreaterThan(0n);
      expect(BigInt(line.advanceMinor)).toBeLessThanOrEqual(50_000n);
      await expect(
        accounts.jp.payroll.updateLine({
          siteId,
          runId: run.id,
          lineId: line.id,
          advanceRupees: "600",
          clientMutationId: mutationId(),
        }),
      ).rejects.toThrow(/left to recover/);
    }
    const anil = sheet.lines.find((l) => l.name.startsWith("Anil"))!;
    await expect(
      accounts.jp.payroll.updateLine({
        siteId,
        runId: run.id,
        lineId: anil.id,
        advanceRupees: "100",
        clientMutationId: mutationId(),
      }),
    ).rejects.toThrow(/no advance to recover/);
    // While the draft plans to recover ₹500, a ₹500 cash repayment would recover it twice.
    if (line)
      await expect(
        accounts.jp.advances.request({
          siteId,
          personId: sunita.id,
          entryType: "Repayment",
          amountRupees: "500",
          entryDate: today,
          mode: "Cash",
          reason: "Paid back",
          clientMutationId: mutationId(),
        }),
      ).rejects.toThrow(/more than the advance/);
    await accounts.jp.payroll.transition({
      siteId,
      runId: run.id,
      action: "cancel",
      reason: "Test over",
      clientMutationId: mutationId(),
    });
    const repay = await accounts.jp.advances.request({
      siteId,
      personId: sunita.id,
      entryType: "Repayment",
      amountRupees: "500",
      entryDate: today,
      mode: "Cash",
      reason: "Paid back in cash",
      clientMutationId: mutationId(),
    });
    await manager.jp.advances.review({
      siteId,
      entryId: repay.id,
      action: "approve",
      clientMutationId: mutationId(),
    });
    expect((await personNamed("Sunita")).advanceOutstandingMinor).toBe("0");
  });

  it("makes the PF ECR and ESIC files from the paid run, listing who is left out", async () => {
    const { runs } = await accounts.jp.payroll.runs({ siteId });
    const run = runs.find((r) => r.month === payMonth && r.status === "Paid")!;
    const ecr = await accounts.jp.payroll.exportFile({ siteId, runId: run.id, kind: "ecr" });
    const lines = ecr.content.trim().split("\n");
    expect(ecr.fileName).toMatch(/-ECR\.txt$/);
    expect(lines).toHaveLength(2);
    for (const line of lines) expect(line.split("#~#")).toHaveLength(11);
    expect(lines.find((l) => l.includes("ANIL MOHANTY"))).toMatch(
      /^100200300402#~#ANIL MOHANTY#~#22000#~#18000#~#18000#~#18000#~#2160#~#1499#~#661#~#\d+#~#0$/,
    );
    // ESI members here have no IP number yet, so the file cannot be made and says why.
    await expect(
      accounts.jp.payroll.exportFile({ siteId, runId: run.id, kind: "esic" }),
    ).rejects.toThrow(/IP number/);
    await expect(
      store.jp.payroll.exportFile({ siteId, runId: run.id, kind: "ecr" }),
    ).rejects.toThrow();
  });
});
