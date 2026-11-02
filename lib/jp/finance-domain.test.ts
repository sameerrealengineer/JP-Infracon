import { describe, expect, it } from "vitest";
import {
  assertPettyCashPostingWithinLimits,
  calculateInvoicePaymentBalance,
  calculateInvoiceTotals,
  calculatePaymentAllocationTotal,
  calculatePettyCashBalance,
  calculateRemainingPettyCashReturnMinor,
  formatMinorAsRupees,
  normalizeMinorAmount,
  parsePositiveQuantity,
  parseRupeesToMinor,
} from "./finance-domain";

describe("commercial exact-amount domain", () => {
  it("converts rupees to integer paise without floating-point arithmetic", () => {
    expect(parseRupeesToMinor("250000")).toBe("25000000");
    expect(parseRupeesToMinor("1500.5")).toBe("150050");
    expect(parseRupeesToMinor("0.01")).toBe("1");
    expect(parseRupeesToMinor("0", true)).toBe("0");
  });

  it("rejects negative, fractional-paise, malformed, zero-required and oversized amounts", () => {
    for (const value of ["-1", "1.001", "₹5", "1,000", "", "1e3"]) {
      expect(() => parseRupeesToMinor(value)).toThrow();
    }
    expect(() => parseRupeesToMinor("0")).toThrow();
    expect(() => parseRupeesToMinor("10000000000000000")).toThrow();
    expect(() => normalizeMinorAmount("1.5")).toThrow();
  });

  it("formats large paise values with Indian grouping and keeps two fractional digits", () => {
    expect(formatMinorAsRupees("25000000")).toBe("₹2,50,000.00");
    expect(formatMinorAsRupees("150050")).toBe("₹1,500.50");
    expect(formatMinorAsRupees(1n)).toBe("₹0.01");
  });

  it("normalizes positive quantities exactly to three decimal places", () => {
    expect(parsePositiveQuantity("2")).toBe("2.000");
    expect(parsePositiveQuantity("0.125")).toBe("0.125");
    expect(() => parsePositiveQuantity("0")).toThrow();
    expect(() => parsePositiveQuantity("1.0001")).toThrow();
  });

  it("derives invoice subtotal and gross total from line items and explicit tax/charges", () => {
    expect(calculateInvoiceTotals([
      { lineTotalMinor: "25000000" },
      { lineTotalMinor: "10000000" },
    ], "4500000", "500000")).toEqual({
      subtotalMinor: "35000000",
      taxMinor: "4500000",
      chargesMinor: "500000",
      totalMinor: "40000000",
    });
    expect(() => calculateInvoiceTotals([], "0", "0")).toThrow();
  });

  it("accepts a fully allocated multi-invoice part-payment using exact paise", () => {
    expect(calculatePaymentAllocationTotal("250001", [
      { invoiceId: "invoice-a", amountMinor: "150001" },
      { invoiceId: "invoice-b", amountMinor: "100000" },
    ], new Map([["invoice-a", "200000"], ["invoice-b", "125000"]]))).toBe("250001");
  });

  it("rejects duplicate, unknown, over-balance, over-payment, and unallocated amounts", () => {
    const balances = new Map([["invoice-a", "50000"], ["invoice-b", "100000"]]);
    expect(() => calculatePaymentAllocationTotal("70000", [
      { invoiceId: "invoice-a", amountMinor: "40000" },
      { invoiceId: "invoice-a", amountMinor: "30000" },
    ], balances)).toThrow(/only once/);
    expect(() => calculatePaymentAllocationTotal("70000", [{ invoiceId: "invoice-x", amountMinor: "70000" }], balances)).toThrow(/approved invoice/);
    expect(() => calculatePaymentAllocationTotal("70000", [{ invoiceId: "invoice-a", amountMinor: "50001" }], balances)).toThrow(/available/);
    expect(() => calculatePaymentAllocationTotal("70000", [{ invoiceId: "invoice-b", amountMinor: "70001" }], balances)).toThrow(/cannot exceed/);
    expect(() => calculatePaymentAllocationTotal("70000", [{ invoiceId: "invoice-b", amountMinor: "60000" }], balances)).toThrow(/full payment/);
  });

  it("derives the remaining approved invoice amount only from posted allocations", () => {
    expect(calculateInvoicePaymentBalance("300000", ["150000", "50000"])).toEqual({
      postedAllocatedMinor: "200000",
      balanceMinor: "100000",
    });
    expect(calculateInvoicePaymentBalance("300000", [])).toEqual({ postedAllocatedMinor: "0", balanceMinor: "300000" });
    expect(() => calculateInvoicePaymentBalance("300000", ["200000", "100001"])).toThrow(/exceed/);
  });

  it("matches the PRD petty-cash example using Posted movements only", () => {
    expect(calculatePettyCashBalance([
      { movementType: "Funding", amountMinor: "5000000", status: "Posted" },
      { movementType: "Expense", amountMinor: "1500000", status: "Posted" },
      { movementType: "Expense", amountMinor: "800000", status: "Posted" },
      { movementType: "Expense", amountMinor: "200000", status: "Posted" },
      { movementType: "Expense", amountMinor: "900000", status: "Submitted" },
      { movementType: "Cash Return", amountMinor: "50000", status: "Rejected" },
    ])).toEqual({ fundedMinor: "5000000", expenseMinor: "2500000", returnedMinor: "0", balanceMinor: "2500000" });
  });

  it("enforces expense availability and the authorised fund ceiling in integer paise", () => {
    expect(assertPettyCashPostingWithinLimits({
      movementType: "Expense", amountMinor: "12501", balanceMinor: "50000", authorizedLimitMinor: "100000",
    })).toBe("37499");
    expect(assertPettyCashPostingWithinLimits({
      movementType: "Funding", amountMinor: "20000", balanceMinor: "50000", authorizedLimitMinor: "70000",
    })).toBe("70000");
    expect(() => assertPettyCashPostingWithinLimits({
      movementType: "Expense", amountMinor: "50001", balanceMinor: "50000", authorizedLimitMinor: "100000",
    })).toThrow(/available cash/);
    expect(() => assertPettyCashPostingWithinLimits({
      movementType: "Cash Return", amountMinor: "1", balanceMinor: "70000", authorizedLimitMinor: "70000",
    })).toThrow(/authorised limit/);
  });

  it("caps cash returns at the remaining amount of their original Posted expense", () => {
    expect(calculateRemainingPettyCashReturnMinor("150001", ["25000", "50000"])).toBe("75001");
    expect(calculateRemainingPettyCashReturnMinor("100000", ["0"])).toBe("100000");
    expect(() => calculateRemainingPettyCashReturnMinor("100000", ["60000", "40001"])).toThrow(/exceed/);
  });
});
