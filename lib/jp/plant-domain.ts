/**
 * Plant & machinery: equipment (owned or hired), daily logsheets from the hour meter, fuel against
 * the machine's norm (litres per working hour), hire charges by hour, day or month, and service
 * due by running hours. Hours and litres are thousandths (BigInt); money is paise (BigInt).
 */

export const EQUIPMENT_TYPES = [
  "JCB / backhoe",
  "Excavator",
  "Concrete mixer",
  "Transit mixer",
  "Vibrator",
  "Tipper / truck",
  "Tractor",
  "Crane",
  "DG set",
  "Water tanker",
  "Compactor / roller",
  "Pump",
  "Other",
] as const;
export const HIRE_BASIS = ["Hour", "Day", "Month"] as const;
export type HireBasis = (typeof HIRE_BASIS)[number];

export function parseThousandths(text: string | null | undefined): bigint | null {
  if (text === null || text === undefined) return null;
  const t = String(text).trim();
  if (!/^\d{1,9}(\.\d{1,3})?$/.test(t)) return null;
  const [w, f = ""] = t.split(".");
  return BigInt(w!) * 1000n + BigInt(f.padEnd(3, "0"));
}

export function formatQty(value: bigint, places = 1) {
  const neg = value < 0n;
  const abs = neg ? -value : value;
  const scale = 10n ** BigInt(3 - places);
  const rounded = (abs + scale / 2n) / scale;
  const unit = 10n ** BigInt(places);
  const whole = rounded / unit;
  const frac = (rounded % unit).toString().padStart(places, "0");
  return `${neg ? "-" : ""}${whole}${places ? `.${frac}` : ""}`;
}

/** Working hours from meter readings, less idle; a problem text when readings are wrong. */
export function logHours(input: {
  startMeter: bigint;
  endMeter: bigint;
  idle: bigint;
}): { ok: true; running: bigint; working: bigint } | { ok: false; error: string } {
  if (input.endMeter < input.startMeter)
    return { ok: false, error: "The closing meter is below the opening meter." };
  const running = input.endMeter - input.startMeter;
  if (running > 24_000n)
    return { ok: false, error: "More than 24 hours in one day — check the meter readings." };
  if (input.idle > running)
    return { ok: false, error: "Idle hours are more than the running hours." };
  return { ok: true, running, working: running - input.idle };
}

/** Fuel against norm: expected litres = running hours × norm; variance percent (2 decimals). */
export function fuelCheck(fuel: bigint, running: bigint, normPerHour: bigint | null) {
  if (!normPerHour || normPerHour <= 0n || running <= 0n)
    return { expected: null, variancePct: null, high: false };
  const expected = (running * normPerHour + 500n) / 1000n;
  if (expected === 0n) return { expected, variancePct: null, high: false };
  const variancePct = Number(((fuel - expected) * 10000n) / expected) / 100;
  return { expected, variancePct, high: variancePct > 10 };
}

/**
 * Hire charge for a period: Hour → working hours × rate; Day → days with any working hours ×
 * rate; Month → rate × days on hire ÷ 30 (rounded to the paisa). Paise.
 */
export function hireCharge(
  basis: HireBasis,
  rateMinor: bigint,
  logs: readonly { workingThousandths: bigint }[],
  daysOnHire: number,
) {
  if (basis === "Hour") {
    const hours = logs.reduce((sum, log) => sum + log.workingThousandths, 0n);
    return (hours * rateMinor + 500n) / 1000n;
  }
  if (basis === "Day")
    return BigInt(logs.filter((log) => log.workingThousandths > 0n).length) * rateMinor;
  return (rateMinor * BigInt(Math.max(0, daysOnHire)) + 15n) / 30n;
}

/** Hours left to the next service (negative when overdue). */
export function serviceLeft(
  lastServiceMeter: bigint | null,
  currentMeter: bigint | null,
  intervalHours: number | null,
) {
  if (!intervalHours || lastServiceMeter === null || currentMeter === null) return null;
  return lastServiceMeter + BigInt(intervalHours) * 1000n - currentMeter;
}

/** EQ-001 */
export function equipmentCode(sequence: number) {
  return `EQ-${String(sequence).padStart(3, "0")}`;
}
