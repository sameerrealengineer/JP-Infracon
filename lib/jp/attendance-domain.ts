/**
 * Attendance and estimated labour cost. Money is integer paise (BigInt); hours are exact hundredths.
 * An estimate is not a payable: only reviewed attendance counts as "approved earnings".
 */

export const attendanceStatuses = [
  "Full Day",
  "Half Day",
  "Absent",
  "Leave",
  "Present-hours-based",
] as const;
export type AttendanceStatus = (typeof attendanceStatuses)[number];

export type RateType =
  | "daily"
  | "hourly"
  | "shift"
  | "piece"
  | "per_connection"
  | "per_measurement"
  | "contract";

export const attendanceBasedRates: readonly RateType[] = ["daily", "hourly", "shift"];

/** Standard working day used to price hour-based attendance on a daily rate. */
export const STANDARD_DAY_HUNDREDTHS = 800n;

/** "7.5" → 750n hundredths. Rejects negatives, more than 2 decimals, or more than 24 hours. */
export function parseHours(value: string): bigint | null {
  const text = value.trim() || "0";
  if (!/^\d{1,2}(\.\d{1,2})?$/.test(text)) return null;
  const [whole, fraction = ""] = text.split(".");
  const hundredths = BigInt(whole) * 100n + BigInt(fraction.padEnd(2, "0"));
  return hundredths <= 2400n ? hundredths : null;
}

export function formatHours(hundredths: bigint): string {
  const whole = hundredths / 100n;
  const fraction = hundredths % 100n;
  return fraction === 0n
    ? `${whole}`
    : `${whole}.${String(fraction).padStart(2, "0").replace(/0$/, "")}`;
}

/** Rounds a paise fraction half-up so the estimate never drifts by more than half a paisa per row. */
function divRound(numerator: bigint, denominator: bigint): bigint {
  return (numerator * 2n + denominator) / (denominator * 2n);
}

export type EarningInput = {
  status: AttendanceStatus;
  rateType: RateType | null;
  rateMinor: number | null;
  regularHundredths: bigint;
  overtimeHundredths: bigint;
  overtimeApproved: boolean;
};

export type EarningResult =
  | { kind: "amount"; minor: bigint; overtimeMinor: bigint }
  | { kind: "missing_rate" }
  | { kind: "not_attendance_based" };

/**
 * Estimated earning for one attendance row. Overtime is paid at the base hourly equivalent and
 * only when approved; no statutory multiplier is assumed.
 */
export function estimateEarning(input: EarningInput): EarningResult {
  if (input.status === "Absent" || input.status === "Leave")
    return { kind: "amount", minor: 0n, overtimeMinor: 0n };
  if (!input.rateType || !input.rateMinor || input.rateMinor <= 0) return { kind: "missing_rate" };
  if (!attendanceBasedRates.includes(input.rateType)) return { kind: "not_attendance_based" };
  const rate = BigInt(input.rateMinor);
  const hourly =
    input.rateType === "hourly" ? rate : divRound(rate * 100n, STANDARD_DAY_HUNDREDTHS);
  let base: bigint;
  if (input.rateType === "hourly") base = divRound(rate * input.regularHundredths, 100n);
  else if (input.status === "Full Day") base = rate;
  else if (input.status === "Half Day") base = divRound(rate, 2n);
  else base = divRound(rate * input.regularHundredths, STANDARD_DAY_HUNDREDTHS);
  const overtimeMinor = input.overtimeApproved
    ? divRound(hourly * input.overtimeHundredths, 100n)
    : 0n;
  return { kind: "amount", minor: base + overtimeMinor, overtimeMinor };
}

export function validateAttendanceEntry(entry: {
  status: AttendanceStatus;
  regularHours: string;
  overtimeHours: string;
}): string | null {
  const regular = parseHours(entry.regularHours);
  const overtime = parseHours(entry.overtimeHours);
  if (regular === null || overtime === null)
    return "Hours must be between 0 and 24 with up to 2 decimals.";
  if (regular + overtime > 2400n) return "Regular and overtime hours cannot exceed 24 in a day.";
  if ((entry.status === "Absent" || entry.status === "Leave") && regular + overtime > 0n)
    return "Absent or leave cannot have working hours.";
  if (entry.status === "Present-hours-based" && regular === 0n) return "Enter the hours worked.";
  return null;
}

/** Default regular hours for a status, so supervisors only type hours when they differ. */
export function defaultHours(status: AttendanceStatus): string {
  return status === "Full Day"
    ? "8"
    : status === "Half Day"
      ? "4"
      : status === "Present-hours-based"
        ? ""
        : "0";
}
