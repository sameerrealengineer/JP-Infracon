import { formatStockQuantity, parseStockQuantity } from "./inventory-domain";

/**
 * Daily Progress Report rules shared by the screen and the server.
 * Quantities are exact thousandths (strings in, strings out); percentages have two decimals.
 */

export const WEATHER_OPTIONS = ["Clear", "Cloudy", "Rain", "Heavy rain", "Hot", "Windy"] as const;
export type Weather = (typeof WEATHER_OPTIONS)[number];

export const SITE_STATUS_OPTIONS = ["On track", "Delayed", "Work stopped"] as const;
export type SiteDayStatus = (typeof SITE_STATUS_OPTIONS)[number];

export const MAX_DPR_ITEMS = 40;

export type DprItemInput = {
  taskId?: string | null;
  workItemCode?: string | null;
  description: string;
  locationLabel?: string | null;
  unitCode?: string | null;
  plannedQuantity?: string | null;
  completedQuantityToday?: string | null;
  cumulativeQuantity?: string | null;
  remarks?: string | null;
};

export type DprItem = {
  taskId: string | null;
  workItemCode: string | null;
  description: string;
  locationLabel: string | null;
  unitCode: string | null;
  plannedQuantity: string | null;
  completedQuantityToday: string | null;
  cumulativeQuantity: string | null;
  /** Cumulative ÷ planned, as an estimate. Null when either side is missing. */
  estimatedPercent: string | null;
  remarks: string | null;
};

function clean(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

function quantity(value: string | null | undefined, label: string): bigint | null {
  const text = clean(value);
  if (text === null) return null;
  try {
    return parseStockQuantity(text, true);
  } catch {
    throw new Error(`${label}: enter a number with up to 3 decimal places.`);
  }
}

/** Cumulative as a percentage of planned, rounded down to two decimals, capped at 100. */
export function progressPercent(cumulative: string | null, planned: string | null): string | null {
  if (!cumulative || !planned) return null;
  const done = parseStockQuantity(cumulative, true);
  const scope = parseStockQuantity(planned, true);
  if (scope === 0n) return null;
  const hundredths = (done * 10000n) / scope;
  const capped = hundredths > 10000n ? 10000n : hundredths;
  const whole = capped / 100n;
  const fraction = (capped % 100n).toString().padStart(2, "0");
  return `${whole}.${fraction}`;
}

/** Suggested cumulative: the last reported cumulative for this work plus today's quantity. */
export function suggestCumulative(previous: string | null, today: string | null): string | null {
  const before = quantity(previous, "Previous cumulative") ?? 0n;
  const now = quantity(today, "Today's quantity");
  if (now === null) return previous ? formatStockQuantity(before) : null;
  return formatStockQuantity(before + now);
}

/**
 * Checks one progress line and returns it normalised.
 * Throws with a message naming the line when a rule is broken.
 */
export function normalizeDprItem(input: DprItemInput, line: number): DprItem {
  const prefix = `Line ${line}`;
  const description = input.description.trim();
  if (description.length < 2) throw new Error(`${prefix}: describe the work done.`);
  if (description.length > 240)
    throw new Error(`${prefix}: keep the description under 240 characters.`);

  const planned = quantity(input.plannedQuantity, `${prefix} planned quantity`);
  const today = quantity(input.completedQuantityToday, `${prefix} today's quantity`);
  const cumulative = quantity(input.cumulativeQuantity, `${prefix} cumulative quantity`);
  const unitCode = clean(input.unitCode);

  if ((planned !== null || today !== null || cumulative !== null) && !unitCode)
    throw new Error(`${prefix}: choose a unit for the quantities.`);
  if (today !== null && cumulative !== null && cumulative < today)
    throw new Error(`${prefix}: cumulative cannot be less than today's quantity.`);
  if (planned !== null && cumulative !== null && cumulative > planned)
    throw new Error(
      `${prefix}: cumulative is more than the planned quantity. Record a variation before reporting extra work.`,
    );

  const plannedText = planned === null ? null : formatStockQuantity(planned);
  const cumulativeText = cumulative === null ? null : formatStockQuantity(cumulative);
  return {
    taskId: clean(input.taskId),
    workItemCode: clean(input.workItemCode),
    description,
    locationLabel: clean(input.locationLabel),
    unitCode,
    plannedQuantity: plannedText,
    completedQuantityToday: today === null ? null : formatStockQuantity(today),
    cumulativeQuantity: cumulativeText,
    estimatedPercent: progressPercent(cumulativeText, plannedText),
    remarks: clean(input.remarks),
  };
}

export function normalizeDprItems(items: readonly DprItemInput[]): DprItem[] {
  if (items.length > MAX_DPR_ITEMS)
    throw new Error(`A report can hold up to ${MAX_DPR_ITEMS} work lines.`);
  return items.map((item, index) => normalizeDprItem(item, index + 1));
}

export type DprItemsResult =
  | { items: DprItem[]; error: null }
  | { items: null; error: { code: "DPR_ITEM_INVALID"; message: string } };

/** Policy form of `normalizeDprItems`: returns the error instead of throwing, for the server. */
export function validateDprItems(items: readonly DprItemInput[]): DprItemsResult {
  try {
    return { items: normalizeDprItems(items), error: null };
  } catch (error) {
    return {
      items: null,
      error: {
        code: "DPR_ITEM_INVALID",
        message: error instanceof Error ? error.message : "A work line is not valid.",
      },
    };
  }
}

/** A stored quantity for display and editing ("1000.000" → "1000"); empty when missing or unreadable. */
export function displayQuantity(value: unknown): string {
  if (value === null || value === undefined || value === "") return "";
  try {
    return formatStockQuantity(String(value));
  } catch {
    return String(value);
  }
}
