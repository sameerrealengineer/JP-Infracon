/**
 * What the in-app assistant may do: open a screen the person is allowed to use, or start a draft
 * the person then checks and saves. It never saves, approves or pays anything by itself.
 */

export type AssistantScreen = {
  key: string;
  route: string;
  title: string;
  /** What it is for, in plain words, so the AI can match a request. */
  about: string;
  /** Any of these permissions (on any site) makes the screen available. Empty: everyone. */
  anyOf: readonly string[];
  /** The screen can open for one site (route gets ?siteId=). */
  siteScoped?: boolean;
};

export const ASSISTANT_SCREENS: readonly AssistantScreen[] = [
  {
    key: "home",
    route: "/(tabs)",
    title: "Home",
    about: "today's brief, what is waiting",
    anyOf: [],
  },
  { key: "sites", route: "/(tabs)/sites", title: "Sites", about: "all sites, progress", anyOf: [] },
  {
    key: "reports",
    route: "/(tabs)/reports",
    title: "Daily reports",
    about: "DPR/DLR list, review",
    anyOf: ["dpr.view", "dlr.view"],
    siteScoped: true,
  },
  {
    key: "new_report",
    route: "/report-editor",
    title: "New daily report",
    about: "write today's DPR or DLR",
    anyOf: ["dpr.create", "dlr.create"],
    siteScoped: true,
  },
  {
    key: "requests",
    route: "/(tabs)/requests",
    title: "Material requests",
    about: "ask for cement, steel, sand; approve requests",
    anyOf: ["material.request.view"],
    siteScoped: true,
  },
  {
    key: "issues",
    route: "/issues",
    title: "Safety & quality",
    about: "report a hazard, defect, blocker, stop work",
    anyOf: ["issue.view"],
    siteScoped: true,
  },
  {
    key: "attendance",
    route: "/attendance",
    title: "Attendance",
    about: "mark labour attendance, overtime, labour cost",
    anyOf: ["attendance.view"],
    siteScoped: true,
  },
  {
    key: "schedule",
    route: "/schedule",
    title: "Schedule",
    about: "tasks, dates, progress, delays",
    anyOf: ["task.view"],
    siteScoped: true,
  },
  {
    key: "workforce",
    route: "/workforce",
    title: "Workforce",
    about: "workers, KYC, wage rates",
    anyOf: ["workforce.view"],
    siteScoped: true,
  },
  {
    key: "inventory",
    route: "/inventory",
    title: "Inventory",
    about: "stock in, stock out, balance",
    anyOf: ["inventory.view"],
    siteScoped: true,
  },
  {
    key: "finance",
    route: "/finance",
    title: "Finance",
    about: "supplier bills, payments, petty cash",
    anyOf: ["finance.invoice.view", "finance.cash.view"],
    siteScoped: true,
  },
  {
    key: "scan_bill",
    route: "/scan-bill",
    title: "Scan a bill",
    about: "photo of a supplier bill to an invoice draft",
    anyOf: ["finance.invoice.create"],
    siteScoped: true,
  },
  {
    key: "documents",
    route: "/documents",
    title: "Project documents",
    about: "contracts, drawings, BOQ, find a document",
    anyOf: ["document.view"],
    siteScoped: true,
  },
  {
    key: "budget",
    route: "/project-budget",
    title: "Project budget",
    about: "budget vs spent",
    anyOf: ["budget.view"],
    siteScoped: true,
  },
  {
    key: "purchase",
    route: "/purchase",
    title: "Purchase orders",
    about: "PO to supplier, quotes, goods receipt (GRN), bill match",
    anyOf: ["purchase.view"],
    siteScoped: true,
  },
  {
    key: "subcontract",
    route: "/subcontract",
    title: "Subcontractors",
    about: "work orders to subcontractors, measurement book (MB), their RA bills, retention",
    anyOf: ["subcontract.view"],
    siteScoped: true,
  },
  {
    key: "payroll",
    route: "/payroll",
    title: "Payroll",
    about: "monthly wage sheet, salaries, PF, ESI, payslips, paying workers",
    anyOf: ["payroll.view"],
    siteScoped: true,
  },
  {
    key: "accounts",
    route: "/accounts",
    title: "Accounts",
    about: "PF, ESI and TDS dues and deposits, GST summary, project profit and loss",
    anyOf: ["accounts.view"],
  },
  {
    key: "crm",
    route: "/crm",
    title: "Clients & leads",
    about: "enquiries, follow-ups, quotations to clients",
    anyOf: ["crm.view"],
  },
  {
    key: "billing",
    route: "/billing",
    title: "Client billing",
    about: "RA bills to the client, receipts, receivables, what the client owes",
    anyOf: ["billing.view"],
  },
  {
    key: "people",
    route: "/people",
    title: "People directory",
    about: "a worker's or subcontractor's history, pay, quality, contact",
    anyOf: ["workforce.view"],
  },
  {
    key: "notifications",
    route: "/notifications",
    title: "Notifications",
    about: "what is waiting for me",
    anyOf: [],
  },
  {
    key: "profile",
    route: "/profile",
    title: "My profile",
    about: "my photo, mobile, address",
    anyOf: [],
  },
  {
    key: "alerts",
    route: "/alert-settings",
    title: "Alert settings",
    about: "WhatsApp, SMS, push alerts",
    anyOf: [],
  },
  {
    key: "modules",
    route: "/modules",
    title: "Modules",
    about: "turn app modules on or off",
    anyOf: ["site.manage", "user.manage"],
  },
] as const;

export const ASSISTANT_ACTIONS = ["none", "open", "draft_report", "draft_issue"] as const;
export type AssistantActionType = (typeof ASSISTANT_ACTIONS)[number];

export type AssistantAction =
  | { type: "none" }
  | { type: "open"; screen: string; route: string; siteId: string | null; label: string }
  | {
      type: "draft_report" | "draft_issue";
      route: string;
      siteId: string;
      text: string;
      reportKind?: "DPR" | "DLR";
      label: string;
    };

/** Screens this person may open, given which permissions they hold on any site. */
export function availableScreens(held: ReadonlySet<string>) {
  return ASSISTANT_SCREENS.filter(
    (screen) => screen.anyOf.length === 0 || screen.anyOf.some((key) => held.has(key)),
  );
}

function withQuery(route: string, params: Record<string, string | null | undefined>) {
  const query = Object.entries(params)
    .filter(([, value]) => value)
    .map(([key, value]) => `${key}=${encodeURIComponent(value!)}`)
    .join("&");
  return query ? `${route}?${query}` : route;
}

/**
 * Turns what the AI proposed into a safe action: only known screens the person may open, only
 * their own sites, and drafts only where they may create that record.
 */
export function resolveAssistantAction(
  proposed: {
    type?: unknown;
    screen?: unknown;
    siteId?: unknown;
    text?: unknown;
    reportKind?: unknown;
  } | null,
  context: {
    held: ReadonlySet<string>;
    sitePermissions: ReadonlyMap<string, ReadonlySet<string>>;
    defaultSiteId: string | null;
  },
): AssistantAction {
  if (!proposed || typeof proposed.type !== "string") return { type: "none" };
  const siteId =
    typeof proposed.siteId === "string" && context.sitePermissions.has(proposed.siteId)
      ? proposed.siteId
      : context.defaultSiteId;
  const can = (key: string) => (siteId ? context.sitePermissions.get(siteId)?.has(key) : false);
  const text = typeof proposed.text === "string" ? proposed.text.trim().slice(0, 2000) : "";
  if (proposed.type === "draft_report" && siteId) {
    const kind = proposed.reportKind === "DLR" ? "DLR" : "DPR";
    if (!can(kind === "DPR" ? "dpr.create" : "dlr.create")) return { type: "none" };
    return {
      type: "draft_report",
      reportKind: kind,
      siteId,
      text,
      route: withQuery("/report-editor", { siteId, kind, aiText: text }),
      label: kind === "DPR" ? "Open the progress report draft" : "Open the labour report draft",
    };
  }
  if (proposed.type === "draft_issue" && siteId) {
    if (!can("issue.create")) return { type: "none" };
    return {
      type: "draft_issue",
      siteId,
      text,
      route: withQuery("/issues", { siteId, aiText: text, new: "1" }),
      label: "Open the issue draft",
    };
  }
  if (proposed.type === "open" && typeof proposed.screen === "string") {
    const screen = availableScreens(context.held).find((row) => row.key === proposed.screen);
    if (!screen) return { type: "none" };
    const scoped = screen.siteScoped && siteId ? siteId : null;
    return {
      type: "open",
      screen: screen.key,
      siteId: scoped,
      route: withQuery(screen.route, { siteId: scoped }),
      label: `Open ${screen.title}`,
    };
  }
  return { type: "none" };
}
