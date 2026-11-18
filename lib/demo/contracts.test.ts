import { beforeAll, describe, expect, it, vi } from "vitest";

// Tenders, guarantees and extensions of time over the demo database through the real procedures.
vi.mock("../../server/db", () => import("./server/db"));
vi.mock("../../server/_core/sdk", () => import("./server/sdk"));
vi.mock("../../server/storage", () => import("./server/storage"));

const { setDemoDriver } = await import("./runtime");
const { createNodeDriver } = await import("./testing/node-driver");
const { ensureDemoData } = await import("./backend");
const { signIn, mutationId } = await import("./seed");

type Caller = Awaited<ReturnType<typeof signIn>>;
let owner: Caller, accounts: Caller, supervisor: Caller;
const today = new Date(Date.now() + 330 * 60_000).toISOString().slice(0, 10);
const plus = (n: number) =>
  new Date(Date.parse(`${today}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);

describe("tenders and contracts", () => {
  beforeAll(async () => {
    await setDemoDriver(createNodeDriver());
    await ensureDemoData();
    [owner, accounts, supervisor] = await Promise.all(
      ["owner", "accounts", "supervisor"].map(signIn),
    );
  }, 120_000);

  it("keeps a tender through to a result, forward only", async () => {
    const t = await owner.jp.contracts.createTender({
      nitNumber: "RWSS/BAM/12/2026-27",
      department: "RWSS Division, Berhampur",
      workName: "Repainting of 10 OHTs in Sheragada block",
      estimateRupees: "2500000",
      bidDueDate: plus(5),
      clientMutationId: mutationId(),
    });
    expect(t.code).toMatch(/^TND-\d{4}-\d{3}$/);
    await owner.jp.contracts.moveTender({ id: t.id, to: "Submitted" });
    await expect(owner.jp.contracts.moveTender({ id: t.id, to: "Won" })).rejects.toThrow(/cannot/);
    await owner.jp.contracts.moveTender({
      id: t.id,
      to: "Opened",
      quotedRupees: "2375000",
      rank: "L1",
    });
    await expect(owner.jp.contracts.moveTender({ id: t.id, to: "Lost" })).rejects.toThrow(/reason/);
    const view = await owner.jp.contracts.overview();
    const row = view.tenders.find((x) => x.id === t.id)!;
    expect(row.quotedPercent).toBe(-5);
    expect(row.status).toBe("Opened");
  });

  it("tracks guarantees, expiry and EMD to recover; only an approver may mark encashed", async () => {
    const lost = await owner.jp.contracts.createTender({
      nitNumber: "NIT-2",
      department: "PWD",
      workName: "Boundary wall",
      clientMutationId: mutationId(),
    });
    await owner.jp.contracts.moveTender({ id: lost.id, to: "Submitted" });
    await owner.jp.contracts.moveTender({ id: lost.id, to: "Opened" });
    await owner.jp.contracts.moveTender({ id: lost.id, to: "Lost", resultNote: "L3" });
    await accounts.jp.contracts.addGuarantee({
      tenderId: lost.id,
      kind: "EMD",
      instrument: "Online (e-payment)",
      amountRupees: "50000",
      issueDate: today,
      clientMutationId: mutationId(),
    });
    await expect(
      accounts.jp.contracts.addGuarantee({
        kind: "Performance guarantee",
        instrument: "Bank guarantee",
        amountRupees: "100000",
        issueDate: today,
        clientMutationId: mutationId(),
      }),
    ).rejects.toThrow(/expiry/);
    const bg = await accounts.jp.contracts.addGuarantee({
      kind: "Performance guarantee",
      instrument: "Bank guarantee",
      bankName: "SBI Aska",
      amountRupees: "125000",
      issueDate: today,
      expiryDate: plus(20),
      clientMutationId: mutationId(),
    });
    let view = await owner.jp.contracts.overview();
    expect(view.summary.emdToRecover).toBe("5000000");
    expect(view.guarantees.find((g) => g.id === bg.id)!.state).toBe("Expiring");
    expect(view.summary.expiringSoon).toBeGreaterThanOrEqual(1);
    await expect(
      accounts.jp.contracts.closeGuarantee({
        id: bg.id,
        status: "Encashed",
        closedOn: today,
        note: "Department encashed",
      }),
    ).rejects.toThrow();
    await accounts.jp.contracts.renewGuarantee({
      id: bg.id,
      expiryDate: plus(400),
      note: "Extended, bank letter 55",
    });
    view = await owner.jp.contracts.overview();
    expect(view.guarantees.find((g) => g.id === bg.id)!.state).toBe("Active");
    await owner.jp.contracts.closeGuarantee({
      id: bg.id,
      status: "Released",
      closedOn: today,
      note: "Released after DLP",
    });
  });

  it("records an extension of time and the new completion date", async () => {
    const view = await owner.jp.contracts.overview();
    const projectId = view.projects[0]!.id;
    const ext = await owner.jp.contracts.addExtension({
      projectId,
      stipulatedCompletion: "2026-12-31",
      requestedDays: 60,
      basis: "Drawing delay HIN-001, rain HIN-002",
      requestDate: today,
      clientMutationId: mutationId(),
    });
    await owner.jp.contracts.decideExtension({
      id: ext.id,
      status: "Granted",
      grantedDays: 45,
      decisionDate: today,
    });
    const after = await owner.jp.contracts.overview();
    expect(after.extensions.find((e) => e.id === ext.id)!.newCompletion).toBe("2027-02-14");
  });

  it("keeps supervisors out", async () => {
    await expect(supervisor.jp.contracts.overview()).rejects.toThrow(/contract.view/);
  });
});
