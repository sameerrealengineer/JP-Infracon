import { describe, expect, it } from "vitest";
import {
  isValidCode,
  nextStatusOptions,
  prettyRole,
  sortInbox,
  validateSiteAssignment,
  validateStatusChange,
  type InboxItem,
} from "./site-admin-policy";

describe("validateStatusChange", () => {
  it("allows putting an active site on hold with a reason", () => {
    expect(validateStatusChange("Active", "On Hold", "Monsoon stoppage")).toBeNull();
  });
  it("requires a reason", () => {
    expect(validateStatusChange("Active", "On Hold", " ")?.code).toBe("BAD_REQUEST");
  });
  it("rejects a no-op and an illegal transition", () => {
    expect(validateStatusChange("Active", "Active", "x x x")?.code).toBe("CONFLICT");
    expect(validateStatusChange("Inactive", "Completed", "done")?.code).toBe("BAD_REQUEST");
  });
  it("lets a completed site be reopened", () => {
    expect(nextStatusOptions("Completed")).toContain("Active");
  });
});

describe("validateSiteAssignment", () => {
  const base = {
    memberRoles: ["supervisor"],
    memberActive: true,
    role: "supervisor",
    alreadyAssigned: false,
  };
  it("accepts an active site-level member", () => {
    expect(validateSiteAssignment(base)).toBeNull();
  });
  it("rejects inactive members, owner-level members, bad roles and duplicates", () => {
    expect(validateSiteAssignment({ ...base, memberActive: false })?.code).toBe("BAD_REQUEST");
    expect(validateSiteAssignment({ ...base, memberRoles: ["admin"] })?.code).toBe("CONFLICT");
    expect(validateSiteAssignment({ ...base, role: "owner" })?.code).toBe("BAD_REQUEST");
    expect(validateSiteAssignment({ ...base, alreadyAssigned: true })?.code).toBe("CONFLICT");
  });
});

describe("helpers", () => {
  it("formats roles and validates codes", () => {
    expect(prettyRole("project_manager")).toBe("Project Manager");
    expect(prettyRole("admin")).toBe("Contractor / Admin");
    expect(isValidCode(" bbsr-02 ")).toBe(true);
    expect(isValidCode("-x")).toBe(false);
    expect(isValidCode("a")).toBe(false);
  });
  it("sorts high severity first, then oldest first", () => {
    const item = (id: string, severity: "high" | "normal", occurredAt: string): InboxItem => ({
      id,
      kind: "task.overdue",
      title: id,
      detail: "",
      siteId: "s",
      siteName: "S",
      occurredAt,
      route: "/schedule",
      severity,
    });
    const sorted = sortInbox([
      item("n-new", "normal", "2026-11-02"),
      item("h", "high", "2026-11-01"),
      item("n-old", "normal", "2026-10-01"),
    ]);
    expect(sorted.map((row) => row.id)).toEqual(["h", "n-old", "n-new"]);
  });
});
