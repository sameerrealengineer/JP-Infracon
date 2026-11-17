import { describe, expect, it } from "vitest";
import {
  CIVIL_TOOLS,
  NOMINAL_MIXES,
  concreteMaterials,
  defaultValues,
  percentOf,
  steelKgPerM,
  toolByKey,
} from "./civil-tools";

function out(key: string, values: Record<string, string> = {}) {
  const tool = toolByKey(key)!;
  const result = tool.compute({ ...defaultValues(tool), ...values });
  if (!result.ok) throw new Error(result.error);
  return Object.fromEntries(result.outputs.map((row) => [row.label, row.value]));
}

describe("civil tools", () => {
  it("has many tools with unique keys, and every tool works with its defaults", () => {
    expect(CIVIL_TOOLS.length).toBeGreaterThanOrEqual(29);
    expect(new Set(CIVIL_TOOLS.map((tool) => tool.key)).size).toBe(CIVIL_TOOLS.length);
    for (const tool of CIVIL_TOOLS) {
      const result = tool.compute(defaultValues(tool));
      expect(result.ok, tool.key).toBe(true);
    }
  });

  it("gives M20 materials for 1 m³ by the dry-volume method", () => {
    const m = concreteMaterials(1, NOMINAL_MIXES["M20 (1:1.5:3)"]!);
    expect(m.cementBags).toBeCloseTo(8.07, 2);
    expect(m.sandM3).toBeCloseTo(0.42, 2);
    expect(m.aggregateM3).toBeCloseTo(0.84, 2);
  });

  it("weighs steel as d²/162", () => {
    expect(steelKgPerM(12)).toBeCloseTo(0.889, 3);
    expect(steelKgPerM(16)).toBeCloseTo(1.58, 2);
    expect(out("steel-weight", { dia: "10", len: "12", n: "100" }).Total).toBe("740.74");
  });

  it("counts 500 bricks per m³ of wall", () => {
    const result = out("brickwork", { l: "10", h: "1", t: "0.1", open: "0", waste: "0" });
    expect(result.Bricks).toBe("500");
  });

  it("works out tank capacity and the triangle area", () => {
    expect(out("tank-capacity", { shape: "Circular", a: "6", h: "3" }).Capacity).toBe("84,823");
    expect(out("tank-capacity", { shape: "Rectangular", a: "2", b: "3", h: "1" }).Capacity).toBe(
      "6,000",
    );
    expect(out("triangle", { a: "3", b: "4", c: "5" }).Area).toBe("6");
    const bad = toolByKey("triangle")!.compute({ a: "1", b: "1", c: "5" });
    expect(bad.ok).toBe(false);
  });

  it("converts Odisha land and volume units", () => {
    expect(out("area-convert", { value: "1", unit: "Acre" }).Decimal).toBe("100");
    expect(out("area-convert", { value: "1", unit: "Decimal" }).sqft).toBe("435.6");
    expect(out("volume-convert", { value: "1", unit: "Brass" })["m³"]).toBe("2.832");
  });

  it("works out a works bill to the paisa", () => {
    const bill = out("bill-deductions", { value: "1000000" });
    expect(bill.GST).toBe("₹1,80,000.00");
    expect(bill["Gross bill"]).toBe("₹11,80,000.00");
    expect(bill["Net payable"]).toBe("₹10,80,000.00");
    expect(percentOf(333n, 18)).toBe(60n);
  });

  it("refuses empty or negative inputs with a plain message", () => {
    const result = toolByKey("concrete")!.compute({ l: "", b: "4", d: "0.1", n: "1", waste: "0" });
    expect(result).toEqual({ ok: false, error: "Enter Length." });
    const negative = toolByKey("concrete")!.compute({
      l: "-1",
      b: "4",
      d: "0.1",
      n: "1",
      waste: "0",
    });
    expect(negative.ok).toBe(false);
  });

  it("checks stair comfort and the bleaching powder dose", () => {
    const stair = out("staircase", { h: "3000", r: "150", t: "300", flights: "2" });
    expect(stair.Risers).toBe("20");
    expect(stair["2R + T"]).toContain("✓");
    // 1,00,000 L at 50 mg/L with 30% chlorine = 16.67 kg.
    expect(out("chlorination")["Bleaching powder"]).toBe("16.67");
  });
});
