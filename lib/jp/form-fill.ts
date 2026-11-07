/**
 * Universal AI form filling. Each form the AI can fill is described once here: its fields, which
 * ones are needed, and the permission a person must hold to use it. The server turns what the
 * person said or typed into field values with these specs, and `normalizeFormFill` keeps only
 * values that fit each field. Nothing is ever saved by the AI: the form opens filled and the
 * person checks it and presses save.
 */

export type FillFieldType = "text" | "longtext" | "number" | "money" | "date" | "phone" | "choice";

export type FillField = {
  key: string;
  label: string;
  type: FillFieldType;
  /** What belongs here, for the AI (examples help). */
  hint?: string;
  /** Allowed values for a choice field, exactly as the form stores them. */
  options?: readonly string[];
  required?: boolean;
  max?: number;
};

export type FormSpec = {
  id: string;
  title: string;
  /** One sentence for the AI: what this form records. */
  purpose: string;
  /** "site" forms need a site the person can use; "company" forms are company-wide (CRM). */
  scope: "site" | "company";
  /** The permission the person needs to fill this form; the same one the save checks. */
  permission: string;
  fields: readonly FillField[];
};

export type FormFill = {
  values: Record<string, string>;
  /** Labels of needed fields the person has not given yet. */
  missing: string[];
  /** One short follow-up question for what is still missing, or null when nothing is. */
  question: string | null;
};

export const FORM_SPECS = {
  worker: {
    id: "worker",
    title: "Add worker",
    purpose: "Adds a worker, technician or subcontractor contact to the site's workforce.",
    scope: "site",
    permission: "workforce.manage",
    fields: [
      { key: "fullName", label: "Full name", type: "text", required: true, max: 160 },
      {
        key: "personType",
        label: "Record type",
        type: "choice",
        options: ["worker", "technician", "subcontractor_contact"],
        hint: "worker for mistri/labour/helper, technician for electrician/plumber/operator, subcontractor_contact for a contractor's person",
      },
      { key: "phone", label: "Phone", type: "phone" },
      {
        key: "skillCategory",
        label: "Skill category",
        type: "choice",
        options: ["Skilled", "Semi-skilled", "Unskilled", "Not specified"],
        hint: "mistri/mason/electrician = Skilled, helper/labour/coolie = Unskilled",
      },
      {
        key: "tradeType",
        label: "Trade",
        type: "text",
        hint: "e.g. Mason, Bar bender, Carpenter, Electrician, Helper",
        max: 80,
      },
    ],
  },
  client: {
    id: "client",
    title: "Add client",
    purpose: "Adds a client (the party the company builds for) to Clients & leads.",
    scope: "company",
    permission: "crm.manage",
    fields: [
      { key: "name", label: "Client name", type: "text", required: true, max: 200 },
      {
        key: "clientType",
        label: "Client type",
        type: "choice",
        options: ["Government", "Private company", "Individual", "Builder", "Other"],
      },
      { key: "contactPerson", label: "Contact person", type: "text", max: 120 },
      { key: "phone", label: "Phone", type: "phone" },
      {
        key: "gstin",
        label: "GSTIN",
        type: "text",
        hint: "15 characters, only if said",
        max: 15,
      },
      { key: "address", label: "Address", type: "longtext", max: 400 },
    ],
  },
  lead: {
    id: "lead",
    title: "New enquiry",
    purpose: "Records a new enquiry (lead) for possible construction work.",
    scope: "company",
    permission: "crm.manage",
    fields: [
      {
        key: "title",
        label: "What work",
        type: "text",
        required: true,
        hint: "short title, e.g. G+2 house at Aska",
        max: 200,
      },
      { key: "contactName", label: "Contact name", type: "text", max: 120 },
      { key: "phone", label: "Phone", type: "phone" },
      { key: "location", label: "Location", type: "text", max: 200 },
      {
        key: "source",
        label: "Source",
        type: "choice",
        options: [
          "Referral",
          "Tender",
          "Walk-in",
          "Phone",
          "WhatsApp",
          "Website",
          "Existing client",
          "Other",
        ],
      },
      { key: "value", label: "Estimated value (₹)", type: "money" },
      { key: "followUp", label: "Next follow-up", type: "date" },
      { key: "note", label: "Note", type: "longtext", max: 1000 },
    ],
  },
  supplier: {
    id: "supplier",
    title: "Add supplier",
    purpose: "Adds a supplier, transporter, subcontractor firm or service provider.",
    scope: "site",
    permission: "vendor.create",
    fields: [
      { key: "legalName", label: "Legal name", type: "text", required: true, max: 200 },
      {
        key: "vendorType",
        label: "Type",
        type: "choice",
        options: ["Material Supplier", "Transporter", "Subcontractor", "Service Provider", "Other"],
      },
      { key: "tradeName", label: "Trade name", type: "text", max: 200 },
      { key: "contactName", label: "Contact name", type: "text", max: 120 },
      { key: "phone", label: "Phone", type: "phone" },
      { key: "email", label: "Email", type: "text", max: 200 },
      { key: "address", label: "Address", type: "longtext", max: 400 },
      { key: "paymentTermsDays", label: "Payment terms (days)", type: "number" },
    ],
  },
  task: {
    id: "task",
    title: "New task",
    purpose: "Plans a piece of site work with start and end dates.",
    scope: "site",
    permission: "task.manage",
    fields: [
      { key: "title", label: "Task", type: "text", required: true, max: 200 },
      { key: "description", label: "Details", type: "longtext", max: 1000 },
      {
        key: "workCategory",
        label: "Work type",
        type: "text",
        hint: "e.g. Shuttering, Reinforcement, Concrete, Brickwork, Plaster",
        max: 80,
      },
      {
        key: "locationLabel",
        label: "Where",
        type: "text",
        hint: "e.g. First floor slab",
        max: 120,
      },
      { key: "plannedStart", label: "Start date", type: "date", required: true },
      { key: "plannedEnd", label: "End date", type: "date", required: true },
      {
        key: "priority",
        label: "Priority",
        type: "choice",
        options: ["Low", "Normal", "High", "Critical"],
      },
    ],
  },
  advance: {
    id: "advance",
    title: "Worker advance",
    purpose: "Records money given to a worker in advance (or paid back), to recover from wages.",
    scope: "site",
    permission: "payroll.advance",
    fields: [
      { key: "amount", label: "Amount (₹)", type: "money", required: true },
      {
        key: "installment",
        label: "Recover per pay run (₹)",
        type: "money",
        hint: "only for an advance, if said",
      },
      { key: "entryDate", label: "Date", type: "date" },
      {
        key: "mode",
        label: "Paid by",
        type: "choice",
        options: ["Cash", "UPI", "Bank transfer", "Cheque"],
      },
      { key: "reference", label: "Reference", type: "text", hint: "UPI or cheque number", max: 80 },
      { key: "why", label: "Why", type: "text", required: true, max: 300 },
    ],
  },
  materialItem: {
    id: "materialItem",
    title: "Add material",
    purpose: "Adds a material to the company's material catalogue (no stock is changed).",
    scope: "site",
    permission: "inventory.catalog.manage",
    fields: [
      {
        key: "itemName",
        label: "Material name",
        type: "text",
        required: true,
        hint: "e.g. OPC 53 Grade Cement",
        max: 160,
      },
      {
        key: "itemCode",
        label: "Item code",
        type: "text",
        required: true,
        hint: "short capital code, e.g. CEM-OPC53",
        max: 40,
      },
      { key: "category", label: "Category", type: "text", hint: "e.g. Cement, Steel", max: 80 },
      { key: "specification", label: "Specification", type: "text", max: 200 },
      {
        key: "baseUnitCode",
        label: "Unit",
        type: "text",
        required: true,
        hint: "bag, kg, ton, cum, sqm, nos, litre",
        max: 16,
      },
      { key: "reorderThreshold", label: "Reorder level", type: "number" },
    ],
  },
} as const satisfies Record<string, FormSpec>;

export type FormId = keyof typeof FORM_SPECS;
export const FORM_IDS = Object.keys(FORM_SPECS) as FormId[];

/** JSON schema the AI must answer with: one string per field, plus a follow-up question. */
export function fillJsonSchema(spec: FormSpec) {
  // Plain strings only: choices are listed in the prompt and checked by normalizeFormFill
  // (Gemini refuses some enum shapes, such as an empty value).
  const properties: Record<string, { type: "string" }> = {};
  for (const field of spec.fields) properties[field.key] = { type: "string" };
  properties.question = { type: "string" };
  return { type: "object", properties, required: [...spec.fields.map((f) => f.key), "question"] };
}

/** Instructions for the AI for one form. */
export function fillPrompt(spec: FormSpec, today: string) {
  const lines = spec.fields.map((field) => {
    const kind =
      field.type === "choice"
        ? `one of: ${field.options!.join(" | ")}`
        : field.type === "money"
          ? "rupees as digits, e.g. 2500 or 2500.50"
          : field.type === "date"
            ? "YYYY-MM-DD"
            : field.type === "phone"
              ? "10-digit Indian mobile"
              : field.type === "number"
                ? "digits only"
                : "text";
    return `- ${field.key} (${field.label}${field.required ? ", needed" : ""}): ${kind}${field.hint ? `. ${field.hint}` : ""}`;
  });
  return [
    `You fill the "${spec.title}" form of a construction company app. ${spec.purpose}`,
    `Today is ${today} (India). Turn relative dates like "kal", "tomorrow", "next Monday" into dates.`,
    "The person may speak Odia, Hindi, English or a mix. Write names and text in English letters.",
    "Fill only what the person said or clearly meant. Never invent names, numbers, phones or dates; leave a field as an empty string when it was not said.",
    `Fields:\n${lines.join("\n")}`,
    "question: if a needed field is still empty, ask for it in one short friendly sentence in the person's language; otherwise an empty string.",
  ].join("\n");
}

const clean = (value: unknown) =>
  typeof value === "string"
    ? value.replace(/\s+/g, " ").trim()
    : typeof value === "number"
      ? String(value)
      : "";

function normalizeValue(field: FillField, raw: unknown): string {
  const text = clean(raw);
  if (!text) return "";
  switch (field.type) {
    case "choice": {
      const match = field.options?.find((option) => option.toLowerCase() === text.toLowerCase());
      return match ?? "";
    }
    case "money": {
      const digits = text.replace(/[₹,\s]|rs\.?|rupees?/gi, "");
      return /^\d{1,12}(\.\d{1,2})?$/.test(digits) && /[1-9]/.test(digits) ? digits : "";
    }
    case "number": {
      const digits = text.replace(/[,\s]/g, "");
      return /^\d{1,9}(\.\d{1,3})?$/.test(digits) ? digits : "";
    }
    case "date": {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) return "";
      const date = new Date(`${text}T00:00:00Z`);
      return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === text ? text : "";
    }
    case "phone": {
      const digits = text.replace(/\D/g, "").replace(/^(91|0)(?=\d{10}$)/, "");
      return /^[6-9]\d{9}$/.test(digits) ? digits : "";
    }
    default:
      return text.slice(0, field.max ?? (field.type === "longtext" ? 1000 : 200));
  }
}

/** Keep only values that fit each field; list what is still needed. */
export function normalizeFormFill(spec: FormSpec, raw: unknown): FormFill {
  const source = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const values: Record<string, string> = {};
  for (const field of spec.fields) {
    const value = normalizeValue(field, source[field.key]);
    if (value) values[field.key] = value;
  }
  const missing = spec.fields
    .filter((field) => field.required && !values[field.key])
    .map((field) => field.label);
  const question = missing.length ? clean(source.question).slice(0, 300) || null : null;
  return { values, missing, question };
}
