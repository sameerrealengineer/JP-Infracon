import type { ModuleKey } from "./modules";

/**
 * Which alerts go to whom, and on which channel. A company sets rules per category and role;
 * each person can mute categories for themselves and still has to opt in to WhatsApp and SMS.
 * With no rule saved, every channel is on (the behaviour before rules existed).
 */

export const ALERT_ROLES = [
  "owner",
  "director",
  "admin",
  "project_manager",
  "supervisor",
  "accounts",
  "storekeeper",
  "auditor",
] as const;
export type AlertRole = (typeof ALERT_ROLES)[number];

export const ALERT_CATEGORIES = [
  {
    key: "reports",
    title: "Daily reports",
    detail: "Submitted, approved, returned",
    module: "reports",
    prefixes: ["report."],
  },
  {
    key: "materials",
    title: "Material requests",
    detail: "Raised, approved, rejected",
    module: "materials",
    prefixes: ["material_request."],
  },
  {
    key: "issues",
    title: "Safety & quality",
    detail: "Issues raised and assigned",
    module: "issues",
    prefixes: ["issue."],
  },
  {
    key: "budget",
    title: "Project budget",
    detail: "Proposed, approved, rejected",
    module: "budget",
    prefixes: ["budget."],
  },
  {
    key: "presence",
    title: "Site arrival",
    detail: "Arrived or left a site",
    module: null,
    prefixes: ["presence."],
  },
  {
    key: "workers",
    title: "Worker help",
    detail: "Forgot PIN, problem reported",
    module: null,
    prefixes: ["worker."],
  },
  {
    key: "access",
    title: "Access & authority",
    detail: "Delegation granted",
    module: null,
    prefixes: ["delegation."],
  },
] as const satisfies readonly {
  key: string;
  title: string;
  detail: string;
  module: ModuleKey | null;
  prefixes: readonly string[];
}[];

export type AlertCategory = (typeof ALERT_CATEGORIES)[number]["key"];
export const ALERT_CATEGORY_KEYS = ALERT_CATEGORIES.map((row) => row.key) as AlertCategory[];

/** The category of an alert kind, or null for system alerts (such as a test) that always go. */
export function alertCategoryOf(kind: string): AlertCategory | null {
  return ALERT_CATEGORIES.find((row) => row.prefixes.some((p) => kind.startsWith(p)))?.key ?? null;
}

export function moduleOfCategory(category: AlertCategory): ModuleKey | null {
  return ALERT_CATEGORIES.find((row) => row.key === category)?.module ?? null;
}

export type AlertRule = {
  category: AlertCategory;
  role: AlertRole;
  push: boolean;
  whatsapp: boolean;
  sms: boolean;
  /** "title" sends only the short title on WhatsApp/SMS, no details or photos. */
  detail: "full" | "title";
};

export const DEFAULT_RULE = { push: true, whatsapp: true, sms: true, detail: "full" } as const;

export function ruleFor(rules: readonly AlertRule[], category: AlertCategory, role: AlertRole) {
  return (
    rules.find((row) => row.category === category && row.role === role) ?? {
      category,
      role,
      ...DEFAULT_RULE,
    }
  );
}

export type ChannelDecision = {
  push: boolean;
  whatsapp: boolean;
  sms: boolean;
  detail: "full" | "title";
  /** Why nothing is sent, for the delivery log. */
  skipped: string | null;
};

/**
 * Channels for one person and one alert. Personal opt-ins and mutes can only narrow what the
 * company rule allows; SMS stays for urgent alerts only.
 */
export function decideChannels(input: {
  kind: string;
  role: AlertRole | null;
  rules: readonly AlertRule[];
  mutedCategories: readonly string[];
  disabledModules: readonly ModuleKey[];
  optIn: { push: boolean; whatsapp: boolean; sms: boolean };
  urgent: boolean;
}): ChannelDecision {
  const category = alertCategoryOf(input.kind);
  const none = (skipped: string): ChannelDecision => ({
    push: false,
    whatsapp: false,
    sms: false,
    detail: "title",
    skipped,
  });
  if (!category)
    return {
      push: input.optIn.push,
      whatsapp: input.optIn.whatsapp,
      sms: input.optIn.sms && input.urgent,
      detail: "full",
      skipped: null,
    };
  const module = moduleOfCategory(category);
  if (module && input.disabledModules.includes(module)) return none("module off");
  if (input.mutedCategories.includes(category)) return none("muted by person");
  const rule = input.role ? ruleFor(input.rules, category, input.role) : { ...DEFAULT_RULE };
  const decision = {
    push: rule.push && input.optIn.push,
    whatsapp: rule.whatsapp && input.optIn.whatsapp,
    sms: rule.sms && input.optIn.sms && input.urgent,
    detail: rule.detail,
  };
  const any = decision.push || decision.whatsapp || decision.sms;
  return { ...decision, skipped: any ? null : "company rule or opt-out" };
}

/** Keeps known categories and roles only, one row per pair. */
export function cleanRules(rows: readonly Partial<AlertRule>[]): AlertRule[] {
  const seen = new Set<string>();
  const out: AlertRule[] = [];
  for (const row of rows) {
    if (!ALERT_CATEGORY_KEYS.includes(row.category as AlertCategory)) continue;
    if (!ALERT_ROLES.includes(row.role as AlertRole)) continue;
    const id = `${row.category}:${row.role}`;
    if (seen.has(id)) continue;
    seen.add(id);
    out.push({
      category: row.category as AlertCategory,
      role: row.role as AlertRole,
      push: row.push !== false,
      whatsapp: row.whatsapp !== false,
      sms: row.sms !== false,
      detail: row.detail === "title" ? "title" : "full",
    });
  }
  return out;
}
