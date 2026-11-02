export type PettyCashPolicyErrorCode =
  | "FORBIDDEN"
  | "CONFLICT"
  | "PRECONDITION_FAILED"
  | "BAD_REQUEST";
export type PettyCashPolicyError = { code: PettyCashPolicyErrorCode; message: string };
export type PettyCashMovementStatus =
  | "Draft"
  | "Submitted"
  | "Approved"
  | "Rejected"
  | "Cancelled"
  | "Posted";
export type PettyCashMovementType = "Funding" | "Expense" | "Cash Return";
export type PettyCashExpenseFundingSource = "Site Petty Cash" | "Personal Funds";

export function pettyCashExpenseFundingSourceError(input: {
  movementType: PettyCashMovementType;
  expenseFundingSource: PettyCashExpenseFundingSource | null;
  fundSourceAttested: boolean;
}): PettyCashPolicyError | null {
  if (input.movementType === "Expense") {
    if (input.expenseFundingSource === "Personal Funds") {
      return {
        code: "PRECONDITION_FAILED",
        message:
          "Personal out-of-pocket expenses belong in a separate reimbursement liability, not site petty cash; the reimbursement workflow is not yet available. No cash movement was created.",
      };
    }
    if (input.expenseFundingSource !== "Site Petty Cash" || !input.fundSourceAttested) {
      return {
        code: "BAD_REQUEST",
        message:
          "Confirm that this Expense was paid directly from the selected site petty-cash fund. Personal Funds are not accepted here.",
      };
    }
    return null;
  }

  if (input.expenseFundingSource !== null || input.fundSourceAttested) {
    return {
      code: "BAD_REQUEST",
      message: "Site-fund expense confirmation is only valid for an Expense movement.",
    };
  }
  return null;
}

export function pettyCashCustodianAcknowledgementError(input: {
  siteStatus: string;
  fundStatus: string;
  actorIsNamedCustodian: boolean;
  hasCurrentActiveSiteAssignment: boolean;
}): PettyCashPolicyError | null {
  if (input.siteStatus !== "Active") {
    return {
      code: "PRECONDITION_FAILED",
      message: "A petty-cash fund can only be acknowledged while its assigned site is Active.",
    };
  }
  if (!input.actorIsNamedCustodian) {
    return {
      code: "FORBIDDEN",
      message: "Only the named fund custodian can acknowledge responsibility.",
    };
  }
  if (!input.hasCurrentActiveSiteAssignment) {
    return {
      code: "FORBIDDEN",
      message: "The named custodian no longer has an active assignment to this site.",
    };
  }
  if (input.fundStatus !== "Pending Custodian") {
    return {
      code: "CONFLICT",
      message: "This fund is no longer awaiting custodian acknowledgement.",
    };
  }
  return null;
}

export function pettyCashMovementTransitionError(input: {
  action: "submit" | "review" | "post" | "cancel";
  status: PettyCashMovementStatus;
  actorUserId: number;
  createdBy: number;
  fundStatus?: string;
  hasReviewAuthority?: boolean;
  hasDirectPostReason?: boolean;
  /** Delegated "approve own work" for this site. */
  selfApprovalAllowed?: boolean;
}): PettyCashPolicyError | null {
  if (input.action === "submit") {
    if (input.actorUserId !== input.createdBy) {
      return { code: "FORBIDDEN", message: "Only the movement creator can submit this draft." };
    }
    if (input.status !== "Draft") {
      return { code: "CONFLICT", message: "Only a Draft petty-cash movement can be submitted." };
    }
    if (input.fundStatus !== "Active") {
      return { code: "PRECONDITION_FAILED", message: "The petty-cash fund is not Active." };
    }
    return null;
  }

  if (input.action === "review") {
    if (input.status !== "Submitted") {
      return { code: "CONFLICT", message: "Only a Submitted petty-cash movement can be reviewed." };
    }
    if (input.actorUserId === input.createdBy && !input.selfApprovalAllowed) {
      return {
        code: "FORBIDDEN",
        message: "The movement creator cannot review their own petty-cash entry.",
      };
    }
    return null;
  }

  if (input.action === "post") {
    if (input.actorUserId === input.createdBy && !input.selfApprovalAllowed) {
      return {
        code: "FORBIDDEN",
        message: "The movement creator cannot post their own petty-cash entry.",
      };
    }
    if (input.status !== "Approved" && input.status !== "Submitted") {
      return {
        code: "CONFLICT",
        message: "Only an Approved movement or a reasoned direct-post submission can be posted.",
      };
    }
    if (input.status === "Submitted" && !input.hasReviewAuthority) {
      return {
        code: "FORBIDDEN",
        message: "Direct posting a Submitted movement also requires review authority.",
      };
    }
    if (input.status === "Submitted" && !input.hasDirectPostReason) {
      return {
        code: "BAD_REQUEST",
        message: "A separate reason is required when directly posting a Submitted movement.",
      };
    }
    return null;
  }

  if (input.actorUserId !== input.createdBy) {
    return { code: "FORBIDDEN", message: "Only the creator can cancel this petty-cash entry." };
  }
  if (input.status !== "Draft" && input.status !== "Submitted") {
    return {
      code: "CONFLICT",
      message:
        "Only a Draft or Submitted petty-cash entry can be cancelled; posted records are never deleted or reversed here.",
    };
  }
  return null;
}

export function pettyCashEvidenceRequirementError(input: {
  requiresEvidence: boolean;
  hasAcceptedPrivateEvidence: boolean;
}): PettyCashPolicyError | null {
  if (!input.requiresEvidence || input.hasAcceptedPrivateEvidence) return null;
  return {
    code: "PRECONDITION_FAILED",
    message:
      "This active permission grant requires an accepted Private receipt attachment. Text references do not satisfy it, and secure petty-cash file upload is not enabled in this increment. No approval or posting was made.",
  };
}
