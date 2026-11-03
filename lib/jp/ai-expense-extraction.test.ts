import { describe, expect, it } from "vitest";
import { cleanDate, cleanRupees, normalizeExpenseFields } from "./ai-expense-extraction";

describe("expense extraction", () => {
  it("re-checks amount, date and payment mode", () => {
    expect(
      normalizeExpenseFields(
        {
          amount: "₹1,250.5",
          date: "2026-11-02",
          payee: "  Jagannath   Hardware ",
          paymentMode: "upi",
          category: "Small tools",
          purpose: "Cutting wheels",
          receiptNumber: "INV-77",
        },
        "2026-11-03",
      ),
    ).toEqual({
      amountRupees: "1250.50",
      date: "2026-11-02",
      payee: "Jagannath Hardware",
      paymentMode: "UPI",
      category: "Small tools",
      purpose: "Cutting wheels",
      receiptReference: "INV-77",
    });
  });

  it("drops unclear amounts, future or impossible dates and unknown modes", () => {
    expect(cleanRupees("about 500")).toBe("");
    expect(cleanRupees("0")).toBe("");
    expect(cleanRupees("Rs. 300")).toBe("300");
    expect(cleanDate("2026-11-30", "2026-11-03")).toBe("");
    expect(cleanDate("2026-02-30", "2026-11-03")).toBe("");
    expect(
      normalizeExpenseFields({ amount: "100", paymentMode: "crypto" }, "2026-11-03").paymentMode,
    ).toBeNull();
  });
});
