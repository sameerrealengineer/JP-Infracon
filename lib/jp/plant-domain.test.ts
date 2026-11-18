import { describe, expect, it } from "vitest";
import {
  equipmentCode,
  formatQty,
  fuelCheck,
  hireCharge,
  logHours,
  parseThousandths,
  serviceLeft,
} from "./plant-domain";

describe("plant and machinery", () => {
  it("works out hours from the meter and refuses wrong readings", () => {
    const h = logHours({
      startMeter: parseThousandths("1250.5")!,
      endMeter: parseThousandths("1259")!,
      idle: parseThousandths("1.5")!,
    });
    expect(h).toEqual({ ok: true, running: 8500n, working: 7000n });
    expect(logHours({ startMeter: 10n, endMeter: 5n, idle: 0n }).ok).toBe(false);
    expect(logHours({ startMeter: 0n, endMeter: 30_000n, idle: 0n }).ok).toBe(false);
  });

  it("checks fuel against the norm and flags more than 10% over", () => {
    // 8.5 h × 6 L/h = 51 L; 60 L used = +17.65%.
    const f = fuelCheck(60_000n, 8_500n, 6_000n);
    expect(f.expected).toBe(51_000n);
    expect(f.variancePct).toBe(17.64);
    expect(f.high).toBe(true);
    expect(fuelCheck(50_000n, 8_500n, null).expected).toBeNull();
  });

  it("charges hire by hour, day or month", () => {
    const logs = [
      { workingThousandths: 7_000n },
      { workingThousandths: 0n },
      { workingThousandths: 8_500n },
    ];
    expect(hireCharge("Hour", 120000n, logs, 3)).toBe(1860000n); // 15.5 h × ₹1,200
    expect(hireCharge("Day", 900000n, logs, 3)).toBe(1800000n); // 2 working days
    expect(hireCharge("Month", 9000000n, logs, 15)).toBe(4500000n); // half a month
  });

  it("tracks service due and formats", () => {
    expect(serviceLeft(1000_000n, 1240_000n, 250)).toBe(10_000n);
    expect(serviceLeft(null, 1n, 250)).toBeNull();
    expect(formatQty(8_500n)).toBe("8.5");
    expect(equipmentCode(4)).toBe("EQ-004");
  });
});
