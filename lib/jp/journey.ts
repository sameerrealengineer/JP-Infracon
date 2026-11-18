import { MODULE_KEYS, type ModuleKey } from "./modules";

/**
 * Step-by-step mode: a company starts with only the first step open and each next step opens by
 * itself once the previous one is really in use (counted from real records), like levels in a
 * game, so new users are not faced with every module at once. Extras open only when a leader
 * asks. Leaders can open the next step early or switch the mode off (everything allowed by the
 * Modules screen). Sites, people and accounts are core and always open.
 */

export type JourneyCounts = {
  sites: number;
  workers: number;
  attendanceDays: number;
  dprs: number;
  moneyEntries: number;
  materialRequests: number;
  workOrders: number;
};

export type JourneyStep = {
  level: number;
  title: string;
  about: string;
  modules: readonly ModuleKey[];
  /** What opens the NEXT step, measured on real records. */
  goal: { label: string; count: (c: JourneyCounts) => number; target: number } | null;
};

export const JOURNEY: readonly JourneyStep[] = [
  {
    level: 1,
    title: "Site and people",
    about:
      "Add your site, onboard labour, mistri, supervisor and driver, and keep tenders and guarantees.",
    modules: ["workforce", "contracts"],
    goal: { label: "Add 3 workers", count: (c) => (c.sites > 0 ? c.workers : 0), target: 3 },
  },
  {
    level: 2,
    title: "Attendance",
    about: "Mark who came to work each day.",
    modules: ["attendance"],
    goal: { label: "Mark attendance on 3 days", count: (c) => c.attendanceDays, target: 3 },
  },
  {
    level: 3,
    title: "Daily reports and schedule",
    about: "Send the daily progress report and plan the work as tasks.",
    modules: ["reports", "schedule"],
    goal: { label: "Send 3 daily progress reports", count: (c) => c.dprs, target: 3 },
  },
  {
    level: 4,
    title: "Money",
    about: "Suppliers, bills, payments, petty cash, wages and advances.",
    modules: ["finance", "payroll"],
    goal: {
      label: "Record a supplier bill, payment or petty cash entry",
      count: (c) => c.moneyEntries,
      target: 1,
    },
  },
  {
    level: 5,
    title: "Materials",
    about: "Ask for material from site and keep stock in the store.",
    modules: ["materials", "inventory"],
    goal: { label: "Send a material request", count: (c) => c.materialRequests, target: 1 },
  },
  {
    level: 6,
    title: "Subcontractors",
    about: "Work orders, measurement book and RA bills for petty contractors.",
    modules: ["subcontract"],
    goal: { label: "Make a work order", count: (c) => c.workOrders, target: 1 },
  },
  {
    level: 7,
    title: "Documents and client billing",
    about: "Drawings, agreements and RA bills to the department.",
    modules: ["documents", "billing"],
    goal: null,
  },
];

/** Opened only when a leader asks (Modules screen or the assistant). */
export const EXTRA_MODULES: readonly ModuleKey[] = [
  "issues",
  "budget",
  "purchase",
  "accounts",
  "crm",
];

export type JourneyState = { mode: "guided" | "all"; early: ModuleKey[] };

export function parseJourney(stored: string | null | undefined): JourneyState {
  if (!stored) return { mode: "guided", early: [] };
  try {
    const value = JSON.parse(stored) as { mode?: unknown; early?: unknown };
    const early = Array.isArray(value.early)
      ? MODULE_KEYS.filter((key) => (value.early as unknown[]).includes(key))
      : [];
    return { mode: value.mode === "all" ? "all" : "guided", early };
  } catch {
    return { mode: "guided", early: [] };
  }
}

/** The highest step reached: step N+1 opens once step N's goal is met. */
export function journeyLevel(counts: JourneyCounts): number {
  let level = 1;
  for (const step of JOURNEY) {
    if (step.level !== level || !step.goal) break;
    if (step.goal.count(counts) >= step.goal.target) level += 1;
    else break;
  }
  return Math.min(level, JOURNEY.length);
}

/** Modules still closed by the journey at this level (extras always, unless opened early). */
export function lockedByJourney(level: number, state: JourneyState): ModuleKey[] {
  if (state.mode === "all") return [];
  const open = new Set<ModuleKey>(state.early);
  for (const step of JOURNEY)
    if (step.level <= level) for (const key of step.modules) open.add(key);
  return MODULE_KEYS.filter((key) => !open.has(key));
}

/** The progress card: every step with done / current / locked and the current goal. */
export function journeyView(counts: JourneyCounts, state: JourneyState) {
  const level = journeyLevel(counts);
  const current = JOURNEY[level - 1]!;
  return {
    mode: state.mode,
    level,
    total: JOURNEY.length,
    steps: JOURNEY.map((step) => ({
      level: step.level,
      title: step.title,
      about: step.about,
      modules: step.modules,
      state:
        step.level < level
          ? ("done" as const)
          : step.level === level
            ? ("current" as const)
            : step.modules.every((key) => state.early.includes(key))
              ? ("opened early" as const)
              : ("locked" as const),
    })),
    next: current.goal
      ? {
          label: current.goal.label,
          done: Math.min(current.goal.count(counts), current.goal.target),
          target: current.goal.target,
          opens: JOURNEY[level]?.title ?? null,
        }
      : null,
    extras: EXTRA_MODULES.filter((key) => !state.early.includes(key)),
  };
}
