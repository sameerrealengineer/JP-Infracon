import { randomUUID } from "node:crypto";
import { beforeAll, describe, expect, it, vi } from "vitest";

// Runs the real report procedures over the demo's SQLite database (never the shared MySQL).
vi.mock("../../server/db", () => import("./server/db"));
vi.mock("../../server/_core/sdk", () => import("./server/sdk"));
vi.mock("../../server/storage", () => import("./server/storage"));

const { setDemoDriver } = await import("./runtime");
const { createNodeDriver } = await import("./testing/node-driver");
const { ensureDemoData } = await import("./backend");
const { signIn } = await import("./seed");

type Caller = Awaited<ReturnType<typeof signIn>>;
const mutationId = () => `test-${randomUUID()}`;

let manager: Caller, supervisor: Caller;
let siteA: string, siteB: string, taskA: string, taskB: string;

describe("daily progress report lines and corrections", () => {
  beforeAll(async () => {
    await setDemoDriver(createNodeDriver());
    await ensureDemoData();
    [manager, supervisor] = await Promise.all(["manager", "supervisor"].map(signIn));
    const sites = await manager.jp.workspace.mySites();
    siteA = sites.find((site) => site.code === "PATIA-A")!.id;
    siteB = sites.find((site) => site.code === "KGIRI-B")!.id;
    taskA = (await manager.jp.tasks.list({ siteId: siteA }))[0].id;
    taskB = (await manager.jp.tasks.list({ siteId: siteB }))[0]?.id ?? randomUUID();
  }, 120_000);

  it("saves progress lines with the estimate worked out on the server", async () => {
    const created = await supervisor.jp.reports.createDraft({
      siteId: siteA,
      reportKind: "DPR",
      reportDate: "2026-01-15",
      title: "Plastering, first floor",
      weatherCode: "Cloudy",
      overallStatus: "On track",
      clientMutationId: mutationId(),
      items: [
        {
          taskId: taskA,
          description: "Internal plaster",
          locationLabel: "First floor",
          unitCode: "sqft",
          plannedQuantity: "1000",
          completedQuantityToday: "250",
          cumulativeQuantity: "250",
        },
        { description: "Site cleaning" },
      ],
    });
    const detail = await supervisor.jp.reports.detail({ reportId: created.id });
    expect(detail.canEdit).toBe(true);
    expect(detail.report.weatherCode).toBe("Cloudy");
    expect(detail.items).toHaveLength(2);
    const plaster = detail.items.find((item) => item.description === "Internal plaster")!;
    expect(String(plaster.estimatedPercent)).toMatch(/^25(\.0+)?$/);
    expect(plaster.taskId).toBe(taskA);
  });

  it("keeps a DPR and a DLR for the same site, day and shift apart", async () => {
    const dlr = await supervisor.jp.reports.createDraft({
      siteId: siteA,
      reportKind: "DLR",
      reportDate: "2026-01-15",
      title: "Labour on site",
      clientMutationId: mutationId(),
    });
    expect(dlr.reportKind).toBe("DLR");
  });

  it("rejects work beyond the planned scope and tasks from another site", async () => {
    const base = {
      siteId: siteA,
      reportKind: "DPR" as const,
      reportDate: "2026-01-16",
      title: "Brickwork",
    };
    await expect(
      supervisor.jp.reports.createDraft({
        ...base,
        clientMutationId: mutationId(),
        items: [
          {
            description: "Brickwork",
            unitCode: "cum",
            plannedQuantity: "10",
            cumulativeQuantity: "12",
          },
        ],
      }),
    ).rejects.toThrow("Record a variation");
    await expect(
      supervisor.jp.reports.createDraft({
        ...base,
        clientMutationId: mutationId(),
        items: [{ taskId: taskB, description: "Wrong site task" }],
      }),
    ).rejects.toThrow(/not on this site|permission|access/i);
    await expect(
      supervisor.jp.reports.createDraft({
        ...base,
        reportKind: "DLR",
        clientMutationId: mutationId(),
        items: [{ description: "Not for labour" }],
      }),
    ).rejects.toThrow("attendance");
  });

  it("offers yesterday's cumulative for the next report", async () => {
    const context = await supervisor.jp.reports.progressContext({ siteId: siteA });
    expect(context.tasks.some((task) => task.id === taskA)).toBe(true);
    const last = context.lastLines.find((line) => line.taskId === taskA)!;
    expect(String(last.cumulativeQuantity)).toMatch(/^250(\.0+)?$/);
    expect(last.unitCode).toBe("sqft");
  });

  it("lets only the writer correct a returned report, then resubmit it", async () => {
    const created = await supervisor.jp.reports.createDraft({
      siteId: siteA,
      reportKind: "DPR",
      reportDate: "2026-01-17",
      title: "Shuttering",
      clientMutationId: mutationId(),
      items: [{ description: "Column shuttering" }],
    });
    await supervisor.jp.reports.submit({ reportId: created.id });
    const update = {
      reportId: created.id,
      title: "Shuttering (corrected)",
      items: [{ description: "Column shuttering", unitCode: "sqm", completedQuantityToday: "40" }],
    };
    await expect(supervisor.jp.reports.updateDraft(update)).rejects.toThrow("draft or a returned");

    await manager.jp.reports.review({
      reportId: created.id,
      decision: "Returned for Correction",
      reason: "Add the area done today.",
    });
    await expect(manager.jp.reports.updateDraft(update)).rejects.toThrow(
      /wrote this report|permission/i,
    );
    await supervisor.jp.reports.updateDraft(update);
    const detail = await supervisor.jp.reports.detail({ reportId: created.id });
    expect(detail.report.title).toBe("Shuttering (corrected)");
    expect(detail.items).toHaveLength(1);
    expect(detail.items[0].unitCode).toBe("sqm");

    await supervisor.jp.reports.submit({ reportId: created.id });
    expect((await supervisor.jp.reports.detail({ reportId: created.id })).canEdit).toBe(false);
  });
});
