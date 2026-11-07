/**
 * A spoken or typed material need → material request draft fields. The model's reply is
 * untrusted: names, quantities and units are re-checked here. Nothing here saves a request.
 */
import { cleanQuantity } from "./ai-report-extraction";

export const requestJsonSchema = {
  type: "object",
  properties: {
    items: {
      type: "array",
      items: {
        type: "object",
        properties: {
          name: { type: "string", description: "material in English, e.g. OPC 53 cement" },
          quantity: { type: "string", description: "number only" },
          unit: { type: "string", description: "bag, kg, ton, cum, nos, rmt, sqft, ltr, etc." },
        },
        required: ["name"],
      },
    },
    purpose: { type: "string", description: "where or why it is needed, in English" },
  },
  required: ["items"],
} as const;

export function requestPrompt(catalogue: readonly string[]): string {
  const known = catalogue.length
    ? `Materials already in the company catalogue: ${catalogue.map((name) => `"${name}"`).join(", ")}. Use the exact catalogue name when one clearly matches.`
    : "";
  return (
    "A construction site person said what material they need (possibly in Odia, Hindi or " +
    "English, with words like saria for steel bars, bori for bags, gitti for aggregate). " +
    "List each material with its quantity and unit in clear English. Do not invent quantities. " +
    known
  );
}

export type RequestDraftFields = {
  itemName: string;
  quantity: string;
  unitCode: string;
  purpose: string;
  /** Further materials the person named; the form takes one material per request. */
  otherItems: string[];
};

const UNIT_ALIASES: Record<string, string> = {
  bags: "bag",
  bori: "bag",
  boris: "bag",
  kgs: "kg",
  kilogram: "kg",
  kilograms: "kg",
  tons: "ton",
  tonne: "ton",
  tonnes: "ton",
  mt: "ton",
  pieces: "nos",
  piece: "nos",
  pcs: "nos",
  no: "nos",
  number: "nos",
  numbers: "nos",
  litre: "ltr",
  litres: "ltr",
  liters: "ltr",
  "cu m": "cum",
  "cubic metre": "cum",
  "cubic meter": "cum",
  brass: "brass",
};

export function cleanUnit(value: unknown): string {
  const raw = String(value ?? "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 32);
  return UNIT_ALIASES[raw] ?? raw;
}

function cleanName(value: unknown, catalogue: readonly string[]): string {
  const raw = String(value ?? "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 180);
  const match = catalogue.find((name) => name.toLowerCase() === raw.toLowerCase());
  return match ?? raw;
}

export function normalizeRequestFields(
  raw: unknown,
  catalogue: readonly string[] = [],
): RequestDraftFields {
  const data = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const items = (Array.isArray(data.items) ? data.items : [])
    .map((item) => (item && typeof item === "object" ? item : {}) as Record<string, unknown>)
    .map((item) => ({
      name: cleanName(item.name, catalogue),
      quantity: cleanQuantity(item.quantity),
      unit: cleanUnit(item.unit),
    }))
    .filter((item) => item.name.length >= 2);
  const [first, ...rest] = items;
  return {
    itemName: first?.name ?? "",
    quantity: first?.quantity ?? "",
    unitCode: first?.unit ?? "",
    purpose: String(data.purpose ?? "")
      .trim()
      .slice(0, 500),
    otherItems: rest
      .slice(0, 10)
      .map((item) => [item.quantity, item.unit, item.name].filter(Boolean).join(" ")),
  };
}
