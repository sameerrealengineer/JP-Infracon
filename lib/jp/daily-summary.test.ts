import { describe, expect, it } from "vitest";
import { formatDailySummary, istClock, rupees, summaryDue } from "./daily-summary";

describe("daily summary", () => {
  it("is due at 11 PM India time, once a day", () => {
    // 17:29 UTC = 22:59 IST; 17:30 UTC = 23:00 IST.
    expect(summaryDue(new Date("2026-11-15T17:29:00Z"), null)).toBe(false);
    expect(summaryDue(new Date("2026-11-15T17:30:00Z"), null)).toBe(true);
    expect(summaryDue(new Date("2026-11-15T17:45:00Z"), "2026-11-15")).toBe(false);
    // 18:40 UTC is 00:10 IST the next day: not before 11 PM again.
    expect(summaryDue(new Date("2026-11-15T18:40:00Z"), "2026-11-15")).toBe(false);
    expect(istClock(new Date("2026-11-15T18:40:00Z"))).toEqual({ date: "2026-11-16", hour: 0 });
  });

  it("writes rupees the Indian way from exact paise", () => {
    expect(rupees("125000000")).toBe("₹12,50,000");
    expect(rupees("50050")).toBe("₹500");
    expect(rupees(0n)).toBe("₹0");
  });

  it("shows only the parts the person may see, with money totals", () => {
    const text = formatDailySummary({
      personName: "Sameer",
      date: "2026-11-15",
      waitingForYou: 3,
      sites: [
        {
          siteName: "Tank 1",
          attendance: { present: 8, half: 1, absent: 2, leave: 1, waiting: 4 },
          reports: { dpr: "Submitted", dlr: null },
          measurements: 2,
          supplierPayments: [{ who: "Bhagabati Enterprises", amountMinor: "1500000", why: "Pump" }],
          pettyCash: [],
          advances: [{ who: "Pahalad", amountMinor: "200000", why: "Festival" }],
        },
        {
          siteName: "Kalyan Mandap",
          attendance: null,
          reports: null,
          measurements: null,
          supplierPayments: null,
          pettyCash: null,
          advances: null,
        },
      ],
    });
    expect(text).toContain("8 present, 1 half day, 2 absent, 1 on leave (4 waiting for approval)");
    expect(text).toContain("DPR Submitted, DLR not sent");
    expect(text).toContain("Bhagabati Enterprises ₹15,000 — Pump");
    expect(text).toContain("Pahalad ₹2,000 — Festival");
    expect(text).toContain("Money out today: ₹17,000");
    expect(text).toContain("Waiting for you in the app: 3");
    expect(text).not.toContain("Petty cash spent");
  });
});
