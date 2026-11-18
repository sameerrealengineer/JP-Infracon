/**
 * The "+ Capture" sheet: the everyday things done on site, two taps away. Each action shows
 * only where the person holds its permission on the chosen site, and opens the existing screen
 * for that site (the screen and the server check again).
 */

export type CaptureAction = {
  key: string;
  title: string;
  hint: string;
  icon: string;
  /** Any of these on the site shows the action. */
  anyOf: readonly string[];
  route: (siteId: string) => string;
};

const q = (siteId: string) => `siteId=${encodeURIComponent(siteId)}`;

export const CAPTURE_ACTIONS: readonly CaptureAction[] = [
  {
    key: "diary",
    title: "Site diary",
    hint: "Today's page: reports, people, notes",
    icon: "menu-book",
    anyOf: ["dpr.view", "dpr.create"],
    route: (s) => `/site-diary?${q(s)}`,
  },
  {
    key: "attendance",
    title: "Attendance",
    hint: "Who came today",
    icon: "how-to-reg",
    anyOf: ["attendance.mark"],
    route: (s) => `/attendance?${q(s)}`,
  },
  {
    key: "dpr",
    title: "Daily progress",
    hint: "Work done today (DPR)",
    icon: "assignment",
    anyOf: ["dpr.create"],
    route: (s) => `/report-editor?${q(s)}&kind=DPR`,
  },
  {
    key: "dlr",
    title: "Labour report",
    hint: "Labour summary (DLR)",
    icon: "groups",
    anyOf: ["dlr.create"],
    route: (s) => `/report-editor?${q(s)}&kind=DLR`,
  },
  {
    key: "photo",
    title: "Photo / document",
    hint: "Site photo, drawing, bill",
    icon: "photo-camera",
    anyOf: ["document.upload"],
    route: (s) => `/documents?${q(s)}`,
  },
  {
    key: "expense",
    title: "Petty cash expense",
    hint: "Cash spent on site",
    icon: "payments",
    anyOf: ["finance.cash.movement.create"],
    route: (s) => `/finance?${q(s)}`,
  },
  {
    key: "bill",
    title: "Scan supplier bill",
    hint: "Photo of a bill, AI fills it",
    icon: "document-scanner",
    anyOf: ["finance.invoice.create"],
    route: (s) => `/scan-bill?${q(s)}`,
  },
  {
    key: "material",
    title: "Material request",
    hint: "Ask the store or office",
    icon: "local-shipping",
    anyOf: ["material.request"],
    route: (s) => `/site-requests?${q(s)}`,
  },
  {
    key: "stock",
    title: "Stock in / out",
    hint: "Material received or issued",
    icon: "inventory",
    anyOf: ["inventory.transact"],
    route: (s) => `/inventory?${q(s)}`,
  },
  {
    key: "cubes",
    title: "Cube test",
    hint: "Cubes cast, test results",
    icon: "science",
    anyOf: ["dpr.create"],
    route: (s) => `/quality?${q(s)}`,
  },
  {
    key: "hindrance",
    title: "Hindrance",
    hint: "Work stopped or slowed",
    icon: "block",
    anyOf: ["dpr.create"],
    route: (s) => `/hindrances?${q(s)}`,
  },
  {
    key: "machine",
    title: "Machine logsheet",
    hint: "Hours, fuel, operator",
    icon: "agriculture",
    anyOf: ["plant.log"],
    route: () => "/plant",
  },
  {
    key: "issue",
    title: "Safety / quality issue",
    hint: "Hazard, defect, blocker",
    icon: "report-problem",
    anyOf: ["issue.create"],
    route: (s) => `/issues?${q(s)}&new=1`,
  },
  {
    key: "measure",
    title: "Measurement",
    hint: "Subcontractor work (MB)",
    icon: "straighten",
    anyOf: ["subcontract.measure"],
    route: (s) => `/subcontract?${q(s)}`,
  },
  {
    key: "worker",
    title: "Add a worker",
    hint: "Labour, mistri, driver",
    icon: "person-add",
    anyOf: ["workforce.manage"],
    route: (s) => `/workforce?${q(s)}`,
  },
  {
    key: "leave",
    title: "Leave",
    hint: "Apply or approve leave",
    icon: "event-busy",
    anyOf: ["site.view"],
    route: (s) => `/leave?${q(s)}`,
  },
];

/** Actions this person can use on the site, in the fixed order above. */
export function captureActionsFor(held: ReadonlySet<string>) {
  return CAPTURE_ACTIONS.filter((action) => action.anyOf.some((key) => held.has(key)));
}
