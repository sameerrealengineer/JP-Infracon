/**
 * In-app guide: what each module is for, who uses it, what to do first, what happens next and
 * who approves. Written from the rules the server enforces (maker-checker, approvals), so the
 * guide never promises something the app does not do. Shown only for modules the person can use.
 */

export type HelpTopic = {
  key: string;
  route: string;
  title: string;
  what: string;
  who: string;
  first: string;
  next: string;
  /** Who approves, or null when nothing needs approval. */
  approval: string | null;
  /** Shown when the person holds any of these permissions on any site (empty: everyone). */
  anyOf: readonly string[];
};

export const HELP_TOPICS: readonly HelpTopic[] = [
  {
    key: "sites",
    route: "/(tabs)/sites",
    title: "Sites",
    what: "Every site you are assigned to, with its progress, team, photos and location.",
    who: "Everyone. You see only the sites you are assigned to; owners and directors see all.",
    first:
      "Open a site to see its team, progress and photos. Use Add photo to set a cover picture.",
    next: "From a site you can open its project page, daily reports, requests and schedule.",
    approval: null,
    anyOf: [],
  },
  {
    key: "projects",
    route: "/projects",
    title: "Projects & sites",
    what: "Create projects, add their sites, edit details, change status and assign the site team.",
    who: "Owner, Director/Partner, Contractor/Admin.",
    first: "Create a project, then add its first site, then assign a supervisor to the site.",
    next: "Assigned people see the site on their phone and can start reports and attendance.",
    approval: "Status changes need a reason and are saved in the audit history.",
    anyOf: ["site.manage"],
  },
  {
    key: "reports",
    route: "/(tabs)/reports",
    title: "Daily reports",
    what: "DPR (work done) and DLR (labour) for each site and day, with photos.",
    who: "Supervisors and site engineers write them; project managers review them.",
    first:
      "Tap New report, choose DPR or DLR, fill today's work or labour and add photos. Save as draft or submit.",
    next: "A submitted report goes to the reviewer. If it is returned, correct it and submit again.",
    approval: "Project manager or admin approves or returns it with a reason.",
    anyOf: ["dpr.view", "dlr.view"],
  },
  {
    key: "attendance",
    route: "/attendance",
    title: "Attendance",
    what: "Daily roster: Full Day, Half Day, Absent, Leave or hours, with overtime.",
    who: "Supervisors mark; project managers or admins approve.",
    first: "Pick the site and date, mark each worker and save.",
    next: "Approved attendance is locked and is used for wages and pay runs. Overtime counts only after approval.",
    approval: "A different person (project manager or admin) approves.",
    anyOf: ["attendance.view"],
  },
  {
    key: "requests",
    route: "/(tabs)/requests",
    title: "Material requests",
    what: "Ask for material for a site and follow it until it is approved and delivered.",
    who: "Supervisors and storekeepers raise; project managers approve.",
    first: "Tap New request, pick the material and quantity and the date you need it by.",
    next: "Approved requests are bought or issued from the store; you see the status change here.",
    approval: "Project manager or admin.",
    anyOf: ["material.request.view"],
  },
  {
    key: "issues",
    route: "/issues",
    title: "Safety & quality",
    what: "Hazards, accidents, near misses, quality defects and blockers, with photos and actions.",
    who: "Anyone on the site can report; managers assign and close.",
    first: "Tap Report issue, choose the type and severity, describe it and add a photo.",
    next: "An owner and target date are set, the work is done, then someone verifies and closes it. Critical issues send alerts.",
    approval:
      "High and Critical issues are closed by a different person. Reopening needs a reason.",
    anyOf: ["issue.view"],
  },
  {
    key: "schedule",
    route: "/schedule",
    title: "Schedule",
    what: "Tasks with planned dates and links (a task can start only after another finishes).",
    who: "Project managers plan; supervisors update status.",
    first: "Add tasks with start and end dates, then link the ones that depend on each other.",
    next: "When a date changes, the app shows which later tasks move before you confirm. Old plans are kept.",
    approval: "A reschedule needs a reason and your confirmation.",
    anyOf: ["task.view"],
  },
  {
    key: "workforce",
    route: "/workforce",
    title: "Workforce",
    what: "Workers and technicians: contact, skill, trade, KYC status and wage rates.",
    who: "Project managers and admins.",
    first:
      "Add a worker with name, phone and trade, assign them to a site, then propose a daily or hourly rate.",
    next: "Once the rate is approved, attendance turns into estimated earnings for pay runs.",
    approval: "Rates and KYC are reviewed by a different authorised person.",
    anyOf: ["workforce.view"],
  },
  {
    key: "crews",
    route: "/crews",
    title: "Crews",
    what: "Trade-wise teams on a site (shuttering, masonry…): members, daily work and labour cost.",
    who: "Supervisors and project managers make crews and record their work; payroll staff see the cost.",
    first: "Make a crew, choose its trade and add the site's workers to it.",
    next: "Each day record which task the crew worked on and how many people. Labour cost per crew comes from approved attendance.",
    approval: "Closing a crew needs a reason. A worker can be in only one open crew on a site.",
    anyOf: ["workforce.view"],
  },
  {
    key: "tracking",
    route: "/tracking",
    title: "Team tracking",
    what: "One month per person: days present, hours, overtime, site presence, reports and pay.",
    who: "Owners and directors (all sites), project managers (their sites).",
    first: "Choose the month and site. Tap a worker to open their full history.",
    next: "Marks waiting for approval are shown apart. Presence shows only for phones with location on.",
    approval: null,
    anyOf: ["workforce.review"],
  },
  {
    key: "payroll",
    route: "/payroll",
    title: "Payroll",
    what: "Monthly pay runs from approved attendance and salary, with PF, ESI and payslips.",
    who: "Accounts prepare; project managers or directors approve.",
    first:
      "Make sure the month's attendance is approved, then create the pay run for the site and month.",
    next: "Check each line (TDS, advance, other deductions), submit, get it approved, then mark it paid.",
    approval: "A different person approves. Paid is a record in the app, not a bank transfer.",
    anyOf: ["payroll.view"],
  },
  {
    key: "khaata",
    route: "/khaata",
    title: "Worker khaata",
    what: "Advances and repayments for each worker, recovered through pay runs.",
    who: "Supervisors and accounts request; approvers with payroll rights approve.",
    first: "Record the advance amount and the instalment to recover each month.",
    next: "Each pay run suggests the instalment and lowers what is still owed.",
    approval: "A different person approves each advance.",
    anyOf: ["payroll.advance", "payroll.view"],
  },
  {
    key: "inventory",
    route: "/inventory",
    title: "Inventory",
    what: "Stock at each site from material received, used, returned and wasted.",
    who: "Storekeepers enter movements; managers review them.",
    first: "Record material received (inward) or used (consumption) with quantity and date.",
    next: "Stock changes only after the entry is approved. Stock can never go below zero.",
    approval: "Project manager or admin reviews each entry.",
    anyOf: ["inventory.view"],
  },
  {
    key: "purchase",
    route: "/purchase",
    title: "Purchase orders",
    what: "Purchase orders with supplier quotes, goods receipts (GRN) and bill matching.",
    who: "Project managers and storekeepers.",
    first: "Create a PO, add supplier quotes, pick one and submit for approval.",
    next: "When goods arrive, record a GRN (reject damaged items with a reason). Accepted material goes to inventory.",
    approval: "A different person approves the PO.",
    anyOf: ["purchase.view"],
  },
  {
    key: "subcontract",
    route: "/subcontract",
    title: "Subcontractors",
    what: "Work orders to subcontractors, measurement book and their RA bills.",
    who: "Project managers and site engineers.",
    first:
      "Create a work order with its items and rates, then record measurements as work is done.",
    next: "A different person checks measurements. RA bills are made only from checked measurements and are paid through supplier payments.",
    approval: "Work orders, measurements and RA bills each need a different person.",
    anyOf: ["subcontract.view"],
  },
  {
    key: "finance",
    route: "/finance",
    title: "Finance",
    what: "Supplier bills, supplier payments and site petty cash.",
    who: "Accounts and site managers.",
    first: "Enter a supplier bill (or scan it with Scan a bill), then submit it.",
    next: "Approved bills can be paid in full or in parts. Petty cash funds need the named custodian to accept them.",
    approval:
      "A different person approves bills and payments. Payments here are records, not bank transfers.",
    anyOf: ["finance.invoice.view", "finance.payment.view", "finance.cash.view"],
  },
  {
    key: "budget",
    route: "/project-budget",
    title: "Project budget",
    what: "Budget per cost head for each project, compared with approved spending.",
    who: "Directors, admins and project managers.",
    first: "Propose a budget with the contract value and an amount for each cost head.",
    next: "After approval the page shows spend against budget and warns near the limit.",
    approval: "A different person approves each budget or revision.",
    anyOf: ["budget.view"],
  },
  {
    key: "crm",
    route: "/crm",
    title: "Clients & leads",
    what: "Clients, enquiries with follow-ups, and quotations.",
    who: "Owners, directors, admins and project managers.",
    first: "Add the client, then an enquiry with the next follow-up date.",
    next: "Make a quotation; when the client accepts it the enquiry is marked won and can become a billing contract.",
    approval: null,
    anyOf: ["crm.view"],
  },
  {
    key: "billing",
    route: "/billing",
    title: "Client billing",
    what: "Client contracts, RA bills with GST, retention and TDS, and money received.",
    who: "Accounts and project managers make bills; directors approve.",
    first: "Set up the project's contract and its items (BOQ), then make an RA bill for work done.",
    next: "Approved bills show what the client owes; record each receipt when money comes in.",
    approval: "A different person approves each RA bill.",
    anyOf: ["billing.view"],
  },
  {
    key: "accounts",
    route: "/accounts",
    title: "Accounts",
    what: "PF, ESI, PT and TDS dues, GST by month, receivables, payables and project profit.",
    who: "Accounts, owners and directors.",
    first: "Check dues for the month and record each deposit with its challan number.",
    next: "Overdue dues appear in your inbox. Returns are still filed by your accountant.",
    approval: null,
    anyOf: ["accounts.view"],
  },
  {
    key: "documents",
    route: "/documents",
    title: "Project documents",
    what: "Drawings, contracts and files for each project, with versions and search.",
    who: "Everyone with document access.",
    first: "Upload a file, choose its category and the project or site it belongs to.",
    next: "A new upload of the same document becomes a new version; search finds text inside files.",
    approval: null,
    anyOf: ["document.view"],
  },
  {
    key: "users",
    route: "/users",
    title: "Users & access",
    what: "Accounts for your staff, their roles and sites, invite codes and per-person access.",
    who: "Owners, directors and admins.",
    first: "Create the person's account or send an invite code fixed to their role and site.",
    next: "Switch single features on or off for one person in User access if their role is not enough.",
    approval: null,
    anyOf: ["user.manage"],
  },
];

export type StartStep = { title: string; detail: string; route: string; anyOf: readonly string[] };

/** "Start here" paths by the kind of work the person does. */
export const START_PATHS: Readonly<Record<string, readonly StartStep[]>> = {
  leader: [
    {
      title: "Create the project and its sites",
      detail: "Projects & sites → New project, then Add site.",
      route: "/projects",
      anyOf: ["site.manage"],
    },
    {
      title: "Add your staff",
      detail: "Create accounts or invite codes for supervisors, engineers and accounts.",
      route: "/users",
      anyOf: ["user.manage"],
    },
    {
      title: "Assign the site team",
      detail: "Open each site and assign its supervisor and engineer.",
      route: "/projects",
      anyOf: ["site.manage"],
    },
    {
      title: "Add workers and their rates",
      detail: "Workforce → add workers, assign them to sites and approve their rates.",
      route: "/workforce",
      anyOf: ["workforce.view"],
    },
    {
      title: "Set the project budget",
      detail: "Propose the budget per cost head and get it approved.",
      route: "/project-budget",
      anyOf: ["budget.view"],
    },
    {
      title: "Set up client billing",
      detail: "Add the client contract and its BOQ items.",
      route: "/billing",
      anyOf: ["billing.view"],
    },
    {
      title: "Watch the work every day",
      detail: "Your inbox shows what waits for you; Team tracking shows each person.",
      route: "/tracking",
      anyOf: ["workforce.review"],
    },
  ],
  manager: [
    {
      title: "Plan the schedule",
      detail: "Add tasks with dates and link the ones that depend on each other.",
      route: "/schedule",
      anyOf: ["task.view"],
    },
    {
      title: "Review daily reports",
      detail: "Approve or return DPR and DLR with a reason.",
      route: "/(tabs)/reports",
      anyOf: ["dpr.view", "dlr.view"],
    },
    {
      title: "Approve attendance",
      detail: "Approve the day's marks and overtime so wages are counted.",
      route: "/attendance",
      anyOf: ["attendance.view"],
    },
    {
      title: "Approve material requests",
      detail: "Approve, part-approve or reject with a reason.",
      route: "/(tabs)/requests",
      anyOf: ["material.request.view"],
    },
    {
      title: "Check your team",
      detail: "Team tracking shows attendance, presence and reports per person.",
      route: "/tracking",
      anyOf: ["workforce.review"],
    },
  ],
  supervisor: [
    {
      title: "Mark attendance every morning",
      detail: "Attendance → choose the site and today, mark each worker.",
      route: "/attendance",
      anyOf: ["attendance.view"],
    },
    {
      title: "Send the daily report",
      detail: "Write today's work (DPR) and labour (DLR) with photos before you leave.",
      route: "/(tabs)/reports",
      anyOf: ["dpr.view", "dlr.view"],
    },
    {
      title: "Ask for material early",
      detail: "Raise a material request with the date you need it by.",
      route: "/(tabs)/requests",
      anyOf: ["material.request.view"],
    },
    {
      title: "Report any problem",
      detail: "Safety & quality → report with a photo; critical issues alert the managers.",
      route: "/issues",
      anyOf: ["issue.view"],
    },
    {
      title: "Record crew work",
      detail: "Crews → open the crew and save today's task and headcount.",
      route: "/crews",
      anyOf: ["workforce.view"],
    },
    {
      title: "Add site photos",
      detail: "Open your site and use Camera or Photos.",
      route: "/(tabs)/sites",
      anyOf: [],
    },
  ],
  accounts: [
    {
      title: "Enter supplier bills",
      detail: "Finance → new bill, or Scan a bill from a photo.",
      route: "/finance",
      anyOf: ["finance.invoice.view"],
    },
    {
      title: "Record payments",
      detail: "Pay approved bills in full or in parts.",
      route: "/finance",
      anyOf: ["finance.payment.view"],
    },
    {
      title: "Run payroll",
      detail: "After attendance is approved, create the month's pay run.",
      route: "/payroll",
      anyOf: ["payroll.view"],
    },
    {
      title: "Deposit statutory dues",
      detail: "Accounts → record PF, ESI and TDS deposits with challans.",
      route: "/accounts",
      anyOf: ["accounts.view"],
    },
    {
      title: "Record client receipts",
      detail: "Client billing → record money received against approved bills.",
      route: "/billing",
      anyOf: ["billing.view"],
    },
  ],
  store: [
    {
      title: "Record material received",
      detail: "Inventory → inward entry with quantity and date.",
      route: "/inventory",
      anyOf: ["inventory.view"],
    },
    {
      title: "Record material used",
      detail: "Inventory → consumption entry for the site.",
      route: "/inventory",
      anyOf: ["inventory.view"],
    },
    {
      title: "Raise material requests",
      detail: "Ask for material before it runs out.",
      route: "/(tabs)/requests",
      anyOf: ["material.request.view"],
    },
  ],
};

/** Which start path fits a role. */
export function startPathFor(role: string | null) {
  if (role === "owner" || role === "director" || role === "admin" || role === "super_admin")
    return "leader";
  if (role === "project_manager") return "manager";
  if (role === "accounts") return "accounts";
  if (role === "storekeeper") return "store";
  return "supervisor";
}

export const TROUBLESHOOTING: readonly { problem: string; fix: string }[] = [
  {
    problem: "It says “No access”.",
    fix: "Your role does not include that screen or action. Ask your owner or admin to switch it on for you in User access.",
  },
  {
    problem: "It says the server could not be reached.",
    fix: "Check mobile data or Wi-Fi and try again. Drafts stay on the phone and are sent when you are back online.",
  },
  {
    problem: "My report or bill shows Draft or Pending Sync.",
    fix: "It is saved only on your phone. Open it and submit when you are online; it is not approved until a reviewer approves it.",
  },
  {
    problem: "The AI is busy or slow.",
    fix: "The AI service is shared and sometimes busy. Wait a minute and try again, or fill the form by hand.",
  },
  {
    problem: "I cannot add a photo.",
    fix: "Photos can be added only on Active sites and by people with site or daily report rights. Allow camera and photo access for the app in phone settings.",
  },
  {
    problem: "A number looks wrong.",
    fix: "Totals come only from approved records. Check for entries still waiting for approval, then use Report a problem from More.",
  },
];

export const GLOSSARY: readonly { term: string; meaning: string }[] = [
  { term: "DPR", meaning: "Daily Progress Report: the work done on a site in a day." },
  { term: "DLR", meaning: "Daily Labour Report: the people who worked on a site in a day." },
  {
    term: "Maker-checker",
    meaning: "One person makes a record and a different person approves it.",
  },
  { term: "BOQ", meaning: "Bill of Quantities: the items, quantities and rates in a contract." },
  { term: "RA bill", meaning: "Running Account bill: a part bill for work done so far." },
  {
    term: "Retention",
    meaning: "Part of each bill held back until the work is finished and accepted.",
  },
  {
    term: "TDS",
    meaning: "Tax Deducted at Source, held from a payment and deposited with the government.",
  },
  { term: "GST", meaning: "Goods and Services Tax added to bills." },
  { term: "PO", meaning: "Purchase Order: what you agree to buy from a supplier, at what rate." },
  { term: "GRN", meaning: "Goods Receipt Note: what actually arrived against a PO." },
  { term: "Work order (WO)", meaning: "The work and rates agreed with a subcontractor." },
  {
    term: "Measurement book",
    meaning: "Measured quantities of subcontract work, checked before billing.",
  },
  { term: "Pay run", meaning: "One month's wages for a site, made from approved attendance." },
  { term: "Khaata", meaning: "A worker's advance and repayment record." },
  {
    term: "PF / ESI / PT",
    meaning: "Provident Fund, Employees' State Insurance and Professional Tax deductions.",
  },
  { term: "Petty cash", meaning: "A small cash fund at a site, held by a named custodian." },
];

/** Help topics the person may use, from their permission check. */
export function visibleTopics(can: (...keys: string[]) => boolean, topics = HELP_TOPICS) {
  return topics.filter((topic) => topic.anyOf.length === 0 || can(...topic.anyOf));
}

export function topicByKey(key: string) {
  return HELP_TOPICS.find((topic) => topic.key === key) ?? null;
}
