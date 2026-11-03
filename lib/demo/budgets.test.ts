import { randomUUID } from "node:crypto";
import { beforeAll, describe, expect, it, vi } from "vitest";

// Runs the real budget procedures over the demo's SQLite database (never the shared MySQL).
vi.mock("../../server/db", () => import("./server/db"));
vi.mock("../../server/_core/sdk", () => import("./server/sdk"));
vi.mock("../../server/storage", () => import("./server/storage"));

const { setDemoDriver } = await import("./runtime");
const { createNodeDriver } = await import("./testing/node-driver");
const { ensureDemoData } = await import("./backend");
const { signIn } = await import("./seed");

type Caller = Awaited<ReturnType<typeof signIn>>;
const mutationId = () => `test-${randomUUID()}`;

let owner: Caller, director: Caller, supervisor: Caller, auditor: Caller;
let projectId: string;

describe("project budget", () => {
  beforeAll(async () => {
    await setDemoDriver(createNodeDriver());
    await ensureDemoData();
    [owner, director, supervisor, auditor] = await Promise.all(
      ["owner", "director", "supervisor", "auditor"].map(signIn),
    );
    const options = await owner.jp.budgets.options();
    projectId = options.projects[0].id;
    expect(options.projects[0]).toMatchObject({ canManage: true, canApprove: true });
  }, 120_000);

  it("is hidden from a supervisor and read-only for an auditor", async () => {
    expect((await supervisor.jp.budgets.options()).projects).toHaveLength(0);
    await expect(supervisor.jp.budgets.overview({ projectId })).rejects.toThrow(/budget/);
    const view = await auditor.jp.budgets.overview({ projectId });
    expect(view.canManage).toBe(false);
    await expect(
      auditor.jp.budgets.propose({
        projectId,
        contractValueMinor: null,
        lines: [{ costHead: "Labour", amountMinor: "100" }],
        clientMutationId: mutationId(),
      }),
    ).rejects.toThrow(/budget/);
  });

  it("is proposed by one person and approved by another, then compared with spend", async () => {
    const before = await owner.jp.budgets.overview({ projectId });
    expect(before.current).toBeNull();
    const id = mutationId();
    const input = {
      projectId,
      contractValueMinor: "500000000",
      lines: [
        { costHead: "Materials" as const, amountMinor: "200000000" },
        { costHead: "Labour" as const, amountMinor: "100000000" },
        { costHead: "Site expenses" as const, amountMinor: "5000000" },
      ],
      clientMutationId: id,
    };
    const created = await owner.jp.budgets.propose(input);
    expect(await owner.jp.budgets.propose(input)).toEqual(created);
    expect(created.revisionNumber).toBe(1);

    await expect(
      owner.jp.budgets.propose({ ...input, clientMutationId: mutationId() }),
    ).rejects.toThrow(/already waiting/);
    const ownView = await owner.jp.budgets.overview({ projectId });
    expect(ownView.proposed?.totalMinor).toBe("305000000");
    expect(ownView.canApprove).toBe(false);
    await expect(
      owner.jp.budgets.review({
        budgetId: created.id,
        decision: "Approve",
        clientMutationId: mutationId(),
      }),
    ).rejects.toThrow(/Another person/);

    const decision = mutationId();
    await director.jp.budgets.review({
      budgetId: created.id,
      decision: "Approve",
      clientMutationId: decision,
    });
    expect(
      await director.jp.budgets.review({
        budgetId: created.id,
        decision: "Approve",
        clientMutationId: decision,
      }),
    ).toEqual({ id: created.id, status: "Approved" });

    const view = await auditor.jp.budgets.overview({ projectId });
    expect(view.current).toMatchObject({ revisionNumber: 1, contractValueMinor: "500000000" });
    expect(view.proposed).toBeNull();
    expect(view.comparison.totals.budgetMinor).toBe("305000000");
    expect(view.margins.plannedMinor).toBe("195000000");
    const spentTotal = view.comparison.heads.reduce(
      (sum, head) => sum + BigInt(head.actualMinor) + BigInt(head.pendingMinor),
      0n,
    );
    // The demo has bills, attendance and petty cash, so some spend shows up.
    expect(spentTotal).toBeGreaterThan(0n);
    expect(view.sites.length).toBeGreaterThan(0);
  });

  it("needs a reason to revise, and a reason to reject", async () => {
    const lines = [{ costHead: "Materials" as const, amountMinor: "250000000" }];
    await expect(
      owner.jp.budgets.propose({
        projectId,
        contractValueMinor: "500000000",
        lines,
        clientMutationId: mutationId(),
      }),
    ).rejects.toThrow(/reason/);
    const revision = await owner.jp.budgets.propose({
      projectId,
      contractValueMinor: "500000000",
      lines,
      reason: "Steel rate went up",
      clientMutationId: mutationId(),
    });
    expect(revision.revisionNumber).toBe(2);
    await expect(
      director.jp.budgets.review({
        budgetId: revision.id,
        decision: "Reject",
        clientMutationId: mutationId(),
      }),
    ).rejects.toThrow(/reason/);
    await director.jp.budgets.review({
      budgetId: revision.id,
      decision: "Reject",
      reason: "Attach the new steel quotation",
      clientMutationId: mutationId(),
    });
    const view = await owner.jp.budgets.overview({ projectId });
    expect(view.current?.revisionNumber).toBe(1);
    expect(view.history.map((row) => row.status)).toEqual(["Rejected", "Approved"]);
  });

  it("supersedes the old budget when a revision is approved; the proposer may withdraw", async () => {
    const withdrawn = await owner.jp.budgets.propose({
      projectId,
      contractValueMinor: null,
      lines: [{ costHead: "Other", amountMinor: "100" }],
      reason: "Test",
      clientMutationId: mutationId(),
    });
    await expect(
      director.jp.budgets.review({
        budgetId: withdrawn.id,
        decision: "Withdraw",
        clientMutationId: mutationId(),
      }),
    ).rejects.toThrow();
    await owner.jp.budgets.review({
      budgetId: withdrawn.id,
      decision: "Withdraw",
      clientMutationId: mutationId(),
    });
    const next = await director.jp.budgets.propose({
      projectId,
      contractValueMinor: "520000000",
      lines: [
        { costHead: "Materials", amountMinor: "220000000" },
        { costHead: "Labour", amountMinor: "100000000" },
      ],
      reason: "Extra floor slab",
      clientMutationId: mutationId(),
    });
    await owner.jp.budgets.review({
      budgetId: next.id,
      decision: "Approve",
      clientMutationId: mutationId(),
    });
    const view = await owner.jp.budgets.overview({ projectId });
    expect(view.current).toMatchObject({
      revisionNumber: next.revisionNumber,
      totalMinor: "320000000",
    });
    expect(view.history.find((row) => row.revisionNumber === 1)?.status).toBe("Superseded");
  });
});
