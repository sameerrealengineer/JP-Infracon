import { describe, expect, it } from "vitest";

import { siteScopedRoute } from "./site-route";

describe("siteScopedRoute", () => {
  it("adds the site to a module link", () => {
    expect(siteScopedRoute("/finance", "site-b")).toBe("/finance?siteId=site-b");
  });

  it("opens the stack copy of a tab register so Back returns to the caller", () => {
    expect(siteScopedRoute("/(tabs)/reports", "s1")).toBe("/site-reports?siteId=s1");
    expect(siteScopedRoute("/(tabs)/requests", "s1")).toBe("/site-requests?siteId=s1");
  });

  it("leaves the link alone without a site or when it already has a query", () => {
    expect(siteScopedRoute("/(tabs)/reports", null)).toBe("/(tabs)/reports");
    expect(siteScopedRoute("/finance", "")).toBe("/finance");
    expect(siteScopedRoute("/finance?tab=cash", "s1")).toBe("/finance?tab=cash");
  });

  it("encodes the site id", () => {
    expect(siteScopedRoute("/schedule", "a b&c")).toBe("/schedule?siteId=a%20b%26c");
  });
});
