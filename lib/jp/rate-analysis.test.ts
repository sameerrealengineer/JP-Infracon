import { describe, expect, it } from "vitest";
import { analyseRate, estimateAbstract, thousandths } from "./rate-analysis";

const rcc = {
  material: "5200",
  labour: "1500",
  plant: "300",
  waterPct: "1",
  overheadProfitPct: "15",
};

describe("rate analysis and estimate", () => {
  it("builds a rate: base + 1% water + 15% overhead and profit, exact paise", () => {
    const r = analyseRate(rcc);
    expect(r.base).toBe(700000n);
    expect(r.water).toBe(7000n);
    expect(r.overhead).toBe(106050n);
    expect(r.rate).toBe(813050n); // ₹8,130.50 per m³
  });

  it("makes the abstract with contingency and GST", () => {
    const abstract = estimateAbstract(
      [{ description: "RCC M20", unit: "m³", quantity: "12.5", rate: rcc }],
      "3",
      "18",
    );
    expect(abstract.subtotal).toBe(10163125n);
    expect(abstract.contingency).toBe(304894n);
    expect(abstract.total).toBe(abstract.subtotal + abstract.contingency + abstract.gst);
  });

  it("reads quantities to three decimals and refuses bad input", () => {
    expect(thousandths("2.5")).toBe(2500n);
    expect(() => thousandths("2.5555")).toThrow();
    expect(() => analyseRate({ ...rcc, material: "abc" })).toThrow(/Material/);
  });
});
