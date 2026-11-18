import { describe, expect, it } from "vitest";
import {
  extendedCompletion,
  guaranteeProblem,
  guaranteeState,
  lockedByKind,
  quotedPercent,
  tenderCode,
  tenderMoveProblem,
} from "./contract-domain";

describe("tenders, guarantees and extensions", () => {
  it("moves tenders only forward", () => {
    expect(tenderMoveProblem("Preparing", "Submitted")).toBeNull();
    expect(tenderMoveProblem("Opened", "Won")).toBeNull();
    expect(tenderMoveProblem("Won", "Lost")).toMatch(/cannot/);
    expect(tenderMoveProblem("Preparing", "Won")).toMatch(/cannot/);
  });

  it("marks guarantees expiring within 30 days and expired after", () => {
    expect(guaranteeState({ status: "Active", expiryDate: "2027-03-01" }, "2026-11-18")).toBe(
      "Active",
    );
    expect(guaranteeState({ status: "Active", expiryDate: "2026-12-18" }, "2026-11-18")).toBe(
      "Expiring",
    );
    expect(guaranteeState({ status: "Active", expiryDate: "2026-11-17" }, "2026-11-18")).toBe(
      "Expired",
    );
    expect(guaranteeState({ status: "Released", expiryDate: "2026-01-01" }, "2026-11-18")).toBe(
      "Released",
    );
    expect(guaranteeState({ status: "Active", expiryDate: null }, "2026-11-18")).toBe("Active");
  });

  it("totals locked money by kind in exact paise", () => {
    expect(
      lockedByKind([
        { kind: "EMD", status: "Active", amountMinor: "5000000" },
        { kind: "EMD", status: "Active", amountMinor: "250000" },
        { kind: "EMD", status: "Released", amountMinor: "999" },
      ]),
    ).toEqual([{ kind: "EMD", amountMinor: "5250000" }]);
  });

  it("checks guarantee input", () => {
    const ok = {
      kind: "Performance guarantee",
      instrument: "Bank guarantee",
      amountMinor: 100n,
      issueDate: "2026-11-01",
      expiryDate: "2027-11-01",
    };
    expect(guaranteeProblem(ok)).toBeNull();
    expect(guaranteeProblem({ ...ok, expiryDate: null })).toMatch(/expiry/);
    expect(guaranteeProblem({ ...ok, amountMinor: 0n })).toMatch(/amount/);
    expect(guaranteeProblem({ ...ok, instrument: "Demand draft", expiryDate: null })).toBeNull();
  });

  it("works out extended completion, codes and quoted percent", () => {
    expect(extendedCompletion("2026-12-31", [30, 15])).toBe("2027-02-14");
    expect(tenderCode(2026, 7)).toBe("TND-2026-007");
    expect(quotedPercent("10000000", "9500000")).toBe(-5);
    expect(quotedPercent("10000000", "10750000")).toBe(7.5);
    expect(quotedPercent(null, "1")).toBeNull();
  });
});
