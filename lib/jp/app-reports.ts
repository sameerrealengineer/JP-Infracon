/**
 * Problem reports from the app: a worker's "something is wrong" (money, attendance, drawing,
 * the app), a worker's forgotten PIN, staff feedback, and app errors the phone sends by itself.
 * Also plain messages for failures where the server could not answer at all.
 */

export const REPORT_SOURCES = ["worker", "pin_reset", "staff", "app_error"] as const;
export type ReportSource = (typeof REPORT_SOURCES)[number];

/** What a worker can tap, as a picture and two or three words. */
export const WORKER_PROBLEMS = [
  { key: "money", emoji: "💰", label: "Money is wrong" },
  { key: "attendance", emoji: "📅", label: "Attendance is wrong" },
  { key: "drawing", emoji: "📐", label: "Drawing not right" },
  { key: "app", emoji: "📱", label: "App not working" },
  { key: "other", emoji: "🗣️", label: "Something else" },
] as const;
export type WorkerProblem = (typeof WORKER_PROBLEMS)[number]["key"];
export const WORKER_PROBLEM_KEYS = WORKER_PROBLEMS.map((item) => item.key) as [
  WorkerProblem,
  ...WorkerProblem[],
];

export const STAFF_CATEGORIES = [
  { key: "bug", label: "Something is broken" },
  { key: "data", label: "A figure looks wrong" },
  { key: "idea", label: "Idea or request" },
  { key: "other", label: "Other" },
] as const;
export type StaffCategory = (typeof STAFF_CATEGORIES)[number]["key"];
export const STAFF_CATEGORY_KEYS = STAFF_CATEGORIES.map((item) => item.key) as [
  StaffCategory,
  ...StaffCategory[],
];

export const REPORT_MESSAGE_MAX = 1000;
export const REPORT_DETAIL_MAX = 4000;

/** Trims, joins whitespace and cuts to a length; empty becomes null. */
export function cleanText(value: string | null | undefined, max: number): string | null {
  const text = (value ?? "").replace(/\s+/g, " ").trim();
  return text ? text.slice(0, max) : null;
}

/** An error stack cut to its first lines, without the person's file paths. */
export function trimStack(stack: string | null | undefined, max = REPORT_DETAIL_MAX) {
  if (!stack) return null;
  const lines = stack
    .split("\n")
    .map((line) => line.replace(/(file|https?):\/\/[^\s)]*\/([^/\s)]+)/g, "$2").trim())
    .filter(Boolean)
    .slice(0, 12);
  return lines.join("\n").slice(0, max) || null;
}

/** Same error twice within this many minutes from one phone is kept once. */
export const DUPLICATE_WINDOW_MINUTES = 10;

/** A short fingerprint of an error so repeats can be counted instead of stored again. */
export function errorFingerprint(message: string, screen: string | null) {
  const core = message
    .replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, "<id>")
    .replace(/\d+/g, "#")
    .slice(0, 200);
  return `${screen ?? ""}|${core}`;
}

/** A PIN reset asked again within this time does not alert the supervisor twice. */
export const PIN_RESET_REPEAT_HOURS = 6;

export type TransportFailure = {
  /** The error text the network layer gave. */
  message: string;
  /** HTTP status when a response came back. */
  status?: number | null;
};

export const TRANSPORT_MESSAGES = {
  down: "The server is not answering right now (error {status}). It may be restarting. Try again in a few minutes; if it keeps happening, tell your admin.",
  busy: "Too many tries. Wait a minute and try again.",
  failed:
    "The server had a problem (error {status}). Try again; if it keeps happening, tell your admin.",
  offline: "No connection to the server. Check the internet (mobile data or Wi-Fi) and try again.",
  garbled: "The server sent a wrong answer. It may be restarting. Try again in a few minutes.",
} as const;

/**
 * A plain message (English template and values) when the server could not answer properly: no
 * internet, server restarting, a web page instead of data. Null for normal server answers,
 * whose own message is kept.
 */
export function transportError({
  message,
  status,
}: TransportFailure): { text: string; vars: Record<string, string | number> } | null {
  const vars = { status: status ?? "" };
  if (status === 502 || status === 503 || status === 504)
    return { text: TRANSPORT_MESSAGES.down, vars };
  if (status === 429) return { text: TRANSPORT_MESSAGES.busy, vars };
  if (status && status >= 500 && !/^[A-Z]/.test(message))
    return { text: TRANSPORT_MESSAGES.failed, vars };
  if (
    /Network request failed|Failed to fetch|NetworkError|Load failed|ECONNREFUSED|ENOTFOUND|ETIMEDOUT|timed? ?out|aborted/i.test(
      message,
    )
  )
    return { text: TRANSPORT_MESSAGES.offline, vars };
  if (/Unexpected token|JSON Parse error|is not valid JSON|Unexpected end of JSON/i.test(message))
    return { text: TRANSPORT_MESSAGES.garbled, vars };
  return null;
}

/** The English message from transportError, filled in. */
export function transportErrorMessage(failure: TransportFailure): string | null {
  const found = transportError(failure);
  return found
    ? found.text.replace(/\{(\w+)\}/g, (_, key: string) => String(found.vars[key] ?? ""))
    : null;
}
