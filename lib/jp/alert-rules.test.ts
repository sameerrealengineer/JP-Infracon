import { describe, expect, it } from "vitest";
import { alertCategoryOf, cleanRules, decideChannels, type AlertRule } from "./alert-rules";

const optIn = { push: true, whatsapp: true, sms: true };
const base = {
  role: "supervisor" as const,
  rules: [] as AlertRule[],
  mutedCategories: [] as string[],
  disabledModules: [] as never[],
  optIn,
  urgent: false,
};

describe("alert rules", () => {
  it("maps alert kinds to categories; system alerts have none", () => {
    expect(alertCategoryOf("report.returned")).toBe("reports");
    expect(alertCategoryOf("material_request.approved")).toBe("materials");
    expect(alertCategoryOf("presence.arrived")).toBe("presence");
    expect(alertCategoryOf("test")).toBeNull();
  });

  it("with no rule, sends on every opted-in channel; SMS only when urgent", () => {
    expect(decideChannels({ ...base, kind: "issue.raised" })).toMatchObject({
      push: true,
      whatsapp: true,
      sms: false,
      skipped: null,
    });
    expect(decideChannels({ ...base, kind: "issue.raised", urgent: true }).sms).toBe(true);
  });

  it("a company rule turns channels off for a role and can strip details", () => {
    const rules = cleanRules([
      {
        category: "reports",
        role: "supervisor",
        push: true,
        whatsapp: false,
        sms: false,
        detail: "title",
      },
    ]);
    expect(decideChannels({ ...base, kind: "report.approved", rules })).toMatchObject({
      push: true,
      whatsapp: false,
      detail: "title",
    });
    // Another role keeps the default.
    expect(
      decideChannels({ ...base, kind: "report.approved", rules, role: "owner" }).whatsapp,
    ).toBe(true);
  });

  it("personal opt-outs and mutes only narrow; module off stops everything", () => {
    expect(
      decideChannels({ ...base, kind: "issue.raised", optIn: { ...optIn, whatsapp: false } })
        .whatsapp,
    ).toBe(false);
    expect(
      decideChannels({ ...base, kind: "issue.raised", mutedCategories: ["issues"] }).skipped,
    ).toBe("muted by person");
    expect(
      decideChannels({ ...base, kind: "budget.proposed", disabledModules: ["budget"] as never[] })
        .skipped,
    ).toBe("module off");
    const allOff = cleanRules([
      { category: "issues", role: "supervisor", push: false, whatsapp: false, sms: false },
    ]);
    expect(decideChannels({ ...base, kind: "issue.raised", rules: allOff }).skipped).toBeTruthy();
  });

  it("drops unknown categories and roles, and duplicates", () => {
    expect(
      cleanRules([
        { category: "reports", role: "owner" },
        { category: "reports", role: "owner", push: false },
        { category: "nope" as never, role: "owner" },
        { category: "reports", role: "ceo" as never },
      ]),
    ).toHaveLength(1);
  });
});
