/**
 * A spoken or typed day summary → daily report draft fields. The model's reply is untrusted:
 * every field is re-checked here, task names are matched only to the site's real tasks, and
 * lines the rules reject come back with a warning so the person fixes them before saving.
 * Nothing here saves or submits a report.
 */
import {
  MAX_DPR_ITEMS,
  SITE_STATUS_OPTIONS,
  WEATHER_OPTIONS,
  normalizeDprItem,
  type DprItemInput,
  type SiteDayStatus,
  type Weather,
} from "./dpr-domain";

export const reportJsonSchema = {
  type: "object",
  properties: {
    title: { type: "string", description: "short English title for the day's work, max 10 words" },
    weather: { type: "string", enum: [...WEATHER_OPTIONS] },
    siteStatus: { type: "string", enum: [...SITE_STATUS_OPTIONS] },
    notes: {
      type: "string",
      description:
        "English notes: delays, safety, quality, material or equipment issues, and any labour counts by trade",
    },
    nextDayPlan: { type: "string" },
    workLines: {
      type: "array",
      items: {
        type: "object",
        properties: {
          task: { type: "string", description: "exact title from the task list, or empty" },
          description: { type: "string", description: "the work done, in English" },
          location: { type: "string", description: "floor, block, zone or grid" },
          unit: { type: "string", description: "sqft, sqm, cum, rmt, kg, nos, bag, etc." },
          doneToday: { type: "string", description: "number only" },
          doneSoFar: { type: "string", description: "number only, only if said" },
          planned: { type: "string", description: "number only, only if said" },
        },
        required: ["description"],
      },
    },
  },
  required: ["title"],
} as const;

export function reportPrompt(kind: "DPR" | "DLR", taskTitles: readonly string[]): string {
  const tasks = taskTitles.length
    ? `Tasks planned on this site: ${taskTitles.map((title) => `"${title}"`).join(", ")}. Use an exact title in "task" only when the work clearly matches one.`
    : "There are no planned tasks; leave task empty.";
  const kindText =
    kind === "DPR"
      ? "Fill a Daily Progress Report. Put each piece of work in workLines with its quantity done today and unit."
      : "Fill a Daily Labour Report. Leave workLines empty. Write labour counts by trade (for example: Mason 5, Helper 7) in notes; they are a summary, attendance is recorded separately.";
  return (
    "A construction site supervisor described today's work (possibly in Odia, Hindi or English, " +
    "with words like mistri for mason). Write everything in clear English. " +
    `${kindText} ${tasks} ` +
    "Numbers must be digits only. Do not invent quantities, dates, names or facts that were not said; leave unknown fields empty."
  );
}

export type ReportDraftFields = {
  title: string;
  weatherCode: Weather | null;
  overallStatus: SiteDayStatus | null;
  remarks: string;
  nextDayPlan: string;
  items: DprItemInput[];
  /** One message per line the rules rejected; the person must fix those lines before saving. */
  warnings: string[];
};

const text = (value: unknown, max: number) =>
  String(value ?? "")
    .trim()
    .slice(0, max);

/** "250 sq ft" → "250"; "1,200.5" → "1200.5"; anything else → "". */
export function cleanQuantity(value: unknown): string {
  const raw = String(value ?? "")
    .replace(/,/g, "")
    .trim();
  const match = raw.match(/^\d{1,11}(?:\.\d{1,3})?/);
  return match ? match[0] : "";
}

function pick<T extends string>(list: readonly T[], value: unknown): T | null {
  const wanted = String(value ?? "").toLowerCase();
  return list.find((option) => option.toLowerCase() === wanted) ?? null;
}

export function normalizeReportFields(
  raw: unknown,
  kind: "DPR" | "DLR",
  tasks: readonly { id: string; title: string }[],
): ReportDraftFields {
  const data = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const lines = Array.isArray(data.workLines) ? data.workLines : [];
  const warnings: string[] = [];
  const items: DprItemInput[] = [];
  if (kind === "DPR") {
    for (const entry of lines.slice(0, MAX_DPR_ITEMS)) {
      const line = (entry && typeof entry === "object" ? entry : {}) as Record<string, unknown>;
      const taskName = text(line.task, 180).toLowerCase();
      const task = taskName ? tasks.find((row) => row.title.toLowerCase() === taskName) : undefined;
      const item: DprItemInput = {
        taskId: task?.id ?? null,
        description: text(line.description, 240) || task?.title || "",
        locationLabel: text(line.location, 180),
        unitCode: text(line.unit, 32),
        completedQuantityToday: cleanQuantity(line.doneToday),
        cumulativeQuantity: cleanQuantity(line.doneSoFar),
        plannedQuantity: cleanQuantity(line.planned),
        remarks: "",
      };
      if (!item.description) continue;
      try {
        normalizeDprItem(item, items.length + 1);
      } catch (error) {
        warnings.push(
          error instanceof Error ? error.message : `Line ${items.length + 1}: check it.`,
        );
      }
      items.push(item);
    }
    if (lines.length > MAX_DPR_ITEMS)
      warnings.push(`Only the first ${MAX_DPR_ITEMS} work lines were kept.`);
  }
  return {
    title: text(data.title, 180),
    weatherCode: pick(WEATHER_OPTIONS, data.weather),
    overallStatus: pick(SITE_STATUS_OPTIONS, data.siteStatus),
    remarks: text(data.notes, 5000),
    nextDayPlan: text(data.nextDayPlan, 3000),
    items,
    warnings,
  };
}
