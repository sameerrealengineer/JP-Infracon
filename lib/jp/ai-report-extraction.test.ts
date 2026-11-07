import { describe, expect, it } from "vitest";

import { cleanQuantity, normalizeReportFields, reportPrompt } from "./ai-report-extraction";

const tasks = [{ id: "t-1", title: "Internal plaster" }];

describe("cleanQuantity", () => {
  it("keeps digits and drops units, commas and words", () => {
    expect(cleanQuantity("250 sq ft")).toBe("250");
    expect(cleanQuantity("1,200.5")).toBe("1200.5");
    expect(cleanQuantity(12)).toBe("12");
    expect(cleanQuantity("about twenty")).toBe("");
    expect(cleanQuantity(null)).toBe("");
  });
});

describe("normalizeReportFields", () => {
  it("maps a spoken DPR to safe draft fields and the site's own task", () => {
    const fields = normalizeReportFields(
      {
        title: "Plastering first floor",
        weather: "rain",
        siteStatus: "Delayed",
        notes: "Rain stopped work for two hours. Mason 12, Helper 8.",
        workLines: [
          {
            task: "internal PLASTER",
            description: "Internal plaster",
            location: "First floor",
            unit: "sqft",
            doneToday: "250 sqft",
          },
          { task: "Made up task", description: "Brickwork", unit: "cum", doneToday: "3" },
        ],
      },
      "DPR",
      tasks,
    );
    expect(fields).toMatchObject({
      title: "Plastering first floor",
      weatherCode: "Rain",
      overallStatus: "Delayed",
      remarks: "Rain stopped work for two hours. Mason 12, Helper 8.",
      warnings: [],
    });
    expect(fields.items[0]).toMatchObject({
      taskId: "t-1",
      unitCode: "sqft",
      completedQuantityToday: "250",
    });
    expect(fields.items[1].taskId).toBeNull();
  });

  it("keeps a doubtful line but warns about it", () => {
    const fields = normalizeReportFields(
      { title: "Work", workLines: [{ description: "Brickwork", doneToday: "10" }] },
      "DPR",
      tasks,
    );
    expect(fields.items).toHaveLength(1);
    expect(fields.warnings).toEqual(["Line 1: choose a unit for the quantities."]);
  });

  it("ignores unknown enum values and junk", () => {
    const fields = normalizeReportFields(
      { title: 42, weather: "Snow", siteStatus: "Great", workLines: "not a list" },
      "DPR",
      tasks,
    );
    expect(fields.weatherCode).toBeNull();
    expect(fields.overallStatus).toBeNull();
    expect(fields.items).toEqual([]);
    expect(fields.title).toBe("42");
    expect(normalizeReportFields(null, "DPR", tasks).title).toBe("");
  });

  it("never fills work lines on a labour report", () => {
    const fields = normalizeReportFields(
      { title: "Labour", notes: "Mason 5", workLines: [{ description: "Plaster" }] },
      "DLR",
      tasks,
    );
    expect(fields.items).toEqual([]);
    expect(fields.remarks).toBe("Mason 5");
  });
});

describe("reportPrompt", () => {
  it("lists the site's tasks and forbids invented facts", () => {
    const prompt = reportPrompt("DPR", ["Internal plaster"]);
    expect(prompt).toContain('"Internal plaster"');
    expect(prompt).toContain("Do not invent");
    expect(reportPrompt("DLR", [])).toContain("Leave workLines empty");
  });
});
