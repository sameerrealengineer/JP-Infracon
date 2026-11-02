import { describe, expect, it } from "vitest";
import {
  availableIssueActions,
  formatIssueCode,
  isIssueOverdue,
  isIssuePolicyError,
  validateIssueTransition,
} from "./issue-policy";

const base = {
  severity: "Medium" as const,
  actorUserId: 5,
  resolvedBy: null,
  note: "",
};

describe("validateIssueTransition", () => {
  it("starts an open issue", () => {
    expect(validateIssueTransition({ ...base, action: "start", status: "Open" })).toEqual({
      next: "In Progress",
    });
  });
  it("needs a corrective action to resolve", () => {
    const result = validateIssueTransition({ ...base, action: "resolve", status: "In Progress" });
    expect(isIssuePolicyError(result) && result.code).toBe("BAD_REQUEST");
    expect(
      validateIssueTransition({
        ...base,
        action: "resolve",
        status: "In Progress",
        correctiveAction: "Barricade installed",
      }),
    ).toEqual({ next: "Resolved" });
  });
  it("blocks closing your own fix on a High or Critical issue", () => {
    const result = validateIssueTransition({
      ...base,
      severity: "Critical",
      action: "close",
      status: "Resolved",
      resolvedBy: 5,
      note: "Checked on site",
    });
    expect(isIssuePolicyError(result) && result.code).toBe("FORBIDDEN");
    expect(
      validateIssueTransition({
        ...base,
        severity: "Critical",
        action: "close",
        status: "Resolved",
        resolvedBy: 9,
        note: "Checked on site",
      }),
    ).toEqual({ next: "Closed" });
  });
  it("lets the resolver close a Low or Medium issue", () => {
    expect(
      validateIssueTransition({
        ...base,
        action: "close",
        status: "Resolved",
        resolvedBy: 5,
        note: "ok done",
      }),
    ).toEqual({ next: "Closed" });
  });
  it("requires a note to reopen and rejects illegal moves", () => {
    const noNote = validateIssueTransition({ ...base, action: "reopen", status: "Closed" });
    expect(isIssuePolicyError(noNote) && noNote.code).toBe("BAD_REQUEST");
    const illegal = validateIssueTransition({
      ...base,
      action: "close",
      status: "Open",
      note: "xyz",
    });
    expect(isIssuePolicyError(illegal) && illegal.code).toBe("CONFLICT");
  });
});

describe("helpers", () => {
  it("offers actions by permission", () => {
    expect(availableIssueActions("Open", { manage: true, close: false })).toEqual([
      "start",
      "resolve",
    ]);
    expect(availableIssueActions("Resolved", { manage: true, close: false })).toEqual([]);
    expect(availableIssueActions("Resolved", { manage: false, close: true })).toEqual([
      "close",
      "send_back",
    ]);
    expect(availableIssueActions("Closed", { manage: true, close: true })).toEqual(["reopen"]);
  });
  it("flags overdue open issues only", () => {
    expect(isIssueOverdue({ status: "Open", targetDate: "2026-11-01" }, "2026-11-02")).toBe(true);
    expect(isIssueOverdue({ status: "Resolved", targetDate: "2026-11-01" }, "2026-11-02")).toBe(
      false,
    );
    expect(isIssueOverdue({ status: "Open", targetDate: "2026-11-02" }, "2026-11-02")).toBe(false);
  });
  it("formats issue codes", () => {
    expect(formatIssueCode("bal-01", new Date("2026-11-02T10:00:00Z"), 7)).toBe(
      "BAL-01-261102-007",
    );
  });
});
