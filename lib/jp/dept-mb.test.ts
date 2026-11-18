import { describe, expect, it } from "vitest";
import { formatThousandths, mbAbstract, netByItem, signedLimitProblem } from "./dept-mb";

const entries = [
  {
    contractItemId: "a",
    quantityThousandths: "10000",
    deduction: "No" as const,
    status: "Signed" as const,
  },
  {
    contractItemId: "a",
    quantityThousandths: "1500",
    deduction: "Yes" as const,
    status: "Signed" as const,
  },
  {
    contractItemId: "a",
    quantityThousandths: "4000",
    deduction: "No" as const,
    status: "Recorded" as const,
  },
  {
    contractItemId: "a",
    quantityThousandths: "9000",
    deduction: "No" as const,
    status: "Rejected" as const,
  },
];

describe("department measurement book", () => {
  it("nets deductions and counts only the chosen statuses", () => {
    expect(netByItem(entries, ["Signed"]).get("a")).toBe(8500n);
    expect(netByItem(entries, ["Recorded", "Signed"]).get("a")).toBe(12500n);
  });

  it("gives the abstract with the signed balance still to bill", () => {
    const [row] = mbAbstract(
      [{ id: "a", contractQuantityThousandths: "20000" }],
      entries,
      new Map([["a", 5000n]]),
    );
    expect(row).toEqual({
      itemId: "a",
      contractThousandths: "20000",
      measuredThousandths: "12500",
      signedThousandths: "8500",
      billedThousandths: "5000",
      toBillThousandths: "3500",
    });
  });

  it("refuses billing past the signed quantity", () => {
    expect(
      signedLimitProblem({
        description: "1.1 PCC",
        signed: 8500n,
        previouslyBilled: 5000n,
        thisBill: 3500n,
      }),
    ).toBeNull();
    expect(
      signedLimitProblem({
        description: "1.1 PCC",
        signed: 8500n,
        previouslyBilled: 5000n,
        thisBill: 4000n,
      }),
    ).toMatch(/only 3.5 more is signed/);
    expect(formatThousandths(12500n)).toBe("12.5");
  });
});
