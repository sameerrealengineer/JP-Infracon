import { describe, expect, it } from "vitest";
import {
  checkDeposit,
  costHeadForSupplier,
  dueDate,
  duesAgainstDeposits,
  gstSummary,
  projectPnl,
} from "./accounts-domain";

describe("due dates", () => {
  it("PF and ESI on the 15th, TDS on the 7th, March TDS on 30 April", () => {
    expect(dueDate("PF", "2026-10")).toBe("2026-11-15");
    expect(dueDate("ESI", "2026-12")).toBe("2027-01-15");
    expect(dueDate("TDS contractor", "2026-10")).toBe("2026-11-07");
    expect(dueDate("TDS salary", "2027-03")).toBe("2027-04-30");
    expect(dueDate("PT", "2026-10")).toBe("2026-11-30");
  });
});

describe("dues against deposits", () => {
  it("nets deposits off dues and flags what is overdue", () => {
    const lines = duesAgainstDeposits(
      [
        { kind: "PF", period: "2026-09", amountMinor: 50_000n },
        { kind: "PF", period: "2026-09", amountMinor: 10_000n },
        { kind: "ESI", period: "2026-10", amountMinor: 8_000n },
        { kind: "TDS contractor", period: "2026-08", amountMinor: 7_000n },
      ],
      [
        { kind: "PF", period: "2026-09", amountMinor: 20_000n },
        { kind: "TDS contractor", period: "2026-08", amountMinor: 7_000n },
        { kind: "PT", period: "2026-07", amountMinor: 500n },
      ],
      "2026-11-05",
    );
    expect(lines.map((l) => [l.kind, l.period, l.state, l.outstandingMinor])).toEqual([
      ["PF", "2026-09", "Overdue", 40_000n],
      ["ESI", "2026-10", "Due", 8_000n],
      ["PT", "2026-07", "Excess", -500n],
      ["TDS contractor", "2026-08", "Paid", 0n],
    ]);
  });
  it("checks a deposit entry", () => {
    const ok = {
      amountMinor: 100n,
      period: "2026-10",
      paidOn: "2026-11-04",
      challan: "TRRN123",
      today: "2026-11-05",
    };
    expect(checkDeposit(ok)).toBeNull();
    expect(checkDeposit({ ...ok, amountMinor: 0n })?.code).toBe("AMOUNT");
    expect(checkDeposit({ ...ok, period: "2026-12" })?.code).toBe("PERIOD");
    expect(checkDeposit({ ...ok, paidOn: "2026-11-06" })?.code).toBe("DATE");
    expect(checkDeposit({ ...ok, paidOn: "2026-09-30" })?.code).toBe("DATE");
    expect(checkDeposit({ ...ok, challan: " " })?.code).toBe("CHALLAN");
  });
});

describe("GST and profit", () => {
  it("summarises GST per month with credit when input is larger", () => {
    const rows = gstSummary(
      [
        { date: "2026-10-31", taxMinor: 18_000n },
        { date: "2026-09-30", taxMinor: 5_000n },
      ],
      [
        { date: "2026-10-02", taxMinor: 6_000n },
        { date: "2026-09-12", taxMinor: 9_000n },
      ],
    );
    expect(rows).toEqual([
      { month: "2026-10", outputMinor: 18_000n, inputMinor: 6_000n, netMinor: 12_000n },
      { month: "2026-09", outputMinor: 5_000n, inputMinor: 9_000n, netMinor: -4_000n },
    ]);
  });
  it("works out project profit and margin", () => {
    const pnl = projectPnl(1_000_000n, {
      Material: 400_000n,
      Subcontract: 250_000n,
      Staff: 100_000n,
    });
    expect(pnl.totalCostMinor).toBe(750_000n);
    expect(pnl.profitMinor).toBe(250_000n);
    expect(pnl.marginBps).toBe(2500);
    expect(projectPnl(0n, { Material: 1n }).marginBps).toBeNull();
    expect(costHeadForSupplier("Subcontractor")).toBe("Subcontract");
    expect(costHeadForSupplier("Material Supplier")).toBe("Material");
    expect(costHeadForSupplier("Transporter")).toBe("Other");
  });
});
