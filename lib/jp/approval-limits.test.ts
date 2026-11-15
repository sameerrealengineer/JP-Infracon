import { describe, expect, it } from "vitest";
import { APPROVAL_AREAS, AREA_LABELS, ceilingExceeded, rupeesText } from "./approval-limits";

describe("approval limits", () => {
  it("has a label per area", () => {
    for (const area of APPROVAL_AREAS) expect(AREA_LABELS[area]).toBeTruthy();
  });

  it("refuses only above the ceiling, and never limits the owner", () => {
    const lakh = 100_000n * 100n;
    expect(ceilingExceeded("project_manager", 150_000n * 100n, lakh)).toBe(lakh);
    expect(ceilingExceeded("project_manager", lakh, lakh)).toBeNull();
    expect(ceilingExceeded("project_manager", 10n ** 12n, null)).toBeNull();
    expect(ceilingExceeded("owner", 10n ** 12n, lakh)).toBeNull();
    expect(ceilingExceeded("super_admin", 10n ** 12n, lakh)).toBeNull();
  });

  it("writes rupees the Indian way", () => {
    expect(rupeesText(150_000n * 100n)).toBe("₹1,50,000");
  });
});
