import { describe, expect, it } from "vitest";
import { delegationEnd, delegationKeys, delegationState, timeLeft } from "./delegation-policy";

const now = new Date("2026-11-02T10:00:00.000Z");

describe("delegation policy", () => {
  it("merges bundle keys without duplicates", () => {
    const keys = delegationKeys(["site_operations", "self_approval"]);
    expect(keys).toContain("dpr.review");
    expect(keys).toContain("approval.self");
    expect(new Set(keys).size).toBe(keys.length);
    expect(delegationKeys(["finance"])).not.toContain("approval.self");
  });
  it("computes end times", () => {
    expect(delegationEnd("2d", now)?.toISOString()).toBe("2026-11-04T10:00:00.000Z");
    expect(delegationEnd("project", now)).toBeNull();
  });
  it("derives state from status and dates", () => {
    const base = {
      status: "Active" as const,
      effectiveFrom: "2026-11-02T09:00:00Z",
      effectiveTo: "2026-11-02T11:00:00Z",
    };
    expect(delegationState(base, now)).toBe("Active");
    expect(delegationState({ ...base, effectiveTo: "2026-11-02T09:30:00Z" }, now)).toBe("Expired");
    expect(delegationState({ ...base, status: "Revoked" }, now)).toBe("Revoked");
    expect(delegationState({ ...base, effectiveFrom: "2026-11-03T00:00:00Z" }, now)).toBe(
      "Scheduled",
    );
  });
  it("describes time left", () => {
    expect(timeLeft("2026-11-04T13:00:00Z", now)).toBe("2 days 3 h left");
    expect(timeLeft("2026-11-02T10:45:00Z", now)).toBe("45 min left");
    expect(timeLeft(null, now)).toBe("until revoked");
  });
});
