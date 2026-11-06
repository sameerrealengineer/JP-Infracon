import { describe, expect, it } from "vitest";
import { summarizeBills } from "./project-hub";

describe("project hub billing summary", () => {
  it("counts only approved bills as billed and keeps the rest apart", () => {
    const summary = summarizeBills(
      [
        {
          status: "Approved",
          netReceivableMinor: "500000",
          receivedMinor: "200000",
          outstandingMinor: "300000",
        },
        {
          status: "Approved",
          netReceivableMinor: "250000",
          receivedMinor: "250000",
          outstandingMinor: "0",
        },
        {
          status: "Submitted",
          netReceivableMinor: "900000",
          receivedMinor: "0",
          outstandingMinor: "0",
        },
        {
          status: "Draft",
          netReceivableMinor: "100000",
          receivedMinor: "0",
          outstandingMinor: "0",
        },
        {
          status: "Rejected",
          netReceivableMinor: "100000",
          receivedMinor: "0",
          outstandingMinor: "0",
        },
      ],
      "3000000",
    );
    expect(summary).toEqual({
      billedMinor: "750000",
      receivedMinor: "450000",
      outstandingMinor: "300000",
      billedTenths: 250,
      waitingForApproval: 1,
      drafts: 1,
    });
  });

  it("has no billed share without a contract value", () => {
    expect(summarizeBills([], null).billedTenths).toBeNull();
    expect(summarizeBills([], "0").billedTenths).toBeNull();
  });
});
