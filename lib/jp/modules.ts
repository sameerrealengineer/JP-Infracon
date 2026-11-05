/**
 * App modules a company can turn on or off. Turning a module off hides it for everyone and the
 * server refuses its actions; the data stays and comes back when the module is turned on again.
 * Sites, people and the audit trail are the core and cannot be turned off.
 */

export const MODULES = [
  {
    key: "reports",
    title: "Daily reports (DPR / DLR)",
    detail: "Daily progress and labour reports with review",
    prefixes: ["dpr.", "dlr."],
  },
  {
    key: "materials",
    title: "Material requests",
    detail: "Indents from site with approval",
    prefixes: ["material."],
  },
  {
    key: "issues",
    title: "Safety & quality",
    detail: "Hazards, defects, blockers, stop-work",
    prefixes: ["issue."],
  },
  {
    key: "attendance",
    title: "Attendance",
    detail: "Daily roll call, overtime, labour cost",
    prefixes: ["attendance."],
  },
  {
    key: "schedule",
    title: "Schedule",
    detail: "Tasks, dependencies, rescheduling, progress",
    prefixes: ["task."],
  },
  {
    key: "workforce",
    title: "Workforce",
    detail: "Workers, KYC, rates",
    prefixes: ["workforce.", "compensation."],
  },
  {
    key: "inventory",
    title: "Inventory",
    detail: "Catalogue, stock in and out",
    prefixes: ["inventory."],
  },
  {
    key: "finance",
    title: "Finance",
    detail: "Supplier bills, payments, petty cash",
    prefixes: ["finance.", "vendor."],
  },
  {
    key: "documents",
    title: "Project documents",
    detail: "Contracts, drawings, bills with smart search",
    prefixes: ["document."],
  },
  {
    key: "budget",
    title: "Project budget",
    detail: "Budget vs spend with approval",
    prefixes: ["budget."],
  },
  {
    key: "purchase",
    title: "Purchase",
    detail: "Purchase orders, quotes, goods receipts, bill matching",
    prefixes: ["purchase."],
  },
  {
    key: "subcontract",
    title: "Subcontractors",
    detail: "Work orders, measurement book, RA bills, retention",
    prefixes: ["subcontract."],
  },
  {
    key: "crm",
    title: "Clients & leads (CRM)",
    detail: "Clients, enquiries, follow-ups, quotations",
    prefixes: ["crm."],
  },
  {
    key: "billing",
    title: "Client billing",
    detail: "Contracts, RA bills with GST, receipts, receivables",
    prefixes: ["billing."],
  },
] as const;

export type ModuleKey = (typeof MODULES)[number]["key"];
export const MODULE_KEYS = MODULES.map((module) => module.key) as ModuleKey[];

/** The module a permission belongs to, or null for core permissions (sites, users, audit). */
export function moduleForPermission(permissionKey: string): ModuleKey | null {
  for (const module of MODULES)
    if (module.prefixes.some((prefix) => permissionKey.startsWith(prefix))) return module.key;
  return null;
}

/** Keeps only known module keys, once each, in the catalogue's order. */
export function cleanModuleList(keys: readonly string[]): ModuleKey[] {
  const wanted = new Set(keys);
  return MODULE_KEYS.filter((key) => wanted.has(key));
}

export function parseDisabledModules(stored: string | null | undefined): ModuleKey[] {
  if (!stored) return [];
  try {
    const parsed: unknown = JSON.parse(stored);
    return Array.isArray(parsed) ? cleanModuleList(parsed.map(String)) : [];
  } catch {
    return [];
  }
}

/** True when the permission's module is turned off. Core permissions are never off. */
export function isPermissionDisabled(permissionKey: string, disabled: readonly ModuleKey[]) {
  const module = moduleForPermission(permissionKey);
  return module !== null && disabled.includes(module);
}

const AUDIT_PREFIXES: Record<ModuleKey, readonly string[]> = {
  reports: ["report."],
  materials: ["material_request."],
  issues: ["issue."],
  attendance: ["attendance."],
  schedule: ["task."],
  workforce: ["workforce."],
  inventory: ["inventory."],
  finance: ["petty_cash.", "supplier_payment.", "supplier_invoice.", "vendor."],
  documents: ["document."],
  budget: ["budget."],
  purchase: ["purchase."],
  subcontract: ["subcontract."],
  crm: ["crm."],
  billing: ["billing."],
};

/** Which module an audit action belongs to, for usage counts. */
export function moduleForAuditAction(action: string): ModuleKey | null {
  for (const key of MODULE_KEYS)
    if (AUDIT_PREFIXES[key].some((prefix) => action.startsWith(prefix))) return key;
  return null;
}
