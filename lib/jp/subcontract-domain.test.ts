import { describe, expect, it } from "vitest";
import {
  advanceRecovery,
  billLinesFrom,
  checkMeasurement,
  measuredQuantity,
  subBillTotals,
  workOrderPosition,
} from "./subcontract-domain";

describe("measuredQuantity", () => {
  it("multiplies the dimensions given, rounded to 3 decimals", () => {
    // 2 nos × 4.5 m × 0.23 m × 3.05 m = 6.3135 m³ → 6.314 (half up)
    expect(measuredQuantity({ nos: "2", length: "4.5", breadth: "0.23", depth: "3.05" })).toBe(
      6314n,
    );
    expect(measuredQuantity({ length: "12.5" })).toBe(12500n);
    expect(measuredQuantity({ nos: "3", length: "2.4", breadth: "" })).toBe(7200n);
  });

  it("refuses bad or empty input", () => {
    expect(measuredQuantity({})).toMatch(/at least one/);
    expect(measuredQuantity({ length: "-2" })).toMatch(/Length/);
    expect(measuredQuantity({ length: "abc" })).toMatch(/Length/);
    expect(measuredQuantity({ length: "0.001", breadth: "0.001" })).toMatch(/rounds to 0/);
  });
});

describe("checkMeasurement", () => {
  const base = { description: "Brickwork", orderedThousandths: 100_000n };
  it("allows up to the work-order quantity", () => {
    expect(
      checkMeasurement({
        ...base,
        measuredSoFarThousandths: 60_000n,
        quantityThousandths: 40_000n,
      }),
    ).toBeNull();
  });
  it("refuses going past it or deducting more than measured", () => {
    expect(
      checkMeasurement({ ...base, measuredSoFarThousandths: 60_000n, quantityThousandths: 40_001n })
        ?.code,
    ).toBe("OVER_ORDER");
    expect(
      checkMeasurement({ ...base, measuredSoFarThousandths: 1_000n, quantityThousandths: -2_000n })
        ?.code,
    ).toBe("OVER_DEDUCTION");
  });
});

describe("subBillTotals", () => {
  it("works GST, retention and TDS on the work value and nets the deductions", () => {
    const totals = subBillTotals({
      workValueMinor: 10_000_000n, // ₹1,00,000
      gstBps: 1800,
      retentionBps: 500,
      tdsBps: 100,
      advanceRecoveryMinor: 1_000_000n,
      otherDeductionMinor: 50_000n,
    });
    expect(totals).toMatchObject({
      gstMinor: 1_800_000n,
      retentionMinor: 500_000n,
      tdsMinor: 100_000n,
      // 1,00,000 + 18,000 − 5,000 − 1,000 − 10,000 − 500 = 1,01,500
      netPayableMinor: 10_150_000n,
    });
  });
});

describe("advanceRecovery", () => {
  it("takes the agreed share, capped at what is outstanding", () => {
    expect(
      advanceRecovery({
        advanceMinor: 5_000_000n,
        recoveredSoFarMinor: 0n,
        workValueMinor: 10_000_000n,
        recoveryBps: 2000,
      }),
    ).toBe(2_000_000n);
    expect(
      advanceRecovery({
        advanceMinor: 5_000_000n,
        recoveredSoFarMinor: 4_000_000n,
        workValueMinor: 10_000_000n,
        recoveryBps: 2000,
      }),
    ).toBe(1_000_000n);
    expect(
      advanceRecovery({
        advanceMinor: 5_000_000n,
        recoveredSoFarMinor: 5_000_000n,
        workValueMinor: 10_000_000n,
        recoveryBps: 2000,
      }),
    ).toBe(0n);
  });
});

describe("billLinesFrom", () => {
  it("adds measurements per item, deductions included, at the work-order rate", () => {
    const lines = billLinesFrom(
      [
        { id: "a", rateMinor: 650_000n },
        { id: "b", rateMinor: 12_000n },
      ],
      [
        { itemId: "a", quantityThousandths: 6_314n },
        { itemId: "a", quantityThousandths: -314n },
        { itemId: "b", quantityThousandths: 0n },
      ],
    );
    expect(lines).toEqual([
      { itemId: "a", quantityThousandths: 6_000n, rateMinor: 650_000n, amountMinor: 3_900_000n },
    ]);
  });
});

describe("workOrderPosition", () => {
  it("reports value, done, billed and retention still held", () => {
    const position = workOrderPosition({
      items: [{ quantityThousandths: 100_000n, rateMinor: 100_000n, measuredThousandths: 25_000n }],
      approvedBills: [
        { workValueMinor: 2_000_000n, retentionMinor: 100_000n, netPayableMinor: 2_200_000n },
      ],
      retentionReleasedMinor: 40_000n,
    });
    expect(position).toEqual({
      valueMinor: 10_000_000n,
      measuredValueMinor: 2_500_000n,
      billedValueMinor: 2_000_000n,
      netPayableMinor: 2_200_000n,
      retentionHeldMinor: 60_000n,
      progressBps: 2500,
    });
  });
});
