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
  /**
   * "site": needs a site the person can use. "company": company-wide (CRM).
   * "organization": project and site set-up, for people who manage projects and sites.
   */
  scope: "site" | "company" | "organization";
  /** The permission the person needs to fill this form; the same one the save checks. */
  permission: string;
  fields: readonly FillField[];
  /** Repeating rows (items of an order or bill), when the form has them. */
  lines?: { label: string; max: number; fields: readonly FillField[] };
};

export type FormFill = {
  values: Record<string, string>;
  /** Filled rows, in the order said; empty when the form has no rows or none were said. */
  lines: Record<string, string>[];
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
  crew: {
    id: "crew",
    title: "New crew",
    purpose: "Makes a trade-wise team of workers on the site.",
    scope: "site",
    permission: "workforce.manage",
    fields: [
      {
        key: "name",
        label: "Crew name",
        type: "text",
        required: true,
        hint: "e.g. Shuttering team 1 or the leader's name",
        max: 80,
      },
      {
        key: "trade",
        label: "Trade",
        type: "choice",
        required: true,
        options: [
          "Shuttering",
          "Bar bending",
          "Masonry",
          "Concrete",
          "Plaster",
          "Plumbing",
          "Electrical",
          "Painting",
          "Tiling",
          "Carpentry",
          "Welding",
          "Excavation",
          "Helpers",
          "Other",
        ],
      },
    ],
  },
  project: {
    id: "project",
    title: "New project",
    purpose: "Creates a project: the work under one contract, which holds one or more sites.",
    scope: "organization",
    permission: "site.manage",
    fields: [
      { key: "name", label: "Project name", type: "text", required: true, max: 160 },
      {
        key: "code",
        label: "Project code",
        type: "text",
        required: true,
        hint: "2-32 capital letters, digits or hyphens made from the name, e.g. PKL-GOVT",
        max: 32,
      },
      {
        key: "client",
        label: "Client / department",
        type: "text",
        hint: "e.g. PWD Odisha, R&B Division Aska",
        max: 160,
      },
      {
        key: "type",
        label: "Project type",
        type: "text",
        hint: "e.g. Govt building, Road",
        max: 80,
      },
      { key: "start", label: "Start date", type: "date" },
      { key: "end", label: "Target end date", type: "date" },
    ],
  },
  site: {
    id: "site",
    title: "New site",
    purpose: "Creates a work site under a project.",
    scope: "organization",
    permission: "site.manage",
    fields: [
      { key: "name", label: "Site name", type: "text", required: true, max: 160 },
      {
        key: "code",
        label: "Site code",
        type: "text",
        required: true,
        hint: "2-32 capital letters, digits or hyphens, e.g. PKL001",
        max: 32,
      },
      { key: "address", label: "Address", type: "longtext", max: 400 },
      { key: "village", label: "Village / town", type: "text", max: 120 },
      { key: "district", label: "District", type: "text", max: 120 },
      { key: "state", label: "State", type: "text", hint: "usually Odisha", max: 80 },
    ],
  },
  purchaseOrder: {
    id: "purchaseOrder",
    title: "Purchase order",
    purpose: "Orders material from a supplier for a site: the items, quantities and rates.",
    scope: "site",
    permission: "purchase.create",
    fields: [
      {
        key: "supplier",
        label: "Supplier",
        type: "text",
        hint: "the supplier's name as said, e.g. Maa Tarini Traders",
        max: 160,
      },
      { key: "expectedDate", label: "Delivery by", type: "date" },
      {
        key: "terms",
        label: "Terms",
        type: "longtext",
        hint: "only if the person said terms",
        max: 1000,
      },
    ],
    lines: {
      label: "Items",
      max: 30,
      fields: [
        {
          key: "description",
          label: "Item",
          type: "text",
          required: true,
          hint: "e.g. OPC cement 53 grade",
          max: 200,
        },
        { key: "quantity", label: "Qty", type: "number", required: true },
        {
          key: "unitCode",
          label: "Unit",
          type: "text",
          hint: "bag, ton, kg, cum, sqft, nos, ltr, m",
          max: 12,
        },
        {
          key: "rateRupees",
          label: "Rate ₹",
          type: "money",
          hint: "price of one unit, before GST",
        },
        { key: "gstPercent", label: "GST %", type: "number", hint: "only if said, e.g. 18 or 28" },
      ],
    },
  },
  workOrder: {
    id: "workOrder",
    title: "Work order",
    purpose:
      "Gives a piece of work to a subcontractor at a site: the scope, items, quantities and rates.",
    scope: "site",
    permission: "subcontract.create",
    fields: [
      {
        key: "subcontractor",
        label: "Subcontractor",
        type: "text",
        hint: "the subcontractor's name as said",
        max: 160,
      },
      {
        key: "title",
        label: "Work title",
        type: "text",
        required: true,
        hint: "e.g. Plastering ground floor",
        max: 200,
      },
      { key: "scope", label: "Scope of work", type: "longtext", max: 4000 },
      { key: "startDate", label: "Start date", type: "date" },
      { key: "endDate", label: "Finish by", type: "date" },
      { key: "advanceRupees", label: "Advance ₹", type: "money" },
    ],
    lines: {
      label: "Work items",
      max: 50,
      fields: [
        {
          key: "description",
          label: "Work item",
          type: "text",
          required: true,
          hint: "e.g. 12mm cement plaster 1:6",
          max: 300,
        },
        { key: "quantity", label: "Qty", type: "number", required: true },
        { key: "unit", label: "Unit", type: "text", hint: "sqm, sqft, cum, rmt, nos", max: 12 },
        { key: "rateRupees", label: "Rate ₹", type: "money", hint: "price of one unit" },
      ],
    },
  },
  quotation: {
    id: "quotation",
    title: "Quotation",
    purpose: "Prices work for a client: a title, the items, quantities and rates.",
    scope: "company",
    permission: "crm.manage",
    fields: [
      {
        key: "title",
        label: "Quotation title",
        type: "text",
        required: true,
        hint: "e.g. Boundary wall for school",
        max: 200,
      },
      { key: "validUntil", label: "Valid until", type: "date" },
      { key: "gstPercent", label: "GST %", type: "number", hint: "only if said" },
      {
        key: "terms",
        label: "Terms",
        type: "longtext",
        hint: "only if the person said terms",
        max: 2000,
      },
    ],
    lines: {
      label: "Items",
      max: 50,
      fields: [
        { key: "description", label: "Item", type: "text", required: true, max: 300 },
        { key: "quantity", label: "Qty", type: "number", required: true },
        { key: "unit", label: "Unit", type: "text", hint: "sqm, cum, rmt, nos", max: 12 },
        { key: "rateRupees", label: "Rate ₹", type: "money" },
      ],
    },
  },
  raBill: {
    id: "raBill",
    title: "RA bill",
    purpose: "A running bill to the client: the quantity of each contract item done in this bill.",
    scope: "company",
    permission: "billing.create",
    fields: [
      { key: "periodFrom", label: "Work from", type: "date" },
      { key: "periodTo", label: "Work to", type: "date" },
      { key: "otherDeductionRupees", label: "Other deduction ₹", type: "money" },
      { key: "otherDeductionNote", label: "Deduction note", type: "text", max: 300 },
    ],
    lines: {
      label: "Quantities done",
      max: 100,
      fields: [
        {
          key: "item",
          label: "Contract item",
          type: "text",
          required: true,
          hint: "the item code or name as said, e.g. 2.1 or PCC",
          max: 200,
        },
        { key: "quantity", label: "Qty done", type: "number", required: true },
      ],
    },
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
  const schema: Record<string, unknown> = { ...properties };
  const required = [...spec.fields.map((f) => f.key)];
  if (spec.lines) {
    const row: Record<string, { type: "string" }> = {};
    for (const field of spec.lines.fields) row[field.key] = { type: "string" };
    schema.lines = {
      type: "array",
      items: { type: "object", properties: row, required: spec.lines.fields.map((f) => f.key) },
    };
    required.push("lines");
  }
  schema.question = { type: "string" };
  required.push("question");
  return { type: "object", properties: schema, required };
}

/** Instructions for the AI for one form. */
function describeField(field: FillField) {
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
}

export function fillPrompt(spec: FormSpec, today: string) {
  const lines = spec.fields.map(describeField);
  const rows = spec.lines
    ? [
        `lines: a list of ${spec.lines.label}, one entry per item the person named (at most ${spec.lines.max}), in the order said. Each entry has:`,
        ...spec.lines.fields.map((field) => `  ${describeField(field)}`),
        'Split "50 bag cement aur 2 ton saria" into two entries. An empty list when no item was said.',
      ]
    : [];
  return [
    `You fill the "${spec.title}" form of a construction company app. ${spec.purpose}`,
    `Today is ${today} (India). Turn relative dates like "kal", "tomorrow", "next Monday" into dates.`,
    "The person may speak Odia, Hindi, English or a mix. Write names and text in English letters.",
    "Fill only what the person said or clearly meant. Never invent names, numbers, phones or dates; leave a field as an empty string when it was not said.",
    `Fields:\n${lines.join("\n")}`,
    ...rows,
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
  const lines: Record<string, string>[] = [];
  if (spec.lines && Array.isArray(source.lines)) {
    for (const entry of source.lines.slice(0, spec.lines.max)) {
      const row = (entry && typeof entry === "object" ? entry : {}) as Record<string, unknown>;
      const filled: Record<string, string> = {};
      for (const field of spec.lines.fields) {
        const value = normalizeValue(field, row[field.key]);
        if (value) filled[field.key] = value;
      }
      // A row without its needed fields (such as what the item is) is not a row.
      if (spec.lines.fields.every((field) => !field.required || filled[field.key])) {
        lines.push(filled);
      }
    }
  }
  if (spec.lines && !lines.length) missing.push(spec.lines.label);
  const question = missing.length ? clean(source.question).slice(0, 300) || null : null;
  return { values, lines, missing, question };
}

const words = (text: string) =>
  text
    .toLowerCase()
    .replace(/[^a-z0-9.\s]/g, " ")
    .split(/\s+/)
    .filter((word) => word.length > 1 || /\d/.test(word));

/**
 * Find the record the person named ("maa tarini" → "Maa Tarini Traders", "2.1" → item code 2.1).
 * Exact code or name first, then the most shared words; null when nothing shares a word.
 */
export function bestNameMatch<T extends { name: string; code?: string | null }>(
  said: string | undefined,
  rows: readonly T[],
): T | null {
  const query = (said ?? "").trim().toLowerCase();
  if (!query) return null;
  const exact = rows.find(
    (row) => row.code?.toLowerCase() === query || row.name.toLowerCase() === query,
  );
  if (exact) return exact;
  const asked = new Set(words(query));
  let best: T | null = null;
  let bestScore = 0;
  for (const row of rows) {
    const have = words(`${row.code ?? ""} ${row.name}`);
    const score = have.filter((word) => asked.has(word)).length / Math.max(asked.size, 1);
    if (score > bestScore) {
      best = row;
      bestScore = score;
    }
  }
  return bestScore >= 0.5 ? best : null;
}
