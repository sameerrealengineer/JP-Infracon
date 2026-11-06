import { describe, expect, it } from "vitest";
import { afterWrongPin, attendanceSign, checkPin, parseFeatures } from "./worker-app";

describe("worker app rules", () => {
  it("accepts a 6-digit PIN that is not easy to guess", () => {
    expect(checkPin("482913")).toBeNull();
    expect(checkPin("4829")).toMatch(/6 digits/);
    expect(checkPin("111111")).toMatch(/same digit/);
    expect(checkPin("123456")).toMatch(/in a row/);
    expect(checkPin("987654")).toMatch(/in a row/);
    expect(checkPin("890123")).toMatch(/in a row/);
    expect(checkPin("12a456")).toMatch(/6 digits/);
  });

  it("locks after five wrong PINs", () => {
    const now = new Date("2026-11-05T10:00:00Z");
    expect(afterWrongPin(0, now)).toEqual({ failedAttempts: 1, lockedUntil: null });
    const locked = afterWrongPin(4, now);
    expect(locked.failedAttempts).toBe(0);
    expect(locked.lockedUntil?.toISOString()).toBe("2026-11-05T10:30:00.000Z");
  });

  it("reads switched-on features, defaulting to money, attendance and call", () => {
    expect(parseFeatures(null)).toEqual(["money", "attendance", "call", "help"]);
    expect(parseFeatures('["drawings","money","bogus"]')).toEqual(["money", "drawings"]);
    expect(parseFeatures("not json")).toEqual(["money", "attendance", "call", "help"]);
  });

  it("shows attendance as a simple sign", () => {
    expect(attendanceSign({ status: "Full Day", approved: true })).toBe("✓");
    expect(attendanceSign({ status: "Half Day", approved: false })).toBe("½");
    expect(attendanceSign({ status: "Absent", approved: true })).toBe("✗");
  });
});
