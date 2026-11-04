import { describe, expect, it } from "vitest";
import {
  ageingBucket,
  billPaymentState,
  billTotals,
  checkCumulativeQuantity,
  checkReceipt,
  formatPercent,
  formatQuantity,
  leadStageChange,
  lineAmountMinor,
  nextNumber,
  parsePercentBps,
  parseQuantity,
  quotationTotals,
} from "./billing-domain";

describe("billing domain", () => {
  it("parses quantities and percentages exactly", () => {
    expect(parseQuantity("12.5")).toBe(12_500n);
    expect(parseQuantity("0")).toBeNull();
    expect(parseQuantity("1.2345")).toBeNull();
    expect(formatQuantity(12_500n)).toBe("12.5");
    expect(parsePercentBps("18")).toBe(1800);
    expect(parsePercentBps("2.5")).toBe(250);
    expect(parsePercentBps("101")).toBeNull();
    expect(formatPercent(250)).toBe("2.5%");
  });

  it("computes line amounts and quotation GST in paise", () => {
    // 12.5 cum × ₹5,400.00 = ₹67,500.00
    expect(lineAmountMinor(12_500n, 540_000n)).toBe(6_750_000n);
    // 0.333 × ₹1.00 = 33.3 paise → 33
    expect(lineAmountMinor(333n, 100n)).toBe(33n);
    expect(
      quotationTotals(
        [
          { quantityThousandths: 10_000n, rateMinor: 100_000n },
          { quantityThousandths: 1_000n, rateMinor: 55n },
        ],
        1800,
      ),
    ).toEqual({ subtotalMinor: 1_000_055n, gstMinor: 180_010n, totalMinor: 1_180_065n });
  });

  it("RA bill: GST on work value, retention and TDS on work value only", () => {
    const totals = billTotals({
      lines: [{ quantityThousandths: 100_000n, rateMinor: 100_000n }], // ₹1,00,000 work
      gstBps: 1800,
      retentionBps: 500,
      tdsBps: 200,
      otherDeductionMinor: 100_000n, // ₹1,000
    });
    expect(totals).toEqual({
      workValueMinor: 10_000_000n,
      gstMinor: 1_800_000n,
      grossMinor: 11_800_000n,
      retentionMinor: 500_000n,
      tdsMinor: 200_000n,
      otherDeductionMinor: 100_000n,
      netReceivableMinor: 11_000_000n,
    });
  });

  it("stops billing past the contract quantity", () => {
    expect(
      checkCumulativeQuantity({
        description: "PCC M15",
        contractQuantity: 100_000n,
        previouslyBilled: 80_000n,
        thisBill: 20_000n,
      }),
    ).toBeNull();
    expect(
      checkCumulativeQuantity({
        description: "PCC M15",
        contractQuantity: 100_000n,
        previouslyBilled: 80_000n,
        thisBill: 20_001n,
      })?.code,
    ).toBe("OVER_CONTRACT");
  });

  it("derives payment status from receipts and refuses over-receipts", () => {
    expect(billPaymentState(1000n, 0n).paymentStatus).toBe("Unpaid");
    expect(billPaymentState(1000n, 400n)).toMatchObject({
      paymentStatus: "Part paid",
      outstandingMinor: 600n,
    });
    expect(billPaymentState(1000n, 1000n).paymentStatus).toBe("Paid");
    expect(checkReceipt(700n, 600n)?.code).toBe("OVER_RECEIPT");
    expect(checkReceipt(0n, 600n)?.code).toBe("AMOUNT");
    expect(checkReceipt(600n, 600n)).toBeNull();
  });

  it("lead stages: lost needs a reason, closed leads only reopen", () => {
    expect(leadStageChange("New", "Site visit")).toBeNull();
    expect(leadStageChange("Negotiation", "Lost")?.code).toBe("REASON");
    expect(leadStageChange("Negotiation", "Lost", "Rate too high")).toBeNull();
    expect(leadStageChange("Won", "Negotiation")?.code).toBe("CLOSED");
    expect(leadStageChange("Lost", "Contacted")).toBeNull();
  });

  it("ageing buckets and numbering", () => {
    expect(ageingBucket("2026-10-20", "2026-11-04")).toBe("0–30 days");
    expect(ageingBucket("2026-07-01", "2026-11-04")).toBe("Over 90 days");
    expect(nextNumber("QT-2026-", ["QT-2026-0007", "QT-2026-0002", "RA-1"])).toBe("QT-2026-0008");
    expect(nextNumber("RA-PATIA-", [], 2)).toBe("RA-PATIA-01");
  });
});
