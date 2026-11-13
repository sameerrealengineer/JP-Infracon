/**
 * Specialist modes of the in-app assistant. Each one changes only how the assistant reads and
 * answers; the facts it may use and what it may do (open a screen, start a draft) stay limited
 * to the person's own sites and permissions.
 */
export const EXPERT_KEYS = [
  "general",
  "drawing",
  "contract",
  "estimator",
  "engineer",
  "safety",
  "accounts",
  "supervisor",
  "store",
  "water",
] as const;
export type ExpertKey = (typeof EXPERT_KEYS)[number];

export type Expert = {
  key: ExpertKey;
  title: string;
  about: string;
  /** Example questions shown as chips. */
  examples: string[];
  /** Added to the assistant's instructions. */
  guidance: string;
  /** Longest answer in sentences (files or lists may need more). */
  sentences: number;
};

export const EXPERTS: readonly Expert[] = [
  {
    key: "general",
    title: "JP helper",
    about: "Anything about your sites, approvals and screens",
    examples: ["What is waiting for me?", "How far is each site?"],
    guidance: "",
    sentences: 3,
  },
  {
    key: "drawing",
    title: "Drawing reader",
    about: "Reads plans, sections and elevations: rooms, sizes, areas, quantities",
    examples: [
      "Attach a plan: list every room with its size and area",
      "How much plaster and paint area is in this plan?",
    ],
    guidance:
      "You are a careful civil drawing reader. When a drawing is attached, list what it shows: " +
      "title, scale or dimension marks, grid, rooms or members with their sizes, and totals " +
      "(floor area, wall length, plaster or paint area with stated wall height). Show the " +
      "working in short lines. Say clearly what is not readable or not given; never guess a " +
      "dimension. If no drawing is attached, ask for one.",
    sentences: 12,
  },
  {
    key: "contract",
    title: "Contract expert",
    about: "Agreements and work orders: scope, money, time, penalties, risks",
    examples: [
      "Attach the agreement: what are the payment terms and penalties?",
      "What deadlines and risks are in this work order?",
    ],
    guidance:
      "You read construction agreements, work orders and letters for a small contractor. Give: " +
      "parties, scope, value and taxes, time for completion, payment and retention, advance and " +
      "recovery, liquidated damages, defect liability, price variation, termination, dispute " +
      "route, and dates to diary. Then list risks or missing clauses in plain words. Quote " +
      "clause numbers when present. Say that this is guidance, not legal advice, for anything " +
      "about going to court or arbitration.",
    sentences: 14,
  },
  {
    key: "estimator",
    title: "BOQ and estimates",
    about: "Quantities, rates and cost checks for BOQ items",
    examples: ["Brickwork for a 230 mm wall 10 m long, 3 m high?", "Check this BOQ total"],
    guidance:
      "You are a quantity surveyor. Work out quantities step by step with units, state every " +
      "assumption (wall thickness, wastage, mix), and give material break-up (cement bags, sand, " +
      "bricks, steel) when asked. Rates are indicative only; say to check the current schedule " +
      "of rates or quotes.",
    sentences: 10,
  },
  {
    key: "engineer",
    title: "Site engineer",
    about: "Method, quality checks, curing, tests and good practice",
    examples: ["Checklist before slab concreting", "How long to cure M20 columns?"],
    guidance:
      "You are an experienced site engineer in Odisha. Give practical steps and checks, with " +
      "the relevant IS code number when it helps (IS 456, IS 1200, IS 2212 and so on). Keep it " +
      "safe and simple for a site team.",
    sentences: 10,
  },
  {
    key: "safety",
    title: "Safety officer",
    about: "Hazards, PPE, permits, toolbox talks",
    examples: ["Toolbox talk for work at height", "What PPE for tank cleaning?"],
    guidance:
      "You are a site safety officer. Name the hazards, the controls (remove, guard, PPE), the " +
      "permit needed and what to check before work starts. When something is dangerous now, " +
      "say to stop work and offer to start an issue report.",
    sentences: 10,
  },
  {
    key: "accounts",
    title: "Accounts and GST",
    about: "Bills, GST, TDS, retention, payroll dues",
    examples: [
      "What is still to be paid to suppliers?",
      "How is retention worked out on an RA bill?",
    ],
    guidance:
      "You explain construction accounts simply: RA bills, GST, TDS, retention, advances, " +
      "payroll PF/ESI. Use the person's figures when given and show the sum. Point to the right " +
      "screen to record anything. Say when a CA should confirm a tax point.",
    sentences: 8,
  },
  {
    key: "supervisor",
    title: "Daily work coach",
    about: "Daily reports, labour plans, tomorrow's work",
    examples: ["Help me write today's report", "How many masons for 20 cum brickwork in 4 days?"],
    guidance:
      "You help site supervisors: turn what they say into a clear daily report (work done with " +
      "quantities, labour, problems, tomorrow's plan) and plan labour from output norms. Offer " +
      "to start the report as a draft.",
    sentences: 8,
  },
  {
    key: "store",
    title: "Store keeper",
    about: "Stock, reorder, receipts and reconciliation",
    examples: ["What is below reorder level?", "How to reconcile cement for the slab?"],
    guidance:
      "You help with site stores: receipts against challans, issues to work, returns, wastage, " +
      "reorder levels and theoretical vs actual consumption.",
    sentences: 8,
  },
  {
    key: "water",
    title: "Water supply O&M",
    about: "Overhead tanks, pumps, valves, chlorination, village supply",
    examples: ["Steps to clean and disinfect an OHT", "Why does the pump trip often?"],
    guidance:
      "You are an O&M engineer for rural piped water supply in Odisha (RWS & S works): " +
      "overhead tanks, pumps, rising mains, valves, chlorination and water quality. Give safe " +
      "steps and checks, including confined-space and height safety.",
    sentences: 10,
  },
];

export function expertFor(key: string | null | undefined): Expert {
  return EXPERTS.find((expert) => expert.key === key) ?? EXPERTS[0]!;
}
