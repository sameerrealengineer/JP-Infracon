/**
 * Turns AI output (bill scans, spoken notes) into safe form drafts. AI text is untrusted: every
 * field is re-validated here and anything doubtful becomes a warning for the person to check.
 * Nothing extracted is ever saved without the person confirming it.
 */
import {
  issueCategories,
  issueSeverities,
  type IssueCategory,
  type IssueSeverity,
} from "./issue-policy";

/** JSON schema sent to the model for a supplier bill. */
export const billJsonSchema = {
  type: "object",
  properties: {
    supplierName: { type: "string", description: "Seller / vendor name as printed" },
    supplierGstin: { type: "string", description: "Seller GSTIN if printed, else empty" },
    invoiceNumber: { type: "string" },
    invoiceDate: { type: "string", description: "YYYY-MM-DD" },
    dueDate: { type: "string", description: "YYYY-MM-DD or empty" },
    lines: {
      type: "array",
      items: {
        type: "object",
        properties: {
          description: { type: "string" },
          quantity: { type: "string", description: "number only, e.g. 50 or 2.5" },
          unit: { type: "string", description: "e.g. bag, kg, MT, nos, cum" },
          amount: { type: "string", description: "line total in rupees before tax, number only" },
        },
        required: ["description", "quantity", "unit", "amount"],
      },
    },
    taxTotal: { type: "string", description: "total GST/tax in rupees, number only, 0 if none" },
    otherCharges: { type: "string", description: "freight/loading etc. in rupees, 0 if none" },
    grandTotal: { type: "string", description: "final payable total in rupees, number only" },
  },
  required: ["supplierName", "invoiceNumber", "invoiceDate", "lines", "taxTotal", "grandTotal"],
} as const;

export const billPrompt =
  "You read Indian supplier bills / tax invoices for a construction company. Extract the fields exactly as printed. " +
  "Amounts are in Indian rupees: write plain numbers without ₹, commas or words. Dates must be YYYY-MM-DD. " +
  "Do not invent values; use an empty string when a field is not visible.";

export type BillDraft = {
  supplierName: string;
  supplierGstin: string;
  invoiceNumber: string;
  invoiceDate: string;
  dueDate: string;
  lines: { description: string; quantity: string; unitCode: string; lineTotalRupees: string }[];
  taxRupees: string;
  chargesRupees: string;
  grandTotalRupees: string;
  warnings: string[];
};

/** "₹1,23,456.789" → "123456.79" (two decimals). Empty or invalid → "". */
export function cleanRupees(value: unknown): string {
  const text = String(value ?? "").replace(/[₹,\s]|rs\.?|inr/gi, "");
  if (!/^\d+(\.\d+)?$/.test(text)) return "";
  const [whole, fraction = ""] = text.split(".");
  const cents = fraction.padEnd(3, "0");
  let paise = BigInt(whole) * 100n + BigInt(cents.slice(0, 2));
  if (Number(cents[2]) >= 5) paise += 1n;
  return `${paise / 100n}.${String(paise % 100n).padStart(2, "0")}`;
}

function cleanQuantity(value: unknown): string {
  const text = String(value ?? "").replace(/[,\s]/g, "");
  if (!/^\d{1,11}(\.\d+)?$/.test(text)) return "";
  const [whole, fraction = ""] = text.split(".");
  const trimmed = fraction.slice(0, 3).replace(/0+$/, "");
  return Number(text) > 0 ? (trimmed ? `${whole}.${trimmed}` : whole) : "";
}

function cleanUnit(value: unknown): string {
  const text = String(value ?? "")
    .trim()
    .replace(/\s+/g, "-")
    .replace(/[^A-Za-z0-9/_-]/g, "")
    .replace(/^[^A-Za-z0-9]+/, "")
    .slice(0, 32);
  return text || "NOS";
}

function cleanDate(value: unknown): string {
  const text = String(value ?? "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) return "";
  const date = new Date(`${text}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === text ? text : "";
}

function cleanInvoiceNumber(value: unknown): string {
  return String(value ?? "")
    .trim()
    .replace(/\s+/g, "")
    .replace(/[^A-Za-z0-9./_-]/g, "")
    .replace(/^[^A-Za-z0-9]+/, "")
    .slice(0, 80);
}

const toPaise = (rupees: string) => (rupees ? BigInt(rupees.replace(".", "")) : 0n);

export function normalizeBill(raw: unknown): BillDraft {
  const data = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const warnings: string[] = [];
  const lines = (Array.isArray(data.lines) ? data.lines : [])
    .slice(0, 50)
    .map((line) => {
      const row = (line ?? {}) as Record<string, unknown>;
      return {
        description: String(row.description ?? "")
          .trim()
          .slice(0, 240),
        quantity: cleanQuantity(row.quantity),
        unitCode: cleanUnit(row.unit),
        lineTotalRupees: cleanRupees(row.amount),
      };
    })
    .filter((line) => line.description);
  lines.forEach((line, index) => {
    if (!line.quantity) warnings.push(`Line ${index + 1}: quantity unclear — please enter it.`);
    if (!line.lineTotalRupees)
      warnings.push(`Line ${index + 1}: amount unclear — please enter it.`);
  });
  if (!lines.length) warnings.push("No item lines could be read.");
  const draft: BillDraft = {
    supplierName: String(data.supplierName ?? "")
      .trim()
      .slice(0, 180),
    supplierGstin: String(data.supplierGstin ?? "")
      .trim()
      .toUpperCase()
      .replace(/[^0-9A-Z]/g, "")
      .slice(0, 15),
    invoiceNumber: cleanInvoiceNumber(data.invoiceNumber),
    invoiceDate: cleanDate(data.invoiceDate),
    dueDate: cleanDate(data.dueDate),
    lines,
    taxRupees: cleanRupees(data.taxTotal) || "0.00",
    chargesRupees: cleanRupees(data.otherCharges) || "0.00",
    grandTotalRupees: cleanRupees(data.grandTotal),
    warnings,
  };
  if (!draft.invoiceNumber) warnings.push("Invoice number not readable.");
  if (!draft.invoiceDate) warnings.push("Invoice date not readable.");
  if (draft.dueDate && draft.invoiceDate && draft.dueDate < draft.invoiceDate) {
    warnings.push("Due date was before the invoice date and was cleared.");
    draft.dueDate = "";
  }
  const computed =
    lines.reduce((sum, line) => sum + toPaise(line.lineTotalRupees), 0n) +
    toPaise(draft.taxRupees) +
    toPaise(draft.chargesRupees);
  const printed = toPaise(draft.grandTotalRupees);
  if (printed && computed !== printed) {
    const diff = computed > printed ? computed - printed : printed - computed;
    if (diff > 100n)
      warnings.push(
        `Items + tax + charges (₹${formatPaise(computed)}) do not match the printed total (₹${formatPaise(printed)}). Check before saving.`,
      );
  }
  return draft;
}

function formatPaise(value: bigint) {
  return `${value / 100n}.${String(value % 100n).padStart(2, "0")}`;
}

/** Issue form fields from a spoken or typed description. */
export const issueJsonSchema = {
  type: "object",
  properties: {
    category: { type: "string", enum: [...issueCategories] },
    severity: { type: "string", enum: [...issueSeverities] },
    title: { type: "string", description: "short English title, max 12 words" },
    description: { type: "string", description: "what was seen, in English" },
    location: { type: "string" },
    immediateAction: { type: "string" },
  },
  required: ["category", "severity", "title", "description"],
} as const;

export const issuePrompt =
  "A construction site worker described a problem (possibly in Odia, Hindi or English). " +
  "Fill the safety/quality issue form in clear English. Choose the closest category and a realistic severity " +
  "(Critical only for immediate danger to life). Do not add facts that were not said.";

export type IssueDraftFields = {
  category: IssueCategory | null;
  severity: IssueSeverity | null;
  title: string;
  description: string;
  location: string;
  immediateAction: string;
};

export function normalizeIssueFields(raw: unknown): IssueDraftFields {
  const data = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const pick = <T extends string>(list: readonly T[], value: unknown) =>
    (list as readonly string[]).includes(String(value)) ? (String(value) as T) : null;
  const text = (value: unknown, max: number) =>
    String(value ?? "")
      .trim()
      .slice(0, max);
  return {
    category: pick(issueCategories, data.category),
    severity: pick(issueSeverities, data.severity),
    title: text(data.title, 180),
    description: text(data.description, 4000),
    location: text(data.location, 180),
    immediateAction: text(data.immediateAction, 2000),
  };
}

/** Pulls the first JSON object out of model text (handles ```json fences and stray prose). */
export function parseModelJson(text: string): unknown {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fenced ? fenced[1] : text;
  const start = candidate.indexOf("{");
  const end = candidate.lastIndexOf("}");
  if (start === -1 || end <= start) throw new Error("The AI reply did not contain data.");
  return JSON.parse(candidate.slice(start, end + 1));
}

export function billToCsvRows(bill: BillDraft): string[][] {
  return [
    ["Supplier", bill.supplierName],
    ["GSTIN", bill.supplierGstin],
    ["Invoice no.", bill.invoiceNumber],
    ["Invoice date", bill.invoiceDate],
    ["Due date", bill.dueDate],
    [],
    ["Description", "Quantity", "Unit", "Amount (INR)"],
    ...bill.lines.map((line) => [
      line.description,
      line.quantity,
      line.unitCode,
      line.lineTotalRupees,
    ]),
    [],
    ["Tax (INR)", "", "", bill.taxRupees],
    ["Other charges (INR)", "", "", bill.chargesRupees],
    ["Printed total (INR)", "", "", bill.grandTotalRupees],
  ];
}
