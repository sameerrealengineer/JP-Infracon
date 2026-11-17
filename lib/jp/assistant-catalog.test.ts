import { describe, expect, it } from "vitest";
import { availableScreens, resolveAssistantAction } from "./assistant-catalog";

const SITE = "11111111-1111-4111-8111-111111111111";
const OTHER = "22222222-2222-4222-8222-222222222222";
const held = new Set(["dpr.view", "dpr.create", "issue.view", "issue.create", "task.view"]);
const context = {
  held,
  sitePermissions: new Map([[SITE, held]]),
  defaultSiteId: SITE,
};

describe("assistant actions", () => {
  it("offers only screens the person may use", () => {
    const keys = availableScreens(held).map((row) => row.key);
    expect(keys).toContain("schedule");
    expect(keys).toContain("profile");
    expect(keys).not.toContain("finance");
    expect(keys).not.toContain("modules");
    expect(keys).not.toContain("subcontract");
    expect(keys).not.toContain("billing");
  });

  it("offers the ERP screens only with their permission", () => {
    const keys = availableScreens(new Set(["subcontract.view", "purchase.view"])).map(
      (row) => row.key,
    );
    expect(keys).toEqual(expect.arrayContaining(["subcontract", "purchase"]));
    expect(keys).not.toContain("crm");
  });

  it("opens a known screen for the person's own site only", () => {
    expect(
      resolveAssistantAction({ type: "open", screen: "schedule", siteId: OTHER }, context),
    ).toEqual({
      type: "open",
      screen: "schedule",
      siteId: SITE,
      route: `/schedule?siteId=${SITE}`,
      label: "Open Schedule",
    });
    expect(resolveAssistantAction({ type: "open", screen: "finance" }, context)).toEqual({
      type: "none",
    });
    expect(resolveAssistantAction({ type: "open", screen: "../../etc" }, context)).toEqual({
      type: "none",
    });
  });

  it("starts drafts only where the person may create them", () => {
    const report = resolveAssistantAction(
      { type: "draft_report", text: "120 sqft plaster on first floor", reportKind: "DPR" },
      context,
    );
    expect(report).toMatchObject({ type: "draft_report", reportKind: "DPR", siteId: SITE });
    expect(report.type === "draft_report" && report.route).toContain("aiText=120%20sqft");
    expect(
      resolveAssistantAction({ type: "draft_report", reportKind: "DLR", text: "x" }, context),
    ).toEqual({
      type: "none",
    });
    expect(
      resolveAssistantAction({ type: "draft_issue", text: "Loose scaffolding" }, context),
    ).toMatchObject({
      type: "draft_issue",
    });
    expect(resolveAssistantAction({ type: "pay_supplier" }, context)).toEqual({ type: "none" });
  });
});

describe("assistant module changes", () => {
  const keys = ["crm", "issues", "billing"];
  it("proposes a module change only to company leaders, as a link to review and save", () => {
    const proposed = { type: "modules", modulesOn: ["crm", "bogus"], modulesOff: ["issues"] };
    expect(resolveAssistantAction(proposed, { ...context, moduleKeys: keys })).toEqual({
      type: "none",
    });
    const action = resolveAssistantAction(proposed, {
      ...context,
      canManageModules: true,
      moduleKeys: keys,
    });
    expect(action).toMatchObject({ type: "modules", on: ["crm"], off: ["issues"] });
    expect(action.type === "modules" && action.route).toBe("/modules?turnOn=crm&turnOff=issues");
  });

  it("ignores an empty or unknown change", () => {
    expect(
      resolveAssistantAction(
        { type: "modules", modulesOn: ["nope"] },
        { ...context, canManageModules: true, moduleKeys: keys },
      ),
    ).toEqual({ type: "none" });
  });
});
