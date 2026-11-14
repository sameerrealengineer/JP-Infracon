import { describe, expect, it } from "vitest";
import {
  canMoveReturn,
  lineAmountMinor,
  returnNumber,
  returnTotalMinor,
  rupeesToPaise,
} from "./return-domain";

describe("purchase return domain", () => {
  it("reads rupees exactly", () => {
    expect(rupeesToPaise("1250.5")).toBe(125050n);
    expect(rupeesToPaise("6900")).toBe(690000n);
    expect(rupeesToPaise("12.345")).toBeNull();
    expect(rupeesToPaise("-4")).toBeNull();
  });

  it("works out line amounts and totals in paise", () => {
    expect(lineAmountMinor("2", 690000n)).toBe(1380000n);
    expect(lineAmountMinor("0.333", 100n)).toBe(33n);
    expect(
      returnTotalMinor([
        { quantity: "2", rateMinor: 690000n },
        { quantity: "1.5", rateMinor: 41000n },
      ]),
    ).toBe(1441500n);
  });

  it("allows only forward status changes", () => {
    expect(canMoveReturn("Submitted", "Approved")).toBe(true);
    expect(canMoveReturn("Approved", "Settled")).toBe(true);
    expect(canMoveReturn("Settled", "Submitted")).toBe(false);
    expect(canMoveReturn("Rejected", "Approved")).toBe(false);
  });

  it("numbers returns per site", () => {
    expect(returnNumber("SHG-OHT01", 4)).toBe("RET-SHG-OHT01-004");
  });
});
