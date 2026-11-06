/**
 * Worker (mistri / labour) app rules: a 6-digit PIN that is not easy to guess, lock after
 * repeated wrong PINs, and the features an authorised person switches on for each worker.
 */

export const WORKER_FEATURES = ["money", "attendance", "drawings", "call", "help"] as const;
export type WorkerFeature = (typeof WORKER_FEATURES)[number];
export const DEFAULT_WORKER_FEATURES: WorkerFeature[] = ["money", "attendance", "call", "help"];

export const MAX_WRONG_PINS = 5;
export const PIN_LOCK_MINUTES = 30;

export function checkPin(pin: string): string | null {
  if (!/^\d{6}$/.test(pin)) return "The PIN must be 6 digits.";
  if (/^(\d)\1{5}$/.test(pin)) return "Do not use the same digit six times.";
  const digits = pin.split("").map(Number);
  const up = digits.every((d, i) => i === 0 || d === (digits[i - 1] + 1) % 10);
  const down = digits.every((d, i) => i === 0 || d === (digits[i - 1] + 9) % 10);
  if (up || down) return "Do not use digits in a row like 123456.";
  return null;
}

export function parseFeatures(stored: string | null | undefined): WorkerFeature[] {
  if (!stored) return [...DEFAULT_WORKER_FEATURES];
  try {
    const parsed: unknown = JSON.parse(stored);
    if (!Array.isArray(parsed)) return [...DEFAULT_WORKER_FEATURES];
    return WORKER_FEATURES.filter((feature) => parsed.includes(feature));
  } catch {
    return [...DEFAULT_WORKER_FEATURES];
  }
}

/** After a wrong PIN: the new count and, at the limit, when the lock ends. */
export function afterWrongPin(failed: number, now: Date) {
  const next = failed + 1;
  return next >= MAX_WRONG_PINS
    ? { failedAttempts: 0, lockedUntil: new Date(now.getTime() + PIN_LOCK_MINUTES * 60_000) }
    : { failedAttempts: next, lockedUntil: null };
}

export type AttendanceMark = { status: string; approved: boolean };

/** A big, simple sign for a day's attendance, for people who read little. */
export function attendanceSign(mark: AttendanceMark) {
  if (mark.status === "Full Day" || mark.status === "Present-hours-based") return "✓";
  if (mark.status === "Half Day") return "½";
  if (mark.status === "Leave") return "L";
  return "✗";
}
