import { describe, expect, it } from "vitest";
import {
  advancePosition,
  checkAdvanceEntry,
  recoverableNow,
  suggestedDeduction,
  workerPosition,
  type LedgerEntry,
} from "./advance-domain";

const advance = (
  amount: bigint,
  installment: bigint,
  status = "Approved",
  date = "2026-10-05",
): LedgerEntry => ({
  entryType: "Advance",
  status,
  amountMinor: amount,
  installmentMinor: installment,
  entryDate: date,
});

describe("advance ledger", () => {
  it("counts an advance once: given, recovered by approved runs, repaid in cash", () => {
    const entries: LedgerEntry[] = [
      advance(300_000n, 100_000n),
      advance(50_000n, 0n, "Pending"),
      {
        entryType: "Repayment",
        status: "Approved",
        amountMinor: 20_000n,
        installmentMinor: 0n,
        entryDate: "2026-10-20",
      },
    ];
    const position = advancePosition(entries, [
      { runId: "a", status: "Paid", advanceMinor: 100_000n },
      { runId: "b", status: "Draft", advanceMinor: 100_000n },
      { runId: "c", status: "Cancelled", advanceMinor: 100_000n },
    ]);
    expect(position).toEqual({
      given: 300_000n,
      repaid: 20_000n,
      recovered: 100_000n,
      pending: 100_000n,
      outstanding: 180_000n,
    });
  });

  it("never lets two open pay runs recover the same money", () => {
    const entries = [advance(150_000n, 100_000n)];
    const deductions = [
      { runId: "oct", status: "Submitted", advanceMinor: 100_000n },
      { runId: "nov", status: "Draft", advanceMinor: 0n },
    ];
    expect(recoverableNow(entries, deductions, "nov")).toBe(50_000n);
    expect(recoverableNow(entries, deductions, "oct")).toBe(150_000n);
    expect(suggestedDeduction(entries, 50_000n)).toBe(50_000n);
    expect(suggestedDeduction(entries, 150_000n)).toBe(100_000n);
    expect(suggestedDeduction([advance(80_000n, 0n)], 80_000n)).toBe(80_000n);
    expect(suggestedDeduction(entries, 0n)).toBe(0n);
  });

  it("checks entries", () => {
    const base = {
      entryType: "Advance" as const,
      amountMinor: 100_000n,
      installmentMinor: 50_000n,
      entryDate: "2026-11-01",
      today: "2026-11-05",
      reason: "Medical",
      outstandingMinor: 0n,
    };
    expect(checkAdvanceEntry(base)).toBeNull();
    expect(checkAdvanceEntry({ ...base, amountMinor: 0n })?.code).toBe("AMOUNT");
    expect(checkAdvanceEntry({ ...base, entryDate: "2026-11-06" })?.code).toBe("DATE");
    expect(checkAdvanceEntry({ ...base, reason: "" })?.code).toBe("REASON");
    expect(checkAdvanceEntry({ ...base, installmentMinor: 200_000n })?.code).toBe("INSTALLMENT");
    expect(
      checkAdvanceEntry({ ...base, entryType: "Repayment", outstandingMinor: 50_000n })?.code,
    ).toBe("OVER_REPAYMENT");
  });
});

describe("worker position", () => {
  it("separates paid, approved-unpaid, not-in-run and advance", () => {
    const position = workerPosition({
      runs: [
        {
          status: "Paid",
          grossMinor: 500_000n,
          netMinor: 450_000n,
          month: "2026-09",
          paidOn: "2026-10-03",
        },
        {
          status: "Approved",
          grossMinor: 400_000n,
          netMinor: 380_000n,
          month: "2026-10",
          paidOn: null,
        },
        {
          status: "Draft",
          grossMinor: 100_000n,
          netMinor: 100_000n,
          month: "2026-11",
          paidOn: null,
        },
      ],
      unpaidAttendanceMinor: 85_000n,
      entries: [advance(200_000n, 100_000n)],
      deductions: [{ runId: "oct", status: "Approved", advanceMinor: 100_000n }],
    });
    expect(position).toMatchObject({
      earnedNetMinor: 830_000n,
      paidMinor: 450_000n,
      approvedUnpaidMinor: 380_000n,
      dueMinor: 465_000n,
      advanceGivenMinor: 200_000n,
      advanceRecoveredMinor: 100_000n,
      advanceOutstandingMinor: 100_000n,
      lastPaidOn: "2026-10-03",
    });
  });
});
