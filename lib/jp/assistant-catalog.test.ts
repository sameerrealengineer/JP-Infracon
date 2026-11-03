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
