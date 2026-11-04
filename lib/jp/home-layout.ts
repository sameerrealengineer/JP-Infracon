/**
 * What the home screen offers: modules in a few groups, shown only when the person's
 * server-resolved capabilities allow them (a module turned off for the company has every
 * permission false, so it disappears here too). Badges count inbox items per module.
 */

export type HomeTone = "success" | "warning" | "error" | "info" | "accent";

export type HomeModule = {
  key: string;
  title: string;
  icon: string;
  tone: HomeTone;
  route: string;
  /** Shown when any of these permissions is held on any site. */
  anyOf?: readonly string[];
  /** Shown only to people who manage sites or accounts. */
  adminOnly?: "sites" | "accounts";
  /** Inbox item kinds counted on this module's badge. */
  inboxKinds?: readonly string[];
  /** Offered in the top row when the person can use it. */
  quick?: boolean;
};

export type HomeGroup = { key: string; title: string; modules: readonly HomeModule[] };

export const HOME_GROUPS: readonly HomeGroup[] = [
  {
    key: "site",
    title: "Site work",
    modules: [
      {
        key: "reports",
        title: "Daily report",
        icon: "post-add",
        tone: "info",
        route: "/(tabs)/reports",
        anyOf: ["dpr.create", "dlr.create", "dpr.view", "dlr.view"],
        inboxKinds: ["report.review", "report.returned"],
        quick: true,
      },
      {
        key: "attendance",
        title: "Attendance",
        icon: "how-to-reg",
        tone: "success",
        route: "/attendance",
        anyOf: ["attendance.mark", "attendance.approve", "attendance.view"],
        quick: true,
      },
      {
        key: "issues",
        title: "Safety & quality",
        icon: "health-and-safety",
        tone: "error",
        route: "/issues",
        anyOf: ["issue.view", "issue.create"],
        inboxKinds: ["issue.critical", "issue.assigned", "issue.verify"],
        quick: true,
      },
      {
        key: "schedule",
        title: "Schedule",
        icon: "event-note",
        tone: "info",
        route: "/schedule",
        anyOf: ["task.view"],
        inboxKinds: ["task.overdue"],
      },
    ],
  },
  {
    key: "materials",
    title: "Materials & stock",
    modules: [
      {
        key: "requests",
        title: "Material request",
        icon: "local-shipping",
        tone: "accent",
        route: "/(tabs)/requests",
        anyOf: ["material.request", "material.request.view"],
        inboxKinds: ["material.review"],
        quick: true,
      },
      {
        key: "inventory",
        title: "Stock",
        icon: "inventory",
        tone: "success",
        route: "/inventory",
        anyOf: ["inventory.view", "inventory.transact"],
        inboxKinds: ["inventory.review"],
      },
    ],
  },
  {
    key: "money",
    title: "Money",
    modules: [
      {
        key: "finance",
        title: "Finance",
        icon: "receipt-long",
        tone: "accent",
        route: "/finance",
        anyOf: ["finance.invoice.view", "finance.cash.view", "finance.payment.view"],
        inboxKinds: [
          "invoice.review",
          "payment.review",
          "payment.post",
          "cash.review",
          "cash.post",
          "cash.acknowledge",
        ],
      },
      {
        key: "scan",
        title: "Scan a bill",
        icon: "document-scanner",
        tone: "accent",
        route: "/scan-bill",
        anyOf: ["finance.invoice.create"],
      },
      {
        key: "budget",
        title: "Budget",
        icon: "account-balance-wallet",
        tone: "accent",
        route: "/project-budget",
        anyOf: ["budget.view"],
      },
    ],
  },
  {
    key: "people",
    title: "People & records",
    modules: [
      {
        key: "workforce",
        title: "Workforce",
        icon: "groups",
        tone: "info",
        route: "/workforce",
        anyOf: ["workforce.view"],
      },
      {
        key: "people",
        title: "People directory",
        icon: "person-search",
        tone: "accent",
        route: "/people",
        anyOf: ["workforce.view"],
      },
      {
        key: "documents",
        title: "Documents",
        icon: "folder-copy",
        tone: "info",
        route: "/documents",
        anyOf: ["document.view"],
      },
      {
        key: "projects",
        title: "Projects & sites",
        icon: "add-business",
        tone: "success",
        route: "/projects",
        adminOnly: "sites",
      },
      {
        key: "team",
        title: "Team accounts",
        icon: "manage-accounts",
        tone: "info",
        route: "/users",
        adminOnly: "accounts",
      },
    ],
  },
];

export type HomeAccess = {
  can: (...keys: string[]) => boolean;
  canManageSites: boolean;
  canManageAccounts: boolean;
};

export function moduleVisible(module: HomeModule, access: HomeAccess) {
  if (module.adminOnly === "sites") return access.canManageSites;
  if (module.adminOnly === "accounts") return access.canManageAccounts;
  return module.anyOf ? access.can(...module.anyOf) : false;
}

/** Groups with only the modules this person may open; empty groups are dropped. */
export function visibleGroups(access: HomeAccess, groups = HOME_GROUPS) {
  return groups
    .map((group) => ({
      ...group,
      modules: group.modules.filter((module) => moduleVisible(module, access)),
    }))
    .filter((group) => group.modules.length > 0);
}

/** Up to `limit` quick actions: the marked ones first, then anything else visible. */
export function quickActions(access: HomeAccess, limit = 4, groups = HOME_GROUPS) {
  const all = visibleGroups(access, groups).flatMap((group) => group.modules);
  return [...all.filter((module) => module.quick), ...all.filter((module) => !module.quick)].slice(
    0,
    limit,
  );
}

/** Inbox items per module key, for badges. */
export function badgeCounts(kinds: readonly string[], groups = HOME_GROUPS) {
  const counts: Record<string, number> = {};
  for (const module of groups.flatMap((group) => group.modules)) {
    const n = kinds.filter((kind) => module.inboxKinds?.includes(kind)).length;
    if (n > 0) counts[module.key] = n;
  }
  return counts;
}
