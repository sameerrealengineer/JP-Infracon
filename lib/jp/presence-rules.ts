/**
 * When a site arrival/departure should alert someone. Sites work in India time (IST, UTC+5:30,
 * no daylight saving). An alert goes only on working days inside working hours, so nobody gets
 * messages at night or on the weekly off.
 */

export type PresenceSettings = {
  workStart: string; // "08:00"
  workEnd: string; // "18:00"
  workDays: number[]; // 0 = Sunday … 6 = Saturday
  alertOnLeave: boolean;
  alertOnArrive: boolean;
};

export const DEFAULT_PRESENCE: PresenceSettings = {
  workStart: "08:00",
  workEnd: "18:00",
  workDays: [1, 2, 3, 4, 5, 6],
  alertOnLeave: true,
  alertOnArrive: false,
};

const IST_OFFSET_MINUTES = 330;

export function parseClock(value: string): number | null {
  const match = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(value.trim());
  return match ? Number(match[1]) * 60 + Number(match[2]) : null;
}

/** Day of week (0 = Sunday) and minutes since midnight in India time. */
export function istClock(at: Date) {
  const shifted = new Date(at.getTime() + IST_OFFSET_MINUTES * 60_000);
  return {
    day: shifted.getUTCDay(),
    minutes: shifted.getUTCHours() * 60 + shifted.getUTCMinutes(),
    text: `${String(shifted.getUTCHours()).padStart(2, "0")}:${String(shifted.getUTCMinutes()).padStart(2, "0")}`,
  };
}

export function withinWorkHours(at: Date, settings: PresenceSettings) {
  const start = parseClock(settings.workStart);
  const end = parseClock(settings.workEnd);
  if (start === null || end === null) return false;
  const clock = istClock(at);
  if (!settings.workDays.includes(clock.day)) return false;
  return clock.minutes >= start && clock.minutes < end;
}

export function shouldAlert(eventType: "Arrived" | "Left", at: Date, settings: PresenceSettings) {
  const wanted = eventType === "Left" ? settings.alertOnLeave : settings.alertOnArrive;
  return wanted && withinWorkHours(at, settings);
}

export function checkPresenceSettings(settings: PresenceSettings): string | null {
  const start = parseClock(settings.workStart);
  const end = parseClock(settings.workEnd);
  if (start === null || end === null) return "Enter times like 08:00 and 18:00.";
  if (end <= start) return "The end time must be after the start time.";
  if (!settings.workDays.length) return "Choose at least one working day.";
  if (settings.workDays.some((day) => !Number.isInteger(day) || day < 0 || day > 6))
    return "Working days are 0 (Sunday) to 6 (Saturday).";
  return null;
}

/** "1,2,3" ↔ [1, 2, 3], ignoring anything that is not a day. */
export function parseDays(text: string | null | undefined): number[] {
  if (!text) return [...DEFAULT_PRESENCE.workDays];
  return [
    ...new Set(
      text
        .split(",")
        .map((part) => Number(part.trim()))
        .filter((day) => Number.isInteger(day) && day >= 0 && day <= 6),
    ),
  ].sort();
}
