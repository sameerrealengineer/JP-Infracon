import { describe, expect, it } from "vitest";
import { badgeCounts, quickActions, visibleGroups, type HomeAccess } from "./home-layout";

const access = (held: string[], admin = false): HomeAccess => ({
  can: (...keys) => keys.some((key) => held.includes(key)),
  canManageSites: admin,
  canManageAccounts: admin,
});

describe("home layout", () => {
  it("shows only modules the person's permissions allow", () => {
    const groups = visibleGroups(access(["dpr.create", "issue.view"]));
    const keys = groups.flatMap((group) => group.modules.map((module) => module.key));
    expect(keys).toEqual(["reports", "issues"]);
    expect(groups.map((group) => group.key)).toEqual(["site"]);
  });

  it("hides everything when no permission is held (e.g. all modules turned off)", () => {
    expect(visibleGroups(access([]))).toEqual([]);
    expect(quickActions(access([]))).toEqual([]);
  });

  it("admin-only entries follow the admin flags, not permissions", () => {
    const keys = visibleGroups(access([], true)).flatMap((g) => g.modules.map((m) => m.key));
    expect(keys).toEqual(["projects", "team"]);
  });

  it("quick actions prefer the marked ones and stop at the limit", () => {
    const quick = quickActions(
      access(["budget.view", "dpr.create", "material.request", "attendance.mark", "issue.view"]),
    );
    expect(quick.map((m) => m.key)).toEqual(["reports", "attendance", "issues", "requests"]);
  });

  it("counts inbox items per module", () => {
    expect(
      badgeCounts(["report.review", "report.returned", "task.overdue", "cash.post", "unknown"]),
    ).toEqual({ reports: 2, schedule: 1, finance: 1 });
  });
});
