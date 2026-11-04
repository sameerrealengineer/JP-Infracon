import { describe, expect, it } from "vitest";
import {
  checkDelivery,
  lowestQuote,
  matchBills,
  poTotals,
  receiptState,
  toLedgerQuantity,
} from "./purchase-domain";

describe("purchase domain", () => {
  it("totals a PO with GST per line", () => {
    // 100 bags × ₹410 @18% + 2.5 t TMT × ₹62,000 @18%
    expect(
      poTotals([
        { quantityThousandths: 100_000n, rateMinor: 41_000n, gstBps: 1800 },
        { quantityThousandths: 2_500n, rateMinor: 6_200_000n, gstBps: 1800 },
      ]),
    ).toEqual({ subtotalMinor: 19_600_000n, gstMinor: 3_528_000n, totalMinor: 23_128_000n });
  });

  it("knows how much has arrived", () => {
    expect(receiptState([{ orderedThousandths: 10n, receivedThousandths: 0n }])).toBe(
      "Not received",
    );
    expect(
      receiptState([
        { orderedThousandths: 10n, receivedThousandths: 10n },
        { orderedThousandths: 5n, receivedThousandths: 2n },
      ]),
    ).toBe("Part received");
    expect(receiptState([{ orderedThousandths: 10n, receivedThousandths: 10n }])).toBe("Received");
  });

  it("checks a delivery against what is still due, and needs a reason to reject", () => {
    const base = {
      description: "Cement",
      orderedThousandths: 100_000n,
      alreadyReceivedThousandths: 60_000n,
    };
    expect(
      checkDelivery({ ...base, acceptedThousandths: 40_000n, rejectedThousandths: 0n }),
    ).toBeNull();
    expect(
      checkDelivery({ ...base, acceptedThousandths: 41_000n, rejectedThousandths: 0n })?.code,
    ).toBe("OVER_ORDER");
    expect(
      checkDelivery({ ...base, acceptedThousandths: 30_000n, rejectedThousandths: 5_000n })?.code,
    ).toBe("REASON");
    expect(
      checkDelivery({
        ...base,
        acceptedThousandths: 30_000n,
        rejectedThousandths: 5_000n,
        rejectReason: "Bags torn",
      }),
    ).toBeNull();
    expect(checkDelivery({ ...base, acceptedThousandths: 0n, rejectedThousandths: 0n })?.code).toBe(
      "EMPTY",
    );
  });

  it("finds the lowest quote", () => {
    expect(
      lowestQuote([
        { name: "A", totalMinor: 500n },
        { name: "B", totalMinor: 420n },
        { name: "C", totalMinor: 610n },
      ])?.name,
    ).toBe("B");
    expect(lowestQuote([])).toBeNull();
  });

  it("matches bills against the value received", () => {
    const lines = [
      {
        quantityThousandths: 100_000n,
        rateMinor: 41_000n,
        gstBps: 1800,
        receivedThousandths: 60_000n,
      },
    ];
    // 60 bags × 410 × 1.18 = ₹29,028
    expect(matchBills({ lines, billedMinor: 2_902_800n, hasBills: true })).toMatchObject({
      receivedValueMinor: 2_902_800n,
      state: "Matches",
    });
    expect(matchBills({ lines, billedMinor: 3_420_000n, hasBills: true }).state).toBe(
      "Billed more than received",
    );
    expect(matchBills({ lines, billedMinor: 0n, hasBills: false }).state).toBe("No bill yet");
  });

  it("writes ledger quantities with three decimals", () => {
    expect(toLedgerQuantity(12_500n)).toBe("12.500");
    expect(toLedgerQuantity(7n)).toBe("0.007");
  });
});
