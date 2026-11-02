import { describe, expect, it } from "vitest";

import {
  displayQuantity,
  MAX_DPR_ITEMS,
  normalizeDprItem,
  normalizeDprItems,
  progressPercent,
  suggestCumulative,
  validateDprItems,
} from "./dpr-domain";

describe("progressPercent", () => {
  it("divides exactly and rounds down to two decimals", () => {
    expect(progressPercent("250", "1000")).toBe("25.00");
    expect(progressPercent("1", "3")).toBe("33.33");
    expect(progressPercent("0.5", "2")).toBe("25.00");
  });

  it("is empty without a planned quantity or with zero scope", () => {
    expect(progressPercent("10", null)).toBeNull();
    expect(progressPercent(null, "10")).toBeNull();
    expect(progressPercent("10", "0")).toBeNull();
  });

  it("never shows more than 100", () => {
    expect(progressPercent("12", "10")).toBe("100.00");
  });
});

describe("suggestCumulative", () => {
  it("adds today's work to the last cumulative without float drift", () => {
    expect(suggestCumulative("0.1", "0.2")).toBe("0.3");
    expect(suggestCumulative("120.5", "30")).toBe("150.5");
  });

  it("starts from today's work when nothing was reported before", () => {
    expect(suggestCumulative(null, "45")).toBe("45");
  });

  it("keeps the previous value when nothing was done today", () => {
    expect(suggestCumulative("80", "")).toBe("80");
    expect(suggestCumulative(null, null)).toBeNull();
  });
});

describe("normalizeDprItem", () => {
  const base = { description: "Plastering, first floor", unitCode: "sqft" };

  it("normalises quantities and works out the estimate", () => {
    expect(
      normalizeDprItem(
        {
          ...base,
          plannedQuantity: "1000.000",
          completedQuantityToday: " 250 ",
          cumulativeQuantity: "400",
          locationLabel: "  ",
        },
        1,
      ),
    ).toEqual({
      taskId: null,
      workItemCode: null,
      description: "Plastering, first floor",
      locationLabel: null,
      unitCode: "sqft",
      plannedQuantity: "1000",
      completedQuantityToday: "250",
      cumulativeQuantity: "400",
      estimatedPercent: "40.00",
      remarks: null,
    });
  });

  it("accepts a description-only line", () => {
    expect(normalizeDprItem({ description: "Site cleaning" }, 2).unitCode).toBeNull();
  });

  it("needs a unit once any quantity is given", () => {
    expect(() => normalizeDprItem({ description: "Brickwork", plannedQuantity: "10" }, 3)).toThrow(
      "Line 3: choose a unit",
    );
  });

  it("rejects cumulative below today's quantity", () => {
    expect(() =>
      normalizeDprItem({ ...base, completedQuantityToday: "50", cumulativeQuantity: "40" }, 1),
    ).toThrow("cumulative cannot be less");
  });

  it("rejects cumulative above the planned scope", () => {
    expect(() =>
      normalizeDprItem({ ...base, plannedQuantity: "100", cumulativeQuantity: "100.001" }, 1),
    ).toThrow("Record a variation");
  });

  it("rejects bad numbers and empty descriptions", () => {
    expect(() => normalizeDprItem({ ...base, plannedQuantity: "-5" }, 4)).toThrow("Line 4 planned");
    expect(() => normalizeDprItem({ ...base, plannedQuantity: "1.2345" }, 4)).toThrow("3 decimal");
    expect(() => normalizeDprItem({ description: " " }, 5)).toThrow("Line 5: describe");
  });
});

describe("normalizeDprItems", () => {
  it("limits the number of lines", () => {
    const many = Array.from({ length: MAX_DPR_ITEMS + 1 }, () => ({ description: "Work" }));
    expect(() => normalizeDprItems(many)).toThrow(`up to ${MAX_DPR_ITEMS}`);
  });

  it("numbers errors by position", () => {
    expect(() => normalizeDprItems([{ description: "Work" }, { description: "" }])).toThrow(
      "Line 2",
    );
  });
});

describe("validateDprItems", () => {
  it("returns normalised lines or a typed error", () => {
    expect(validateDprItems([{ description: "Work" }]).error).toBeNull();
    expect(validateDprItems([{ description: "x" }]).error).toEqual({
      code: "DPR_ITEM_INVALID",
      message: "Line 1: describe the work done.",
    });
  });
});

describe("displayQuantity", () => {
  it("drops trailing zeros from stored quantities", () => {
    expect(displayQuantity("1000.000")).toBe("1000");
    expect(displayQuantity("12.500")).toBe("12.5");
    expect(displayQuantity(7)).toBe("7");
    expect(displayQuantity(null)).toBe("");
  });
});
