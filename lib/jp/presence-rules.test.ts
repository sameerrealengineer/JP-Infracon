import { describe, expect, it } from "vitest";
import {
  DEFAULT_PRESENCE,
  checkPresenceSettings,
  istClock,
  parseDays,
  shouldAlert,
  withinWorkHours,
} from "./presence-rules";

// 2026-11-05 is a Thursday.
const ist = (time: string, date = "2026-11-05") => new Date(`${date}T${time}:00+05:30`);

describe("presence alerts", () => {
  it("reads the clock in India time", () => {
    expect(istClock(new Date("2026-11-05T04:00:00Z"))).toMatchObject({ day: 4, text: "09:30" });
    expect(istClock(new Date("2026-11-05T20:00:00Z"))).toMatchObject({ day: 5, text: "01:30" });
  });

  it("alerts on leaving only inside working hours on working days", () => {
    expect(withinWorkHours(ist("08:00"), DEFAULT_PRESENCE)).toBe(true);
    expect(withinWorkHours(ist("17:59"), DEFAULT_PRESENCE)).toBe(true);
    expect(withinWorkHours(ist("18:00"), DEFAULT_PRESENCE)).toBe(false);
    expect(withinWorkHours(ist("07:59"), DEFAULT_PRESENCE)).toBe(false);
    expect(withinWorkHours(ist("11:00", "2026-11-08"), DEFAULT_PRESENCE)).toBe(false); // Sunday
    expect(shouldAlert("Left", ist("14:30"), DEFAULT_PRESENCE)).toBe(true);
    expect(shouldAlert("Arrived", ist("14:30"), DEFAULT_PRESENCE)).toBe(false);
    expect(shouldAlert("Left", ist("21:00"), DEFAULT_PRESENCE)).toBe(false);
    expect(shouldAlert("Arrived", ist("08:10"), { ...DEFAULT_PRESENCE, alertOnArrive: true })).toBe(
      true,
    );
  });

  it("checks settings", () => {
    expect(checkPresenceSettings(DEFAULT_PRESENCE)).toBeNull();
    expect(checkPresenceSettings({ ...DEFAULT_PRESENCE, workStart: "8am" })).toMatch(/08:00/);
    expect(checkPresenceSettings({ ...DEFAULT_PRESENCE, workEnd: "07:00" })).toMatch(/after/);
    expect(checkPresenceSettings({ ...DEFAULT_PRESENCE, workDays: [] })).toMatch(/working day/);
    expect(parseDays("6, 1,1,x,9")).toEqual([1, 6]);
    expect(parseDays(null)).toEqual([1, 2, 3, 4, 5, 6]);
  });
});
