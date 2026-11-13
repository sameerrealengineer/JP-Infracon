import { describe, expect, it } from "vitest";
import {
  ROLE_LABELS,
  assignableBusinessRoles,
  managesAccounts,
  managesWholeCompany,
  mayManageMembershipRoles,
  mayManageRole,
  rolesAssignableBy,
  siteChoiceProblem,
} from "./account-role-policy";

describe("account role hierarchy", () => {
  it("lets Super Admin and Owner give every role", () => {
    expect(rolesAssignableBy("super_admin")).toEqual(assignableBusinessRoles);
    expect(rolesAssignableBy("owner")).toEqual(assignableBusinessRoles);
  });

  it("lets Directors appoint Admins and site roles, but not other Directors", () => {
    expect(rolesAssignableBy("director")).toContain("admin");
    expect(rolesAssignableBy("director")).toContain("site_engineer");
    expect(rolesAssignableBy("director")).not.toContain("director");
    expect(mayManageRole("director", "admin")).toBe(true);
    expect(mayManageRole("director", "director")).toBe(false);
  });

  it("lets Admins give only roles below Admin", () => {
    expect(rolesAssignableBy("admin")).toEqual([
      "project_manager",
      "site_engineer",
      "supervisor",
      "accounts",
      "storekeeper",
      "auditor",
    ]);
    expect(mayManageRole("admin", "admin")).toBe(false);
    expect(mayManageRole("admin", "director")).toBe(false);
  });

  it("follows Project Manager → Site Engineer → Site Supervisor → store, accounts, auditor", () => {
    expect(rolesAssignableBy("project_manager")).toEqual([
      "site_engineer",
      "supervisor",
      "accounts",
      "storekeeper",
      "auditor",
    ]);
    expect(rolesAssignableBy("site_engineer")).toEqual([
      "supervisor",
      "accounts",
      "storekeeper",
      "auditor",
    ]);
    expect(rolesAssignableBy("supervisor")).toEqual(["accounts", "storekeeper", "auditor"]);
    expect(mayManageRole("site_engineer", "supervisor")).toBe(true);
    expect(mayManageRole("supervisor", "site_engineer")).toBe(false);
    expect(mayManageRole("project_manager", "project_manager")).toBe(false);
  });

  it("gives no account management to accounts, storekeeper or auditor", () => {
    for (const role of ["accounts", "storekeeper", "auditor"] as const) {
      expect(managesAccounts(role)).toBe(false);
      expect(rolesAssignableBy(role)).toEqual([]);
      expect(mayManageRole(role, "auditor")).toBe(false);
    }
  });

  it("keeps the whole company to Owner, Director and Admin", () => {
    expect(managesWholeCompany("admin")).toBe(true);
    expect(managesWholeCompany("project_manager")).toBe(false);
    expect(managesWholeCompany("supervisor")).toBe(false);
  });

  it("never lets an Owner act on another Owner; the Super Admin may", () => {
    expect(mayManageRole("owner", "owner")).toBe(false);
    expect(mayManageRole("super_admin", "owner")).toBe(true);
  });

  it("requires authority over every role a person holds", () => {
    expect(mayManageMembershipRoles("director", ["supervisor", "admin"])).toBe(true);
    expect(mayManageMembershipRoles("admin", ["supervisor", "director"])).toBe(false);
    expect(mayManageMembershipRoles("director", [])).toBe(false);
  });

  it("keeps site managers to their own sites", () => {
    const base = { managerSiteIds: ["a", "b"] };
    expect(
      siteChoiceProblem({
        ...base,
        managerRole: "site_engineer",
        targetRole: "supervisor",
        siteIds: ["a"],
      }),
    ).toBeNull();
    expect(
      siteChoiceProblem({
        ...base,
        managerRole: "site_engineer",
        targetRole: "supervisor",
        siteIds: ["c"],
      }),
    ).toMatch(/own sites/);
    expect(
      siteChoiceProblem({
        ...base,
        managerRole: "admin",
        targetRole: "supervisor",
        siteIds: ["c"],
      }),
    ).toBeNull();
  });

  it("needs sites for site roles and none for company-wide roles", () => {
    expect(
      siteChoiceProblem({
        managerRole: "owner",
        managerSiteIds: [],
        targetRole: "supervisor",
        siteIds: [],
      }),
    ).toMatch(/at least one site/);
    expect(
      siteChoiceProblem({
        managerRole: "owner",
        managerSiteIds: [],
        targetRole: "admin",
        siteIds: ["a"],
      }),
    ).toMatch(/whole company/);
    expect(
      siteChoiceProblem({
        managerRole: "owner",
        managerSiteIds: [],
        targetRole: "supervisor",
        siteIds: ["a", "a"],
      }),
    ).toMatch(/only once/);
  });

  it("has a plain name for every role", () => {
    for (const role of assignableBusinessRoles) expect(ROLE_LABELS[role]).toBeTruthy();
    expect(ROLE_LABELS.site_engineer).toBe("Site Engineer");
  });
});
