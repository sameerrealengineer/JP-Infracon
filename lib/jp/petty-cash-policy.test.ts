import { describe, expect, it } from "vitest";
import {
  pettyCashCustodianAcknowledgementError,
  pettyCashEvidenceRequirementError,
  pettyCashExpenseFundingSourceError,
  pettyCashMovementTransitionError,
} from "./petty-cash-policy";

describe("petty-cash expense funding-source policy", () => {
  it("requires an explicit site-fund source and creator attestation for expenses", () => {
    expect(
      pettyCashExpenseFundingSourceError({
        movementType: "Expense",
        expenseFundingSource: "Site Petty Cash",
        fundSourceAttested: true,
      }),
    ).toBeNull();
    expect(
      pettyCashExpenseFundingSourceError({
        movementType: "Expense",
        expenseFundingSource: "Site Petty Cash",
        fundSourceAttested: false,
      })?.code,
    ).toBe("BAD_REQUEST");
    expect(
      pettyCashExpenseFundingSourceError({
        movementType: "Expense",
        expenseFundingSource: null,
        fundSourceAttested: false,
      })?.code,
    ).toBe("BAD_REQUEST");
  });

  it("rejects Personal Funds so the entry cannot reduce petty-cash balance", () => {
    const failure = pettyCashExpenseFundingSourceError({
      movementType: "Expense",
      expenseFundingSource: "Personal Funds",
      fundSourceAttested: true,
    });
    expect(failure?.code).toBe("PRECONDITION_FAILED");
    expect(failure?.message).toContain("separate reimbursement liability");
    expect(failure?.message).toContain("No cash movement was created");
  });

  it("does not accept expense-only source confirmation on Funding or Cash Return", () => {
    expect(
      pettyCashExpenseFundingSourceError({
        movementType: "Funding",
        expenseFundingSource: null,
        fundSourceAttested: false,
      }),
    ).toBeNull();
    expect(
      pettyCashExpenseFundingSourceError({
        movementType: "Cash Return",
        expenseFundingSource: null,
        fundSourceAttested: false,
      }),
    ).toBeNull();
    expect(
      pettyCashExpenseFundingSourceError({
        movementType: "Funding",
        expenseFundingSource: "Site Petty Cash",
        fundSourceAttested: true,
      })?.code,
    ).toBe("BAD_REQUEST");
  });
});

describe("petty-cash custodian acknowledgement policy", () => {
  const valid = {
    siteStatus: "Active",
    fundStatus: "Pending Custodian",
    actorIsNamedCustodian: true,
    hasCurrentActiveSiteAssignment: true,
  };

  it("allows only an active site's named, currently assigned custodian to accept a pending fund", () => {
    expect(pettyCashCustodianAcknowledgementError(valid)).toBeNull();
    expect(pettyCashCustodianAcknowledgementError({ ...valid, siteStatus: "On Hold" })?.code).toBe(
      "PRECONDITION_FAILED",
    );
    expect(
      pettyCashCustodianAcknowledgementError({ ...valid, actorIsNamedCustodian: false })?.code,
    ).toBe("FORBIDDEN");
    expect(
      pettyCashCustodianAcknowledgementError({ ...valid, hasCurrentActiveSiteAssignment: false })
        ?.code,
    ).toBe("FORBIDDEN");
    expect(pettyCashCustodianAcknowledgementError({ ...valid, fundStatus: "Active" })?.code).toBe(
      "CONFLICT",
    );
  });
});

describe("petty-cash maker-checker movement transitions", () => {
  it("permits only the creator to submit an active-fund draft", () => {
    expect(
      pettyCashMovementTransitionError({
        action: "submit",
        status: "Draft",
        actorUserId: 7,
        createdBy: 7,
        fundStatus: "Active",
      }),
    ).toBeNull();
    expect(
      pettyCashMovementTransitionError({
        action: "submit",
        status: "Draft",
        actorUserId: 8,
        createdBy: 7,
        fundStatus: "Active",
      })?.code,
    ).toBe("FORBIDDEN");
    expect(
      pettyCashMovementTransitionError({
        action: "submit",
        status: "Draft",
        actorUserId: 7,
        createdBy: 7,
        fundStatus: "On Hold",
      })?.code,
    ).toBe("PRECONDITION_FAILED");
    expect(
      pettyCashMovementTransitionError({
        action: "submit",
        status: "Posted",
        actorUserId: 7,
        createdBy: 7,
        fundStatus: "Active",
      })?.code,
    ).toBe("CONFLICT");
  });

  it("requires a different actor to review a Submitted movement", () => {
    expect(
      pettyCashMovementTransitionError({
        action: "review",
        status: "Submitted",
        actorUserId: 8,
        createdBy: 7,
      }),
    ).toBeNull();
    expect(
      pettyCashMovementTransitionError({
        action: "review",
        status: "Submitted",
        actorUserId: 7,
        createdBy: 7,
      })?.code,
    ).toBe("FORBIDDEN");
    expect(
      pettyCashMovementTransitionError({
        action: "review",
        status: "Draft",
        actorUserId: 8,
        createdBy: 7,
      })?.code,
    ).toBe("CONFLICT");
  });

  it("allows an authorised different poster on Approved items but requires review authority and a separate reason for direct posting", () => {
    expect(
      pettyCashMovementTransitionError({
        action: "post",
        status: "Approved",
        actorUserId: 8,
        createdBy: 7,
      }),
    ).toBeNull();
    expect(
      pettyCashMovementTransitionError({
        action: "post",
        status: "Approved",
        actorUserId: 7,
        createdBy: 7,
      })?.code,
    ).toBe("FORBIDDEN");
    expect(
      pettyCashMovementTransitionError({
        action: "post",
        status: "Submitted",
        actorUserId: 8,
        createdBy: 7,
        hasReviewAuthority: false,
        hasDirectPostReason: true,
      })?.code,
    ).toBe("FORBIDDEN");
    expect(
      pettyCashMovementTransitionError({
        action: "post",
        status: "Submitted",
        actorUserId: 8,
        createdBy: 7,
        hasReviewAuthority: true,
        hasDirectPostReason: false,
      })?.code,
    ).toBe("BAD_REQUEST");
    expect(
      pettyCashMovementTransitionError({
        action: "post",
        status: "Submitted",
        actorUserId: 8,
        createdBy: 7,
        hasReviewAuthority: true,
        hasDirectPostReason: true,
      }),
    ).toBeNull();
  });

  it("allows only the creator to cancel a Draft or Submitted item; it never cancels Posted entries", () => {
    expect(
      pettyCashMovementTransitionError({
        action: "cancel",
        status: "Draft",
        actorUserId: 7,
        createdBy: 7,
      }),
    ).toBeNull();
    expect(
      pettyCashMovementTransitionError({
        action: "cancel",
        status: "Submitted",
        actorUserId: 7,
        createdBy: 7,
      }),
    ).toBeNull();
    expect(
      pettyCashMovementTransitionError({
        action: "cancel",
        status: "Submitted",
        actorUserId: 8,
        createdBy: 7,
      })?.code,
    ).toBe("FORBIDDEN");
    expect(
      pettyCashMovementTransitionError({
        action: "cancel",
        status: "Posted",
        actorUserId: 7,
        createdBy: 7,
      })?.code,
    ).toBe("CONFLICT");
  });
});

describe("petty-cash private evidence policy", () => {
  it("does not require evidence unless the active grant says so", () => {
    expect(
      pettyCashEvidenceRequirementError({
        requiresEvidence: false,
        hasAcceptedPrivateEvidence: false,
      }),
    ).toBeNull();
  });

  it("blocks review/post until a Private accepted file exists when required; text-only references do not satisfy the grant", () => {
    const failure = pettyCashEvidenceRequirementError({
      requiresEvidence: true,
      hasAcceptedPrivateEvidence: false,
    });
    expect(failure?.code).toBe("PRECONDITION_FAILED");
    expect(failure?.message).toContain("secure petty-cash file upload is not enabled");
    expect(
      pettyCashEvidenceRequirementError({
        requiresEvidence: true,
        hasAcceptedPrivateEvidence: true,
      }),
    ).toBeNull();
  });
});
