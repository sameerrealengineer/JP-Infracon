import { describe, expect, it } from "vitest";
import { resolveOrganizationPermission, resolveSitePermission, roleAllows } from "./policy";

const scope = { organizationId: "org-a", projectId: "project-a", siteId: "site-a" };
const now = new Date("2026-10-26T12:00:00Z");

describe("server permission policy", () => {
  it("allows only the documented role defaults", () => {
    expect(roleAllows("supervisor", "dpr.create")).toBe(true);
    expect(roleAllows("supervisor", "dpr.review")).toBe(false);
    expect(roleAllows("supervisor", "dpr.view")).toBe(true);
    expect(roleAllows("accounts", "material.request")).toBe(false);
    expect(roleAllows("accounts", "material.request.view")).toBe(false);
    expect(roleAllows("storekeeper", "material.request.view")).toBe(true);
  });

  it("gives supervisors task visibility and field status updates without schedule management", () => {
    expect(roleAllows("supervisor", "task.view")).toBe(true);
    expect(roleAllows("supervisor", "task.status.update")).toBe(true);
    expect(roleAllows("supervisor", "task.manage")).toBe(false);
    expect(roleAllows("project_manager", "task.manage")).toBe(true);
    expect(roleAllows("accounts", "task.view")).toBe(false);
  });

  it("separates petty-cash fund setup, site-movement maker rights, and checker/poster authority", () => {
    expect(roleAllows("admin", "finance.cash.fund.manage")).toBe(true);
    expect(roleAllows("accounts", "finance.cash.fund.manage")).toBe(true);
    expect(roleAllows("supervisor", "finance.cash.view")).toBe(true);
    expect(roleAllows("supervisor", "finance.cash.movement.create")).toBe(true);
    expect(roleAllows("supervisor", "finance.cash.movement.submit")).toBe(true);
    expect(roleAllows("supervisor", "finance.cash.movement.cancel")).toBe(true);
    expect(roleAllows("supervisor", "finance.cash.movement.review")).toBe(false);
    expect(roleAllows("supervisor", "finance.cash.movement.post")).toBe(false);
    expect(roleAllows("accounts", "finance.cash.movement.review")).toBe(false);
    expect(roleAllows("accounts", "finance.cash.movement.post")).toBe(false);
    expect(roleAllows("director", "finance.cash.movement.review")).toBe(true);
    expect(roleAllows("admin", "finance.cash.movement.post")).toBe(true);
    expect(roleAllows("auditor", "finance.cash.view")).toBe(true);
    expect(roleAllows("auditor", "finance.cash.movement.create")).toBe(false);
    expect(roleAllows("storekeeper", "finance.cash.view")).toBe(false);
  });

  it("separates workforce capture, KYC review, and restricted compensation access", () => {
    expect(roleAllows("supervisor", "workforce.view")).toBe(true);
    expect(roleAllows("supervisor", "workforce.manage")).toBe(true);
    expect(roleAllows("supervisor", "workforce.kyc.view")).toBe(false);
    expect(roleAllows("supervisor", "workforce.kyc.review")).toBe(false);
    expect(roleAllows("supervisor", "workforce.review")).toBe(false);
    expect(roleAllows("supervisor", "compensation.view")).toBe(false);
    expect(roleAllows("project_manager", "workforce.review")).toBe(true);
    expect(roleAllows("project_manager", "workforce.kyc.review")).toBe(true);
    expect(roleAllows("project_manager", "compensation.view")).toBe(false);
    expect(roleAllows("accounts", "compensation.view")).toBe(true);
    expect(roleAllows("accounts", "workforce.kyc.view")).toBe(true);
    expect(roleAllows("accounts", "workforce.kyc.review")).toBe(false);
    expect(roleAllows("auditor", "workforce.kyc.view")).toBe(false);
    expect(roleAllows("auditor", "compensation.view")).toBe(true);
    expect(roleAllows("auditor", "compensation.manage")).toBe(false);
  });

  it("separates inventory viewing, catalogue management, movement submission, and posting review", () => {
    expect(roleAllows("supervisor", "inventory.view")).toBe(true);
    expect(roleAllows("supervisor", "inventory.transact")).toBe(true);
    expect(roleAllows("supervisor", "inventory.catalog.manage")).toBe(false);
    expect(roleAllows("supervisor", "inventory.review")).toBe(false);
    expect(roleAllows("storekeeper", "inventory.catalog.manage")).toBe(false);
    expect(roleAllows("storekeeper", "inventory.review")).toBe(false);
    expect(roleAllows("project_manager", "inventory.review")).toBe(true);
    expect(roleAllows("accounts", "inventory.view")).toBe(false);
    expect(roleAllows("auditor", "inventory.view")).toBe(true);
    expect(roleAllows("auditor", "inventory.transact")).toBe(false);
  });

  it("requires organization scope to manage the shared material catalogue", () => {
    const siteGrant = [{ scopeType: "site" as const, scopeId: "site-a", permissionKey: "inventory.catalog.manage", effect: "allow" as const, status: "Active" as const, effectiveFrom: new Date("2026-01-01"), effectiveTo: null }];
    const organizationGrant = [{ scopeType: "organization" as const, scopeId: "org-a", permissionKey: "inventory.catalog.manage", effect: "allow" as const, status: "Active" as const, effectiveFrom: new Date("2026-01-01"), effectiveTo: null }];
    expect(resolveOrganizationPermission({ role: "storekeeper", permissionKey: "inventory.catalog.manage", organizationId: "org-a", grants: siteGrant, now })).toBe(false);
    expect(resolveOrganizationPermission({ role: "storekeeper", permissionKey: "inventory.catalog.manage", organizationId: "org-a", grants: organizationGrant, now })).toBe(true);
    expect(resolveOrganizationPermission({ role: "admin", permissionKey: "inventory.catalog.manage", organizationId: "org-a", grants: [{ ...organizationGrant[0], effect: "deny" }], now })).toBe(false);
  });

  it("requires organisation-level authority for the shared supplier master", () => {
    const siteGrant = [{ scopeType: "site" as const, scopeId: "site-a", permissionKey: "vendor.create", effect: "allow" as const, status: "Active" as const, effectiveFrom: new Date("2026-01-01"), effectiveTo: null }];
    const organizationGrant = [{ scopeType: "organization" as const, scopeId: "org-a", permissionKey: "vendor.create", effect: "allow" as const, status: "Active" as const, effectiveFrom: new Date("2026-01-01"), effectiveTo: null }];
    expect(resolveOrganizationPermission({ role: "supervisor", permissionKey: "vendor.create", organizationId: "org-a", grants: siteGrant, now })).toBe(false);
    expect(resolveOrganizationPermission({ role: "supervisor", permissionKey: "vendor.create", organizationId: "org-a", grants: organizationGrant, now })).toBe(true);
  });

  it("lets an explicit scoped grant permit a capability without changing the role", () => {
    expect(resolveSitePermission({
      role: "supervisor",
      permissionKey: "dpr.review",
      scope,
      now,
      grants: [{ scopeType: "site", scopeId: "site-a", permissionKey: "dpr.review", effect: "allow", status: "Active", effectiveFrom: new Date("2026-01-01"), effectiveTo: null }],
    })).toBe(true);
  });

  it("gives matching explicit denies precedence over role defaults and allows", () => {
    expect(resolveSitePermission({
      role: "supervisor",
      permissionKey: "dpr.create",
      scope,
      now,
      grants: [
        { scopeType: "organization", scopeId: "org-a", permissionKey: "dpr.create", effect: "allow", status: "Active", effectiveFrom: new Date("2026-01-01"), effectiveTo: null },
        { scopeType: "site", scopeId: "site-a", permissionKey: "dpr.create", effect: "deny", status: "Active", effectiveFrom: new Date("2026-01-01"), effectiveTo: null },
      ],
    })).toBe(false);
  });

  it("lets an explicit scoped site.view deny revoke default site metadata visibility", () => {
    expect(resolveSitePermission({
      role: "supervisor",
      permissionKey: "site.view",
      scope,
      now,
      grants: [{ scopeType: "site", scopeId: "site-a", permissionKey: "site.view", effect: "deny", status: "Active", effectiveFrom: new Date("2026-01-01"), effectiveTo: null }],
    })).toBe(false);
  });

  it("ignores grants for other sites, revoked grants, and grants outside their dates", () => {
    const grants = [
      { scopeType: "site" as const, scopeId: "site-b", permissionKey: "dpr.review", effect: "allow" as const, status: "Active" as const, effectiveFrom: new Date("2026-01-01"), effectiveTo: null },
      { scopeType: "site" as const, scopeId: "site-a", permissionKey: "dpr.review", effect: "allow" as const, status: "Revoked" as const, effectiveFrom: new Date("2026-01-01"), effectiveTo: null },
      { scopeType: "site" as const, scopeId: "site-a", permissionKey: "dpr.review", effect: "allow" as const, status: "Active" as const, effectiveFrom: new Date("2027-01-01"), effectiveTo: null },
    ];
    expect(resolveSitePermission({ role: "supervisor", permissionKey: "dpr.review", scope, grants, now })).toBe(false);
  });

  it("separates supplier-payment capture from manager posting and keeps auditors read-only", () => {
    expect(roleAllows("supervisor", "finance.invoice.create")).toBe(true);
    expect(roleAllows("supervisor", "finance.invoice.submit")).toBe(true);
    expect(roleAllows("supervisor", "finance.invoice.review")).toBe(false);
    expect(roleAllows("project_manager", "finance.invoice.review")).toBe(true);
    expect(roleAllows("accounts", "vendor.create")).toBe(true);
    expect(roleAllows("auditor", "finance.invoice.view")).toBe(true);
    expect(roleAllows("auditor", "finance.invoice.create")).toBe(false);
    expect(roleAllows("supervisor", "payment.post")).toBe(false);
    expect(roleAllows("accounts", "finance.payment.create")).toBe(true);
    expect(roleAllows("accounts", "finance.payment.submit")).toBe(true);
    expect(roleAllows("accounts", "finance.payment.review")).toBe(false);
    expect(roleAllows("accounts", "finance.payment.post")).toBe(false);
    expect(roleAllows("director", "finance.payment.review")).toBe(true);
    expect(roleAllows("admin", "finance.payment.post")).toBe(true);
    expect(roleAllows("supervisor", "finance.payment.view")).toBe(false);
    expect(roleAllows("auditor", "finance.payment.view")).toBe(true);
    expect(roleAllows("auditor", "finance.payment.post")).toBe(false);
    expect(roleAllows("storekeeper", "finance.invoice.view")).toBe(false);
  });
});
