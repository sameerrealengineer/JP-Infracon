import { describe, expect, it } from "vitest";
import { mayManageMembershipRoles, mayManageRole, rolesAssignableBy } from "./account-role-policy";

describe("account role hierarchy", () => {
  it("allows Super Admin and organization owner to assign all business roles", () => {
    expect(rolesAssignableBy("super_admin")).toContain("director");
    expect(rolesAssignableBy("owner")).toContain("director");
    expect(rolesAssignableBy("owner")).toContain("admin");
  });

  it("lets Directors appoint Contractor/Admin and site roles, but not peer Directors", () => {
    expect(rolesAssignableBy("director")).toContain("admin");
    expect(rolesAssignableBy("director")).toContain("supervisor");
    expect(rolesAssignableBy("director")).not.toContain("director");
    expect(mayManageRole("director", "admin")).toBe(true);
    expect(mayManageRole("director", "director")).toBe(false);
  });

  it("limits Contractor/Admin role assignment to site-scoped accounts", () => {
    expect(rolesAssignableBy("admin")).toContain("project_manager");
    expect(rolesAssignableBy("admin")).toContain("supervisor");
    expect(rolesAssignableBy("admin")).not.toContain("admin");
    expect(rolesAssignableBy("admin")).not.toContain("director");
    expect(mayManageRole("admin", "admin")).toBe(false);
    expect(mayManageRole("admin", "director")).toBe(false);
  });

  it("does not grant account administration to site-scoped roles", () => {
    expect(rolesAssignableBy("project_manager")).toEqual([]);
    expect(rolesAssignableBy("supervisor")).toEqual([]);
    expect(mayManageRole("supervisor", "accounts")).toBe(false);
  });

  it("allows only an authority above a target role to reset or disable that account", () => {
    expect(mayManageRole("owner", "director")).toBe(true);
    expect(mayManageRole("super_admin", "director")).toBe(true);
    expect(mayManageRole("director", "supervisor")).toBe(true);
    expect(mayManageRole("admin", "supervisor")).toBe(true);
    expect(mayManageRole("project_manager", "supervisor")).toBe(false);
    expect(mayManageRole("admin", "director")).toBe(false);
  });

  it("requires authority over every role held by a target within the organization", () => {
    expect(mayManageMembershipRoles("director", ["supervisor", "admin"])).toBe(true);
    expect(mayManageMembershipRoles("admin", ["supervisor", "director"])).toBe(false);
    expect(mayManageMembershipRoles("director", [])).toBe(false);
  });
});
