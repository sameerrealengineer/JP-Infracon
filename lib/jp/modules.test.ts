import { describe, expect, it } from "vitest";
import {
  A_CLASS_ON,
  MODULE_KEYS,
  cleanModuleList,
  defaultDisabledModules,
  isPermissionDisabled,
  moduleForAuditAction,
  moduleForPermission,
  parseDisabledModules,
} from "./modules";
import { permissionKeys } from "../../server/jp/capabilities";

describe("modules", () => {
  it("maps permissions to modules and keeps core permissions on", () => {
    expect(moduleForPermission("dpr.create")).toBe("reports");
    expect(moduleForPermission("vendor.view")).toBe("finance");
    expect(moduleForPermission("compensation.view")).toBe("workforce");
    expect(moduleForPermission("site.view")).toBeNull();
    expect(moduleForPermission("approval.self")).toBeNull();
    expect(isPermissionDisabled("budget.view", ["budget"])).toBe(true);
    expect(isPermissionDisabled("site.manage", ["budget"])).toBe(false);
  });

  it("covers every permission except the core ones", () => {
    const core = permissionKeys.filter((key) => moduleForPermission(key) === null);
    expect(core.sort()).toEqual([
      "approval.self",
      "audit.view",
      "site.manage",
      "site.view",
      "user.manage",
    ]);
  });

  it("parses and cleans stored lists", () => {
    expect(parseDisabledModules('["budget","nope","reports","budget"]')).toEqual([
      "reports",
      "budget",
    ]);
    expect(parseDisabledModules("not json")).toEqual([]);
    expect(cleanModuleList(["inventory", "finance"])).toEqual(["inventory", "finance"]);
  });

  it("maps audit actions to modules for usage counts", () => {
    expect(moduleForAuditAction("petty_cash.posted")).toBe("finance");
    expect(moduleForAuditAction("report.submitted")).toBe("reports");
    expect(moduleForAuditAction("account.created")).toBeNull();
  });

  it("starts an A-Class contractor with the essentials on and the rest off", () => {
    const off = defaultDisabledModules();
    for (const key of [
      "reports",
      "attendance",
      "workforce",
      "finance",
      "subcontract",
      "payroll",
      "billing",
    ])
      expect(off).not.toContain(key);
    expect(off).toEqual(
      expect.arrayContaining(["issues", "budget", "purchase", "accounts", "crm"]),
    );
    expect(off.length + A_CLASS_ON.length).toBe(MODULE_KEYS.length);
  });
});
