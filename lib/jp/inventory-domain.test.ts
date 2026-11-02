import { describe, expect, it } from "vitest";
import {
  balanceAfterMovement,
  calculatePostedStockBalance,
  canPostWithoutNegativeStock,
  directionForMovement,
  formatStockQuantity,
  isAtOrBelowReorderThreshold,
  normalizeStockQuantity,
  parseStockQuantity,
} from "./inventory-domain";

describe("inventory quantity and movement rules", () => {
  it("converts quantities exactly to thousandths and formats without float rounding", () => {
    expect(parseStockQuantity("12.345")).toBe(12345n);
    expect(normalizeStockQuantity("00012.340")).toBe("12.34");
    expect(formatStockQuantity(1001n)).toBe("1.001");
    expect(formatStockQuantity(-1250n)).toBe("-1.25");
    expect(() => parseStockQuantity("0")).toThrow(/greater than zero/);
    expect(() => parseStockQuantity("1.0001")).toThrow(/3 decimal places/);
    expect(() => parseStockQuantity("-1")).toThrow(/3 decimal places/);
  });

  it("reconciles 300 received bags minus 45 posted consumption to 255", () => {
    const balance = calculatePostedStockBalance([
      { status: "Posted", movementType: "Receipt/Inward", quantity: "300" },
      { status: "Posted", movementType: "Issue/Consumption", quantity: "45" },
    ]);
    expect(balance).toBe("255");
  });

  it("excludes submitted and rejected inward entries from official stock", () => {
    expect(calculatePostedStockBalance([
      { status: "Submitted", movementType: "Receipt/Inward", quantity: "300" },
      { status: "Rejected", movementType: "Receipt/Inward", quantity: "12" },
      { status: "Posted", movementType: "Return to Store", quantity: "0.125" },
    ])).toBe("0.125");
  });

  it("uses the correct movement direction and prevents outbound posting below zero", () => {
    expect(directionForMovement("Receipt/Inward")).toBe("Inbound");
    expect(directionForMovement("Return to Store")).toBe("Inbound");
    expect(directionForMovement("Wastage")).toBe("Outbound");
    expect(balanceAfterMovement("1.250", "0.250", "Outbound")).toBe(1000n);
    expect(canPostWithoutNegativeStock("1.25", "1.25")).toBe(true);
    expect(canPostWithoutNegativeStock("1.25", "1.251")).toBe(false);
    expect(calculatePostedStockBalance([{ status: "Posted", movementType: "Damage", quantity: "2" }])).toBe("-2");
  });

  it("compares low-stock thresholds exactly and keeps missing thresholds distinct", () => {
    expect(isAtOrBelowReorderThreshold("9.999", "10")).toBe(true);
    expect(isAtOrBelowReorderThreshold("10.001", "10")).toBe(false);
    expect(isAtOrBelowReorderThreshold("0", null)).toBe(false);
  });
});
