import { describe, expect, it } from "vitest";
import { effectiveNow } from "./effective-time";

describe("effectiveNow", () => {
  it("is a whole second strictly before now, so a rounded DB value is never in the future", () => {
    const now = new Date("2026-11-02T10:00:05.700Z");
    expect(effectiveNow(now).toISOString()).toBe("2026-11-02T10:00:04.000Z");
  });
});
