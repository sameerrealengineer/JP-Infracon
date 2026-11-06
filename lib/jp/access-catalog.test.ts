import { describe, expect, it } from "vitest";
import { accessGroups, deniedPermission, mayGrant, permissionLabel } from "./access-catalog";

describe("access catalogue", () => {
  it("groups permissions by module and leaves out self-approval", () => {
    const groups = accessGroups([
      "site.view",
      "approval.self",
      "payroll.view",
      "payroll.advance",
      "document.view",
    ]);
    expect(groups.map((g) => g.key)).toEqual(["core", "documents", "payroll"]);
    expect(groups[0].permissions).toEqual(["site.view"]);
    expect(groups.find((g) => g.key === "payroll")!.permissions).toEqual([
      "payroll.view",
      "payroll.advance",
    ]);
  });

  it("labels permissions in plain words", () => {
    expect(permissionLabel("finance.payment.review")).toBe("Payment: review / approve");
    expect(permissionLabel("document.view")).toBe("Document: see");
  });

  it("only owners switch on what they do not have themselves; anyone may switch off", () => {
    const has = (key: string) => key === "document.view";
    const base = { managerIsOwner: false, managerHas: has };
    expect(mayGrant({ ...base, key: "document.view", choice: "allow" })).toBe(true);
    expect(mayGrant({ ...base, key: "payroll.approve", choice: "allow" })).toBe(false);
    expect(mayGrant({ ...base, key: "payroll.approve", choice: "deny" })).toBe(true);
    expect(
      mayGrant({ ...base, managerIsOwner: true, key: "payroll.approve", choice: "allow" }),
    ).toBe(true);
    expect(mayGrant({ ...base, managerIsOwner: true, key: "approval.self", choice: "allow" })).toBe(
      false,
    );
  });

  it("finds the permission named in a server refusal", () => {
    expect(deniedPermission("Your role does not include billing.view.")).toBe("billing.view");
    expect(
      deniedPermission("Your current role does not include finance.payment.review for this site."),
    ).toBe("finance.payment.review");
    expect(deniedPermission("Your role does not include account management.")).toBeNull();
    expect(deniedPermission("The server could not be reached.")).toBeNull();
  });
});
