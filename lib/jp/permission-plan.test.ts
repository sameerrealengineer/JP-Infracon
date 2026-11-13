import { describe, expect, it } from "vitest";
import {
  PERMISSION_TEXT,
  blockedPermissions,
  browserStatus,
  nativeStatus,
  permissionList,
  stillToAsk,
} from "./permission-plan";

describe("permission plan", () => {
  it("asks notifications first on every platform (browsers need it straight after a tap)", () => {
    for (const platform of ["android", "ios", "web"] as const)
      expect(permissionList(platform)[0]).toBe("notifications");
  });

  it("asks background location on Android only, after normal location", () => {
    const android = permissionList("android");
    expect(android.indexOf("backgroundLocation")).toBeGreaterThan(android.indexOf("location"));
    expect(permissionList("web")).not.toContain("backgroundLocation");
    expect(permissionList("ios")).not.toContain("backgroundLocation");
  });

  it("does not ask for files in a browser", () => {
    expect(permissionList("web")).not.toContain("photos");
    expect(permissionList("android")).toContain("photos");
  });

  it("has text for every permission", () => {
    for (const key of permissionList("android")) expect(PERMISSION_TEXT[key].title).toBeTruthy();
  });

  it("asks only what is still undecided; blocked ones go to settings", () => {
    const list = permissionList("android");
    const statuses = {
      notifications: "granted",
      microphone: "blocked",
      camera: "ask",
      photos: "unavailable",
    } as const;
    expect(stillToAsk(list, statuses)).toEqual(["camera", "location", "backgroundLocation"]);
    expect(blockedPermissions(list, statuses)).toEqual(["microphone"]);
  });

  it("maps native answers", () => {
    expect(nativeStatus({ granted: true })).toBe("granted");
    expect(nativeStatus({ granted: false, canAskAgain: true })).toBe("ask");
    expect(nativeStatus({ granted: false, canAskAgain: false })).toBe("blocked");
    expect(nativeStatus({ granted: false })).toBe("ask");
  });

  it("maps browser states", () => {
    expect(browserStatus("granted")).toBe("granted");
    expect(browserStatus("denied")).toBe("blocked");
    expect(browserStatus("prompt")).toBe("ask");
    expect(browserStatus(undefined)).toBe("ask");
  });
});
