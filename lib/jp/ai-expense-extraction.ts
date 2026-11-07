/**
 * A spoken note or a receipt photo → petty cash expense draft fields. The model's reply is
 * untrusted: the amount, date and payment mode are re-checked here. Nothing here saves or
 * posts an expense; the person checks the form and a different person posts it.
 */

export const EXPENSE_PAYMENT_MODES = [
  "Cash",
  "UPI",
  "Bank Transfer",
  "Cheque",
  "Card",
  "Other",
] as const;

export const expenseJsonSchema = {
  type: "object",
  properties: {
    amount: { type: "string", description: "total paid in rupees, number only, e.g. 1250.50" },
    date: { type: "string", description: "YYYY-MM-DD, only if written or said" },
    payee: { type: "string", description: "shop or person paid" },
    paymentMode: { type: "string", enum: [...EXPENSE_PAYMENT_MODES] },
    category: {
      type: "string",
      description: "short English category, e.g. Fuel, Small tools, Local transport, Food, Repairs",
    },
    purpose: { type: "string", description: "what it was for, in English" },
    receiptNumber: { type: "string", description: "bill or receipt number if visible" },
  },
  required: ["amount"],
} as const;

export const expensePrompt =
  "Read this petty cash expense from an Indian construction site (a receipt photo, or words in " +
  "Odia, Hindi or English). Give the total amount actually paid, the shop or person paid, the " +
  "date if shown, payment mode, a short category and the purpose in clear English. Do not guess " +
  "numbers you cannot read.";

export type ExpenseDraftFields = {
  amountRupees: string;
  date: string;
  payee: string;
  paymentMode: (typeof EXPENSE_PAYMENT_MODES)[number] | null;
  category: string;
  purpose: string;
  receiptReference: string;
};

function text(value: unknown, max: number) {
  return String(value ?? "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max);
}

/** "₹1,250.5" → "1250.50"; nothing when it is not a clear positive amount. */
export function cleanRupees(value: unknown): string {
  const raw = String(value ?? "").replace(/[₹,\s]|rs\.?|inr/gi, "");
  const match = raw.match(/^(\d{1,11})(?:\.(\d{1,2}))?$/);
  if (!match || Number(raw) <= 0) return "";
  return match[2] ? `${match[1]}.${match[2].padEnd(2, "0")}` : match[1];
}

export function cleanDate(value: unknown, today: string): string {
  const raw = String(value ?? "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) return "";
  const parsed = new Date(`${raw}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== raw) return "";
  return raw > today ? "" : raw;
}

export function normalizeExpenseFields(raw: unknown, today: string): ExpenseDraftFields {
  const data = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const mode = EXPENSE_PAYMENT_MODES.find(
    (option) => option.toLowerCase() === String(data.paymentMode ?? "").toLowerCase(),
  );
  return {
    amountRupees: cleanRupees(data.amount),
    date: cleanDate(data.date, today),
    payee: text(data.payee, 180),
    paymentMode: mode ?? null,
    category: text(data.category, 80),
    purpose: text(data.purpose, 500),
    receiptReference: text(data.receiptNumber, 160),
  };
}
