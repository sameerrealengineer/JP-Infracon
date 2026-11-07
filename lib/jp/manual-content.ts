/**
 * The user manual, one entry per form. The in-app manual (`app/manual.tsx`, opened from the book
 * icon on each form) and the PDF manual are both made from this file, so they never disagree.
 * Field names match the labels on screen. Examples use the demo company, never real people.
 */

export type ManualField = {
  label: string;
  /** The standard way to write it. */
  standard: string;
  example: string;
  required?: boolean;
};

export type ManualForm = {
  id: string;
  module: string;
  title: string;
  /** How to reach the form, as taps. */
  where: string;
  /** App route that opens the screen holding the form. */
  route: string;
  who: string;
  purpose: string;
  fields: readonly ManualField[];
  scenario: { story: string; steps: readonly string[] };
  dos: readonly string[];
  donts: readonly string[];
  /** What happens after saving: status, who is told, who approves. */
  after: string;
  /** What to say to the AI bar, when the form has one. */
  ai?: string;
};

export type ManualModule = { key: string; title: string; intro: string };

/** Modules in the order a company sets up and uses the app. */
export const MANUAL_MODULES: readonly ManualModule[] = [
  {
    key: "start",
    title: "Getting started",
    intro: "Install, first company setup, sign-in and your own account.",
  },
  { key: "projects", title: "Projects & sites", intro: "Projects, sites, status and site team." },
  { key: "users", title: "Team accounts & access", intro: "Logins, invites, access, delegation." },
  {
    key: "workforce",
    title: "Workforce & crews",
    intro: "Workers, rates, worker app login and crews.",
  },
  { key: "budget", title: "Project budget", intro: "Budget per cost head." },
  { key: "attendance", title: "Attendance", intro: "Daily marking and approval." },
  { key: "reports", title: "Daily reports", intro: "DPR and DLR." },
  { key: "schedule", title: "Schedule", intro: "Tasks, assignment and rescheduling." },
  { key: "requests", title: "Material requests", intro: "Asking for material." },
  { key: "issues", title: "Safety & quality", intro: "Reporting and closing issues." },
  { key: "inventory", title: "Inventory", intro: "Catalogue and stock movements." },
  { key: "purchase", title: "Purchase orders", intro: "Orders and goods receipts." },
  { key: "subcontract", title: "Subcontractors", intro: "Work orders, measurements, RA bills." },
  { key: "finance", title: "Finance", intro: "Suppliers, bills, payments, petty cash." },
  { key: "crm", title: "Clients & leads", intro: "Clients, enquiries, quotations." },
  { key: "billing", title: "Client billing", intro: "Contracts, RA bills, receipts." },
  { key: "payroll", title: "Payroll", intro: "Pay runs, pay details, advances." },
  { key: "accounts", title: "Accounts", intro: "Statutory deposits." },
  { key: "documents", title: "Documents", intro: "Uploading and finding files." },
  { key: "more", title: "Alerts, exports & profile", intro: "Settings for you and the company." },
  { key: "worker", title: "Worker (mistri) app", intro: "Mobile + PIN login for workers." },
];

/** House rules for every form: how to write dates, money, names, codes and reasons. */
export const INPUT_STANDARDS: readonly {
  topic: string;
  rule: string;
  good: string;
  bad: string;
}[] = [
  {
    topic: "Dates",
    rule: "Year-month-day with dashes. Pick from the calendar where offered.",
    good: "2026-11-07",
    bad: "7/11/26, 07-11-2026, 7 Nov",
  },
  {
    topic: "Money (₹)",
    rule: "Digits only, no ₹ sign or commas, at most two decimals. Enter rupees, not lakhs.",
    good: "250000 or 380.50",
    bad: "₹2,50,000, 2.5 lakh, 380/-",
  },
  {
    topic: "Quantities",
    rule: "Digits with up to three decimals; the unit goes in its own field.",
    good: "12.5 with unit cum",
    bad: "12.5cum, twelve, 12½",
  },
  {
    topic: "Units",
    rule: "Short standard units, lower case.",
    good: "bag, kg, MT, cum, sqm, sqft, rmt, nos, ltr",
    bad: "Bags, KGS, cubic meter, pieces",
  },
  {
    topic: "Percent",
    rule: "The number only.",
    good: "18",
    bad: "18%, 0.18",
  },
  {
    topic: "Mobile numbers",
    rule: "10 digits of an Indian mobile, no +91 or 0, no spaces.",
    good: "9437012345",
    bad: "+91 94370 12345, 09437012345",
  },
  {
    topic: "Names of people",
    rule: "Full name as on ID, each word starting with a capital letter.",
    good: "Ramesh Behera",
    bad: "ramesh, RAMESH B, Mistri Ramesh",
  },
  {
    topic: "Names of firms",
    rule: "Legal name as on the GST certificate or bill; trading name in its own field.",
    good: "Kalinga Building Materials Pvt Ltd",
    bad: "kalinga, KBM wala",
  },
  {
    topic: "Codes",
    rule: "Capital letters, digits and hyphens; short and unique; never reused.",
    good: "PATIA-A, KHD-PKG-03",
    bad: "patia a, Site 1, KHD/PKG/03",
  },
  {
    topic: "Titles",
    rule: "What, where: start with the work, then the location.",
    good: "Column casting, Block B ground floor",
    bad: "work, today, urgent!!!",
  },
  {
    topic: "Reasons and notes",
    rule: "One clear sentence that someone else can understand later. Reasons go to the audit trail.",
    good: "Client asked to hold work until revised drawing GF-02 is issued.",
    bad: "ok, as discussed, -",
  },
  {
    topic: "References",
    rule: "Copy exactly from the paper: bill no., challan no., UTR, cheque no.",
    good: "KBM/2026/1184",
    bad: "bill, see photo",
  },
];

const DATE = "YYYY-MM-DD";

export const MANUAL_FORMS: readonly ManualForm[] = [
  // ---------------------------------------------------------------- Getting started
  {
    id: "first-setup",
    module: "start",
    title: "First-time company setup",
    where: "Shown once, on a new server, before anyone else can sign in.",
    route: "/",
    who: "The person installing the app for the company (becomes Super Admin).",
    purpose: "Creates the first Super Admin, then the company, its first project and first site.",
    fields: [
      {
        label: "One-time Super Admin setup key",
        standard: "Exactly as given by the person who installed the server.",
        example: "(given privately)",
        required: true,
      },
      {
        label: "Organisation name",
        standard: "Legal or operating name.",
        example: "JP Infracon",
        required: true,
      },
      {
        label: "Organisation code",
        standard: "Capitals and hyphens, unique.",
        example: "JP-INFRACON",
        required: true,
      },
      {
        label: "Project name / code",
        standard: "First project.",
        example: "Bhubaneswar Housing Phase 1 / BBSR-H1",
        required: true,
      },
      {
        label: "Site name / code",
        standard: "First site.",
        example: "Patia Tower A / PATIA-A",
        required: true,
      },
      { label: "Address (optional)", standard: "Site address.", example: "Patia, Bhubaneswar" },
    ],
    scenario: {
      story: "JP Infracon gets a new server and sets it up on the owner's phone.",
      steps: [
        "Open the app; it shows Create the Super Admin.",
        "Enter the setup key, your name, username and a 12+ character password.",
        "Sign in. Create the workspace with the organisation, first project and first site.",
        "Tap Create workspace. Home opens and you can add your team.",
      ],
    },
    dos: ["Keep the setup key private; it works once.", "Use the real legal name of the company."],
    donts: ["Do not create test companies on the production server."],
    after: "The Super Admin can now create projects, sites and accounts for everyone else.",
  },
  {
    id: "sign-in",
    module: "start",
    title: "Sign in",
    where: "First screen of the app.",
    route: "/",
    who: "Every staff member.",
    purpose: "Opens your own account. Each person signs in with their own username.",
    fields: [
      {
        label: "Language",
        standard: "English, हिन्दी or ଓଡ଼ିଆ at the top.",
        example: "English",
      },
      {
        label: "Server address",
        standard: "Web address from your administrator; tap Change.",
        example: "https://your-company-server",
      },
      {
        label: "Username",
        standard: "Your own username, lower case.",
        example: "supervisor",
        required: true,
      },
      {
        label: "Password",
        standard: "12 or more characters.",
        example: "(your password)",
        required: true,
      },
    ],
    scenario: {
      story: "Demo Supervisor signs in for the first time on a new phone.",
      steps: [
        "Choose the language.",
        "Check the server address under the Sign in button.",
        "Enter the username and password and tap Sign in.",
        "If it was a temporary password, set your new password when asked.",
      ],
    },
    dos: [
      "Sign out from More when you hand the phone to someone else.",
      "Remove old saved logins from the phone's password manager.",
    ],
    donts: ["Never share your password or sign in as someone else."],
    after: "Home opens with your sites and what is waiting for you.",
  },
  {
    id: "invite-signup",
    module: "start",
    title: "Create account with an invite code",
    where: "Sign-in screen → Have an invite code? Create account.",
    route: "/",
    who: "New staff who received an invite code.",
    purpose: "Creates your own account; your role and site come from the invite.",
    fields: [
      {
        label: "Invite code",
        standard: "As shared, letters and digits.",
        example: "ABCDE-FGH23",
        required: true,
      },
      {
        label: "Choose a username",
        standard: "Lower case, letters, digits, . _ -",
        example: "anil.mohanty",
        required: true,
      },
      {
        label: "Password / Confirm password",
        standard: "12+ characters, typed twice.",
        example: "(your password)",
        required: true,
      },
    ],
    scenario: {
      story: "Anil Mohanty, new site engineer, joins with the code the owner sent on WhatsApp.",
      steps: [
        "Tap Have an invite code? Create account.",
        "Type the code, choose anil.mohanty as username and set a password twice.",
        "Tap Create account; Home opens with his site.",
      ],
    },
    dos: ["Use the code soon; it expires."],
    donts: ["Do not forward your code to someone else."],
    after: "The code is used up. The owner sees the new account in Team accounts.",
  },
  {
    id: "profile",
    module: "start",
    title: "My profile",
    where: "Tap your initials (top right) → Edit details.",
    route: "/profile",
    who: "Everyone.",
    purpose: "Your contact details, used by your team and for alerts.",
    fields: [
      { label: "Full name", standard: "As on ID.", example: "Demo Supervisor", required: true },
      { label: "Mobile", standard: "10 digits.", example: "9437011111" },
      { label: "Email", standard: "Your own email.", example: "name@example.com" },
      {
        label: "Designation / Department",
        standard: "Job title and department.",
        example: "Site Engineer / Civil",
      },
      {
        label: "Address, City or village, District, State, PIN code",
        standard: "Home address; PIN 6 digits.",
        example: "Patia, Bhubaneswar, Khordha, Odisha, 751024",
      },
      {
        label: "Emergency contact",
        standard: "Name and 10-digit mobile.",
        example: "Sunita Behera 9437022222",
      },
    ],
    scenario: {
      story: "The supervisor completes the profile in the first week.",
      steps: [
        "Tap your initials, then Change profile photo → Take photo.",
        "Tap Edit details, fill every field and save.",
      ],
    },
    dos: ["Keep the mobile current: WhatsApp alerts go there."],
    donts: ["Do not enter someone else's number."],
    after: "The profile completeness bar fills up; your team sees your details.",
  },

  // ---------------------------------------------------------------- Projects & sites
  {
    id: "project",
    module: "projects",
    title: "New project",
    where: "More → Projects & sites → New project.",
    route: "/projects",
    who: "Owner, Director, Admin.",
    purpose: "A project is the work under one contract; it holds one or more sites.",
    fields: [
      {
        label: "Project code",
        standard: "Capitals/digits/hyphens, unique, cannot change later.",
        example: "BBSR-H1",
        required: true,
      },
      {
        label: "Project name",
        standard: "Name of the contract work.",
        example: "Bhubaneswar Housing Phase 1",
        required: true,
      },
      {
        label: "Client / department",
        standard: "Who gave the work.",
        example: "Bhubaneswar Development Authority",
      },
      { label: "Project type", standard: "Kind of work.", example: "Residential building" },
      { label: "Start date", standard: DATE, example: "2026-04-01" },
      { label: "Target end", standard: DATE, example: "2027-09-30" },
    ],
    scenario: {
      story: "JP Infracon wins the BDA housing contract and creates the project.",
      steps: [
        "Open More → Projects & sites and tap New project.",
        "Enter BBSR-H1, Bhubaneswar Housing Phase 1, client Bhubaneswar Development Authority.",
        "Set start 2026-04-01 and target end 2027-09-30, then tap Create project.",
        "Tap Add site on the new project card (next form).",
      ],
    },
    dos: ["Decide a code pattern once and use it for every project."],
    donts: ["Do not make one project per site; sites belong inside a project."],
    after: "The project appears in Projects & sites; add its sites next.",
    ai: "Pakalapoli govt G+1 building, PWD Aska, 1 December se 31 March tak",
  },
  {
    id: "site",
    module: "projects",
    title: "New site",
    where: "More → Projects & sites → Add site (on the project card).",
    route: "/projects",
    who: "Owner, Director, Admin.",
    purpose: "A place where work happens. Reports, attendance, stock and bills belong to a site.",
    fields: [
      { label: "Site code", standard: "Unique code.", example: "PATIA-A", required: true },
      {
        label: "Site name",
        standard: "Name used by the team.",
        example: "Patia Tower A",
        required: true,
      },
      {
        label: "Address / landmark",
        standard: "Where the team reports.",
        example: "Near KIIT Square, Patia",
      },
      { label: "Village / town", standard: "Town.", example: "Bhubaneswar" },
      { label: "District / State", standard: "District and state.", example: "Khordha / Odisha" },
    ],
    scenario: {
      story: "Tower A of the housing project becomes its first site.",
      steps: [
        "Tap Add site on Bhubaneswar Housing Phase 1.",
        "Enter PATIA-A, Patia Tower A, Near KIIT Square, Bhubaneswar, Khordha, Odisha.",
        "Tap Create site. Then assign the supervisor (Site team form).",
      ],
    },
    dos: ["Add a cover photo from the site page so everyone recognises the site."],
    donts: ["Do not reuse an old site's code for a new site."],
    after: "The site is Active. Assigned people see it on their phones.",
    ai: "Pakalapoli site, code PKL001, Aska, Ganjam district",
  },
  {
    id: "site-status",
    module: "projects",
    title: "Change site status",
    where: "Projects & sites → Status, or site page → Change status.",
    route: "/projects",
    who: "Owner, Director, Admin.",
    purpose: "Moves a site between Active, On Hold, Completed and Inactive.",
    fields: [
      { label: "New status", standard: "One choice.", example: "On Hold", required: true },
      {
        label: "Reason (recorded in the audit trail)",
        standard: "One clear sentence.",
        example: "Work suspended for monsoon until 15 September.",
        required: true,
      },
    ],
    scenario: {
      story: "Khandagiri site stops for the monsoon.",
      steps: [
        "Tap Status on the site.",
        "Choose On Hold, write the reason and tap Mark as On Hold.",
      ],
    },
    dos: ["Move the site back to Active the day work restarts."],
    donts: ["Do not mark Completed before handover; it blocks daily work."],
    after: "Daily reports, requests and photos are blocked until the site is Active again.",
  },
  {
    id: "site-team",
    module: "projects",
    title: "Assign the site team",
    where: "Projects & sites → open the site → Site team → Assign.",
    route: "/projects",
    who: "Owner, Director, Admin.",
    purpose: "Gives a person a role on one site.",
    fields: [
      {
        label: "Person",
        standard: "Pick from your team.",
        example: "Demo Supervisor",
        required: true,
      },
      {
        label: "Site role",
        standard: "One role per person per site.",
        example: "Site Supervisor",
        required: true,
      },
      {
        label: "Reason (for Remove access)",
        standard: "Why access ends.",
        example: "Transferred to Khandagiri site.",
      },
    ],
    scenario: {
      story: "Demo Supervisor is put in charge of Patia Tower A.",
      steps: [
        "Open the site, tap Assign.",
        "Pick Demo Supervisor and Site Supervisor, then Assign.",
      ],
    },
    dos: ["Give every site at least one supervisor and one approver."],
    donts: ["Do not leave people on sites they no longer work on."],
    after: "The person sees the site at once.",
  },
  {
    id: "site-location",
    module: "projects",
    title: "Site location & boundary",
    where: "Site page → Site location & boundary.",
    route: "/sites",
    who: "Owner, Admin, Project manager.",
    purpose: "Sets the site position and radius used for arrival and leaving alerts.",
    fields: [
      {
        label: "Location",
        standard: "Stand at the site gate and tap Reset to my current location.",
        example: "20.35330, 85.82960",
      },
      { label: "Radius", standard: "100, 200, 500 or 1000 m.", example: "200 m" },
    ],
    scenario: {
      story: "The manager sets the Patia boundary on the first visit.",
      steps: [
        "Open Patia Tower A, scroll to Site location & boundary.",
        "Tap Reset to my current location, choose 200 m.",
      ],
    },
    dos: ["Use the smallest radius that covers the whole site."],
    donts: ["Do not set the location from the office."],
    after: "Arrival and leaving alerts work during working hours for phones with location on.",
  },

  // ---------------------------------------------------------------- Users & access
  {
    id: "account",
    module: "users",
    title: "New team account",
    where: "More → Team accounts → New individual account.",
    route: "/users",
    who: "Owner, Director, Admin.",
    purpose: "Creates a login for one staff member with a temporary password.",
    fields: [
      {
        label: "Person's full name",
        standard: "As on ID.",
        example: "Anil Mohanty",
        required: true,
      },
      {
        label: "Unique username",
        standard: "Lower case, letters, digits, . _ -",
        example: "anil.mohanty",
        required: true,
      },
      {
        label: "Business role",
        standard: "One role.",
        example: "Site Supervisor / Engineer",
        required: true,
      },
      { label: "Assigned sites", standard: "Tick each site.", example: "Patia Tower A" },
    ],
    scenario: {
      story: "The owner creates an account for the new engineer.",
      steps: [
        "Open Team accounts, scroll to New individual account.",
        "Enter Anil Mohanty, anil.mohanty, choose Site Supervisor / Engineer and Patia Tower A.",
        "Tap Create account and generate temporary password.",
        "Give the temporary password to Anil in person.",
      ],
    },
    dos: ["One account per person.", "Use Reset password when someone forgets it."],
    donts: ["Do not create shared accounts like site1 or office."],
    after: "Anil signs in and must set his own password.",
  },
  {
    id: "invite",
    module: "users",
    title: "Create invite code",
    where: "More → Invite codes → Create invite.",
    route: "/invites",
    who: "Owner, Director, Admin.",
    purpose: "A one-time code so a person creates their own account.",
    fields: [
      {
        label: "Person's full name",
        standard: "As on ID.",
        example: "Sunita Nayak",
        required: true,
      },
      { label: "Role", standard: "One role.", example: "Accounts", required: true },
      { label: "Site", standard: "Their first site.", example: "Patia Tower A" },
      { label: "Code valid for", standard: "Shortest that works.", example: "3 days" },
    ],
    scenario: {
      story: "The owner invites the new accountant by WhatsApp.",
      steps: ["Tap Create invite, fill the form, Create code.", "Tap Share code and send it."],
    },
    dos: ["Revoke codes that were not used."],
    donts: ["Do not post codes in group chats."],
    after: "When used, the code shows as used and the account appears in Team accounts.",
  },
  {
    id: "user-access",
    module: "users",
    title: "User access (one person)",
    where: "Team accounts → Access next to the person.",
    route: "/users",
    who: "Owner, Director, Admin.",
    purpose: "Switch single feature groups on or off for one person, beyond their role.",
    fields: [
      {
        label: "Where",
        standard: "All sites or one site.",
        example: "Patia Tower A",
        required: true,
      },
      { label: "Each group", standard: "As role, On or Off.", example: "Material requests: On" },
      {
        label: "Reason (kept in the audit)",
        standard: "Why.",
        example: "Storekeeper on leave; supervisor raises requests this week.",
        required: true,
      },
    ],
    scenario: {
      story: "The supervisor must raise material requests while the storekeeper is away.",
      steps: [
        "Open Access for Demo Supervisor.",
        "Choose Patia Tower A, set Material requests On, give the reason.",
      ],
    },
    dos: ["Prefer As role; use On/Off only for exceptions."],
    donts: ["Do not give approval rights to the person who makes the same records."],
    after: "The change applies at once and is in the audit trail.",
  },
  {
    id: "delegation",
    module: "users",
    title: "Delegate authority",
    where: "More → Delegate authority → Delegate.",
    route: "/delegation",
    who: "Approvers going on leave.",
    purpose: "Hands your approvals to a colleague for a fixed time.",
    fields: [
      {
        label: "Person",
        standard: "Who approves for you.",
        example: "Demo Director",
        required: true,
      },
      { label: "Where", standard: "Site.", example: "Patia Tower A", required: true },
      { label: "What", standard: "Approval bundles.", example: "Attendance, Daily reports" },
      { label: "For how long", standard: "Days.", example: "7 days", required: true },
      {
        label: "Reason (recorded)",
        standard: "Why.",
        example: "On leave 10–16 November.",
        required: true,
      },
    ],
    scenario: {
      story: "The project manager goes on leave for a week.",
      steps: ["Tap Delegate, fill the form, confirm.", "Tap Revoke now if you return early."],
    },
    dos: ["Delegate before you leave, not after."],
    donts: ["Do not delegate to the person whose records will be approved."],
    after: "The colleague sees your approvals until the time ends.",
  },
  {
    id: "modules",
    module: "users",
    title: "Company modules",
    where: "More → Modules.",
    route: "/modules",
    who: "Owner.",
    purpose: "Turn whole modules on or off for the company.",
    fields: [
      {
        label: "Tell about your work (optional)",
        standard: "One or two sentences for the AI suggestion.",
        example: "Government building works, 2 sites, 40 labourers, accounts done by CA",
      },
      { label: "Each module", standard: "On or Off.", example: "Payroll: On" },
    ],
    scenario: {
      story: "A small company that does not bill clients from the app hides Client billing.",
      steps: ["Switch Client billing off.", "Tap Save modules."],
    },
    dos: ["Turn modules on again any time; data is kept."],
    donts: ["Do not turn off a module people are using today."],
    after: "The module disappears for everyone; records stay safe.",
  },

  // ---------------------------------------------------------------- Workforce
  {
    id: "worker",
    module: "workforce",
    title: "Add person (workforce profile)",
    where: "More → Workforce → choose site → Add person.",
    route: "/workforce",
    who: "Project manager, Admin.",
    purpose: "Records a worker, technician or subcontractor contact on a site.",
    fields: [
      { label: "Full name", standard: "As on Aadhaar.", example: "Ramesh Behera", required: true },
      {
        label: "Record type",
        standard: "Worker, Technician or Subcontractor contact.",
        example: "Worker",
        required: true,
      },
      { label: "Phone · optional", standard: "10 digits.", example: "9876500001" },
      {
        label: "Skill category",
        standard: "Skilled, Semi-skilled, Unskilled.",
        example: "Skilled",
      },
      { label: "Trade / role · optional", standard: "One trade.", example: "Mason" },
    ],
    scenario: {
      story: "Mason Ramesh Behera joins Patia Tower A.",
      steps: [
        "Open Workforce, choose Patia Tower A, tap Add person.",
        "Enter Ramesh Behera, Worker, 9876500001, Skilled, Mason and save.",
        "Tap Propose rate on his card (next form).",
      ],
    },
    dos: ["Collect only what is needed; no Aadhaar or bank numbers here."],
    donts: ["Do not add the same person twice; search People first."],
    after: "The worker appears on the roster for attendance once a rate is approved.",
    ai: "Ramesh Behera, mistri, mobile 98765 43210",
  },
  {
    id: "rate",
    module: "workforce",
    title: "Propose and approve a wage rate",
    where: "Workforce → the person → Propose rate.",
    route: "/workforce",
    who: "Project manager proposes; a different approver decides.",
    purpose: "The rate that turns attendance into earnings.",
    fields: [
      {
        label: "Engagement / work type",
        standard: "Daily, hourly or monthly.",
        example: "Daily wage",
        required: true,
      },
      {
        label: "Amount · INR per selected basis",
        standard: "Rupees, digits only.",
        example: "850",
        required: true,
      },
      { label: "Effective from", standard: DATE, example: "2026-11-01", required: true },
      { label: "Effective to · optional", standard: DATE, example: "" },
      {
        label: "Decision reason",
        standard: "Approver's reason.",
        example: "Matches Patia mason rate.",
        required: true,
      },
    ],
    scenario: {
      story: "Ramesh is paid ₹850 a day from 1 November.",
      steps: [
        "Tap Propose rate, choose Daily wage, 850, 2026-11-01, save.",
        "The director approves with a reason.",
      ],
    },
    dos: ["Start a new rate from a date; old rates stay in history."],
    donts: ["Do not approve your own proposal."],
    after: "Approved attendance now shows estimated earnings.",
  },
  {
    id: "worker-login",
    module: "workforce",
    title: "Worker app login (mobile + PIN)",
    where: "People → open the worker → Worker app card.",
    route: "/people",
    who: "Leaders with workforce review rights.",
    purpose: "Lets a worker see their own pay, attendance and drawings and call the supervisor.",
    fields: [
      {
        label: "Worker's mobile number",
        standard: "10 digits, the worker's own phone.",
        example: "9876500001",
        required: true,
      },
      {
        label: "New 6-digit PIN",
        standard: "6 digits, no repeats or runs (not 111111 or 123456).",
        example: "482913",
        required: true,
      },
      {
        label: "What the worker can see",
        standard: "Tick each.",
        example: "Money, Attendance, Site drawings, Call supervisor",
      },
    ],
    scenario: {
      story: "Ramesh gets the worker app.",
      steps: [
        "Open People → Ramesh Behera → Worker app.",
        "Enter 9876500001 and PIN 482913, tick Money and Attendance, save.",
        "Tell Ramesh the PIN in person.",
      ],
    },
    dos: ["Use Show worker view on this phone to check what he sees."],
    donts: ["Do not write the PIN on the phone cover or in a group chat."],
    after: "Ramesh signs in with Mistri / worker login. Reset PIN or Turn login off any time.",
  },
  {
    id: "crew",
    module: "workforce",
    title: "New crew and crew daily work",
    where: "More → Crews → choose site → New crew.",
    route: "/crews",
    who: "Supervisor, Project manager.",
    purpose: "A trade-wise team on a site and the task it did each day.",
    fields: [
      {
        label: "Crew name",
        standard: "Trade + number.",
        example: "Shuttering team 1",
        required: true,
      },
      { label: "Trade", standard: "One trade.", example: "Shuttering", required: true },
      {
        label: "Members",
        standard: "Workers of this site.",
        example: "Ramesh Behera, Sunita Nayak",
      },
      { label: "Task (daily)", standard: "Schedule task.", example: "Ground floor column casting" },
      { label: "People who worked (daily)", standard: "Count.", example: "6" },
    ],
    scenario: {
      story: "Patia forms a shuttering crew.",
      steps: [
        "Tap New crew, enter Shuttering team 1, Shuttering, add members, Save crew.",
        "Each evening open it and save the task and headcount.",
      ],
    },
    dos: ["Close a crew with a reason when the work ends."],
    donts: ["A worker cannot be in two open crews on one site."],
    after: "Crew labour cost appears from approved attendance.",
    ai: "Raju ki shuttering team",
  },

  // ---------------------------------------------------------------- Budget
  {
    id: "budget",
    module: "budget",
    title: "Set the project budget",
    where: "More → Project budget → choose project → Set the budget.",
    route: "/project-budget",
    who: "Director, Admin, Project manager; a different person approves.",
    purpose: "Budget per cost head to compare with approved spend.",
    fields: [
      { label: "Contract value (₹, optional)", standard: "Rupees.", example: "59275750" },
      { label: "Materials (₹)", standard: "Rupees.", example: "28000000" },
      { label: "Labour (₹)", standard: "Rupees.", example: "9000000" },
      { label: "Subcontract (₹)", standard: "Rupees.", example: "8000000" },
      { label: "Equipment and transport (₹)", standard: "Rupees.", example: "3000000" },
      { label: "Site expense (₹) / Other (₹)", standard: "Rupees.", example: "1500000 / 500000" },
      { label: "Note", standard: "Basis of the budget.", example: "As per BOQ rev 2." },
    ],
    scenario: {
      story: "The director sets the Phase 1 budget.",
      steps: ["Tap Set the budget, enter each head, submit.", "Another director approves it."],
    },
    dos: ["Revise with a note when the scope changes."],
    donts: ["Do not enter lakhs; enter full rupees."],
    after: "The page shows spend against each head and warns near the limit.",
  },

  // ---------------------------------------------------------------- Attendance
  {
    id: "attendance",
    module: "attendance",
    title: "Mark and approve attendance",
    where: "Home → Attendance → choose site → Today.",
    route: "/attendance",
    who: "Supervisor marks; Project manager approves.",
    purpose: "Daily roster that drives wages and pay runs.",
    fields: [
      { label: "Site", standard: "Your site.", example: "Patia Tower A", required: true },
      {
        label: "Day",
        standard: "Today or Yesterday.",
        example: "Today · 2026-11-07",
        required: true,
      },
      {
        label: "Status per worker",
        standard: "Full, Half, Absent, Leave or Hours.",
        example: "Full",
        required: true,
      },
      { label: "Hours", standard: "Hours worked.", example: "8" },
      { label: "Overtime", standard: "Extra hours.", example: "2" },
    ],
    scenario: {
      story: "Morning roll call at Patia: 3 workers, one does 2 hours overtime.",
      steps: [
        "Open Attendance, choose Patia Tower A and Today.",
        "Tap Full for each worker; set Overtime 2 for Ramesh Behera.",
        "Tap Save attendance (3). Marks show Marked.",
        "The manager opens Yesterday and approves; overtime is approved separately.",
      ],
    },
    dos: ["Mark before 10 am every day."],
    donts: ["Do not mark people who are not on site; you cannot approve your own marks."],
    after: "Approved marks are locked and go to the pay run.",
  },

  // ---------------------------------------------------------------- Reports
  {
    id: "dpr",
    module: "reports",
    title: "Daily progress report (DPR)",
    where: "Reports tab → New report → Progress (DPR).",
    route: "/report-editor",
    who: "Supervisor, Site engineer.",
    purpose: "The work done today, item by item, with photos.",
    fields: [
      { label: "Site", standard: "Your site.", example: "Patia Tower A", required: true },
      {
        label: "Title",
        standard: "Main work + location.",
        example: "Column reinforcement, Block A ground floor",
        required: true,
      },
      { label: "Weather", standard: "One choice.", example: "Clear" },
      {
        label: "Site status today",
        standard: "On track, Delayed, Work stopped.",
        example: "On track",
      },
      {
        label: "Work line: Location",
        standard: "Floor, block, zone.",
        example: "Block A, GF, grid A-D",
      },
      { label: "Work line: Unit / Done today", standard: "Unit + quantity.", example: "MT / 2.4" },
      { label: "Notes", standard: "Delays, safety, material.", example: "Waiting for 12 mm bars." },
      {
        label: "Plan for tomorrow",
        standard: "Next work.",
        example: "Shuttering for columns C1–C8.",
      },
    ],
    scenario: {
      story: "End of day at Patia: 2.4 MT of column steel tied.",
      steps: [
        "Tap New report, choose Progress (DPR) and Patia Tower A.",
        "Title: Column reinforcement, Block A ground floor; Weather Clear; On track.",
        "Add work line: task Column reinforcement, Block A GF, MT, done today 2.4.",
        "Add 2 photos, notes and plan, then Submit for review.",
      ],
    },
    dos: ["One report per site per day.", "Photos of the actual work, not of people."],
    donts: ["Do not copy yesterday's quantities."],
    after: "The project manager approves or returns it with a reason.",
    ai: "Block A ground floor column reinforcement 2.4 ton, 8 bar bender, kal shuttering",
  },
  {
    id: "dlr",
    module: "reports",
    title: "Daily labour report (DLR)",
    where: "Reports tab → New report → Labour (DLR).",
    route: "/report-editor",
    who: "Supervisor.",
    purpose: "Who worked today by trade; the summary comes from attendance.",
    fields: [
      { label: "Site", standard: "Your site.", example: "Patia Tower A", required: true },
      {
        label: "Title",
        standard: "Labour + date.",
        example: "Labour on site today",
        required: true,
      },
      {
        label: "Notes",
        standard: "Short summary.",
        example: "18 masons and helpers, 2 bar benders.",
      },
    ],
    scenario: {
      story: "The supervisor sends the labour report after attendance.",
      steps: [
        "Mark attendance first.",
        "New report → Labour (DLR), check the summary, add notes, submit.",
      ],
    },
    dos: ["Save attendance before the DLR."],
    donts: ["Do not type labour counts that differ from attendance."],
    after: "Reviewed like a DPR.",
  },
  {
    id: "report-review",
    module: "reports",
    title: "Review a daily report",
    where: "Reports → Needs action → open the report.",
    route: "/reports",
    who: "Project manager, Admin.",
    purpose: "Approve, or return with a reason.",
    fields: [
      {
        label: "Reason (to return)",
        standard: "What to correct.",
        example: "Add photo of column C4 and correct quantity to 2.1 MT.",
        required: true,
      },
    ],
    scenario: {
      story: "The manager returns a DPR with a wrong quantity.",
      steps: ["Open the report, tap Return, write the reason.", "After correction, approve it."],
    },
    dos: ["Review daily."],
    donts: ["Do not approve reports without photos of key work."],
    after: "Approved reports count for progress and site status.",
  },

  // ---------------------------------------------------------------- Schedule
  {
    id: "task",
    module: "schedule",
    title: "New task",
    where: "More → Schedule → choose site → New task.",
    route: "/schedule",
    who: "Project manager.",
    purpose: "A planned piece of work with dates and dependencies.",
    fields: [
      {
        label: "Task title",
        standard: "Work + location.",
        example: "Ground floor slab casting, Block A",
        required: true,
      },
      { label: "Work category (optional)", standard: "Trade/stage.", example: "Concrete" },
      { label: "Location / zone (optional)", standard: "Where.", example: "Block A, GF" },
      { label: "Planned start", standard: DATE, example: "2026-11-10", required: true },
      { label: "Planned end", standard: DATE, example: "2026-11-14", required: true },
      { label: "Predecessor", standard: "Task that must finish first.", example: "Column casting" },
    ],
    scenario: {
      story: "Slab casting follows column casting.",
      steps: [
        "Tap New task, fill title, dates 2026-11-10 to 2026-11-14.",
        "Choose predecessor Column casting and save.",
      ],
    },
    dos: ["Link dependent tasks so delays show automatically."],
    donts: ["Do not create one huge task for a whole month."],
    after: "The task shows on the timeline; supervisors update its status.",
    ai: "first floor slab shuttering, kal se 5 din, high priority",
  },
  {
    id: "task-assign",
    module: "schedule",
    title: "Assign a task / update status",
    where: "Schedule → task → Assign or Update status.",
    route: "/schedule",
    who: "Project manager assigns; Supervisor updates.",
    purpose: "Who is responsible and how far the task is.",
    fields: [
      { label: "Responsible person", standard: "One person.", example: "Demo Supervisor" },
      { label: "Crew", standard: "Crew doing it.", example: "Shuttering team 1" },
      {
        label: "Status",
        standard:
          "Planned, Ready, In Progress, On Hold, Blocked, Awaiting Inspection, Completed, Cancelled.",
        example: "In Progress",
      },
    ],
    scenario: {
      story: "The supervisor starts the slab task.",
      steps: ["Assign to Demo Supervisor and Shuttering team 1.", "Update status to In Progress."],
    },
    dos: ["Mark Blocked with a reason when work cannot go on."],
    donts: ["Do not mark Completed before the work is checked; use Awaiting Inspection."],
    after: "Progress and the Home brief update.",
  },
  {
    id: "reschedule",
    module: "schedule",
    title: "Reschedule a task",
    where: "Schedule → task → Reschedule.",
    route: "/schedule",
    who: "Project manager.",
    purpose: "Moves dates with a reason and keeps the old plan.",
    fields: [
      { label: "New start", standard: DATE, example: "2026-11-12", required: true },
      {
        label: "Move",
        standard: "This task only, or shift all dependent tasks.",
        example: "Shift all dependent tasks",
        required: true,
      },
      {
        label: "Reason (required)",
        standard: "Choose + note.",
        example: "Material delay: steel arrived late.",
        required: true,
      },
    ],
    scenario: {
      story: "Steel is late; slab moves 2 days.",
      steps: [
        "Tap Reschedule, new start 2026-11-12, shift dependents.",
        "Check the preview of moved tasks and confirm.",
      ],
    },
    dos: ["Read the preview before confirming."],
    donts: ["Do not reschedule to hide delays; history keeps every plan."],
    after: "Dependent tasks move; History shows old and new dates.",
  },

  // ---------------------------------------------------------------- Requests
  {
    id: "material-request",
    module: "requests",
    title: "Material request",
    where: "Requests tab → New request.",
    route: "/requests",
    who: "Supervisor, Storekeeper; Project manager decides.",
    purpose: "Asks for material for a site.",
    fields: [
      {
        label: "Material",
        standard: "Item + grade.",
        example: "OPC 53 grade cement",
        required: true,
      },
      { label: "Quantity", standard: "Positive number.", example: "120", required: true },
      { label: "Unit", standard: "Standard unit.", example: "bag", required: true },
      { label: "Site", standard: "Where needed.", example: "Patia Tower A", required: true },
      {
        label: "Purpose / note (optional)",
        standard: "For what work.",
        example: "Ground floor column casting",
      },
    ],
    scenario: {
      story: "Patia needs 120 bags of cement for columns.",
      steps: [
        "Tap New request, enter the material, 120, bag.",
        "Choose Patia Tower A, write the purpose, Submit request.",
      ],
    },
    dos: ["Ask early, with the date you need it by."],
    donts: ["Do not raise a second request for the same need; follow the first."],
    after: "The manager approves, part-approves or rejects with a reason.",
    ai: "50 bori cement aur 2 ton 12mm saria, first floor slab ke liye",
  },

  // ---------------------------------------------------------------- Issues
  {
    id: "issue",
    module: "issues",
    title: "Report an issue",
    where: "Home → Safety & quality → Report issue.",
    route: "/issues",
    who: "Anyone on site.",
    purpose: "Safety, quality, material, access or any problem holding up work.",
    fields: [
      { label: "Site", standard: "Where.", example: "Patia Tower A", required: true },
      { label: "Type", standard: "One type.", example: "Safety Hazard", required: true },
      {
        label: "Severity",
        standard: "Low, Medium, High, Critical.",
        example: "High",
        required: true,
      },
      {
        label: "Short title",
        standard: "What is wrong.",
        example: "Missing edge protection at first floor slab",
        required: true,
      },
      {
        label: "What did you see?",
        standard: "Who or what is affected.",
        example: "Open slab edge on the north side without guard rails.",
        required: true,
      },
      {
        label: "Exact location",
        standard: "Block/floor/chainage.",
        example: "Block 1, north edge",
      },
      {
        label: "Immediate action taken",
        standard: "What was done at once.",
        example: "Area barricaded with tape, workers moved.",
      },
    ],
    scenario: {
      story: "The supervisor sees an open slab edge.",
      steps: [
        "Tap Report issue, choose Safety Hazard and High.",
        "Write the title, what was seen, location and action, add a photo.",
        "Tap Report issue. Managers get an alert.",
      ],
    },
    dos: ["Report at once, with a photo.", "Mark STOP WORK when people are at risk."],
    donts: ["Do not wait for the next meeting to report a hazard."],
    after: "A manager assigns an owner and target date; High/Critical is closed by another person.",
  },
  {
    id: "issue-update",
    module: "issues",
    title: "Assign, update and close an issue",
    where: "Safety & quality → open the issue.",
    route: "/issues",
    who: "Project manager, Admin.",
    purpose: "Moves an issue to closure with actions recorded.",
    fields: [
      {
        label: "Owner / Target date",
        standard: "Person + date.",
        example: "Demo Supervisor / 2026-11-09",
      },
      {
        label: "Corrective action taken",
        standard: "What fixed it.",
        example: "Guard rails fixed on all slab edges.",
      },
      {
        label: "Preventive action (optional)",
        standard: "How to avoid repeat.",
        example: "Daily edge-check in toolbox talk.",
      },
      {
        label: "Add an update",
        standard: "Progress note.",
        example: "Rails ordered, arriving tomorrow.",
      },
    ],
    scenario: {
      story: "The manager assigns and closes the edge-protection issue.",
      steps: [
        "Assign Demo Supervisor, target 2026-11-09.",
        "After the fix, record actions and Mark resolved.",
      ],
    },
    dos: ["Attach a photo of the fix."],
    donts: ["Do not close your own High/Critical issue."],
    after: "Closed issues stay on record; reopening needs a reason.",
  },

  // ---------------------------------------------------------------- Inventory
  {
    id: "material-item",
    module: "inventory",
    title: "Add a material to the catalogue",
    where: "More → Inventory → Add material.",
    route: "/inventory",
    who: "Storekeeper, Project manager.",
    purpose: "Defines an item and its base unit before stock can move.",
    fields: [
      { label: "Item code", standard: "Short unique code.", example: "CEM-OPC53", required: true },
      {
        label: "Material name",
        standard: "Name + grade.",
        example: "OPC 53 grade cement",
        required: true,
      },
      { label: "Base unit", standard: "One unit, never mixed.", example: "bag", required: true },
      { label: "Category (optional)", standard: "Group.", example: "Cement" },
      { label: "Specification / grade (optional)", standard: "Grade.", example: "OPC 53 grade" },
      { label: "Reorder threshold (optional)", standard: "Base-unit quantity.", example: "50" },
    ],
    scenario: {
      story: "The store adds OPC 53 cement.",
      steps: ["Tap Add material, enter the fields, Save catalogue item."],
    },
    dos: ["Pick a base unit the whole company uses."],
    donts: ["Do not create cement (bag) and cement (kg) as two items."],
    after: "The item can be ordered, received and issued.",
    ai: "OPC 53 grade cement, bag mein, 50 bag se kam ho to batana",
  },
  {
    id: "stock-movement",
    module: "inventory",
    title: "Record a stock movement",
    where: "Inventory → Record movement.",
    route: "/inventory",
    who: "Storekeeper; a different person posts it.",
    purpose: "Stock in, out, back or lost.",
    fields: [
      {
        label: "Movement type",
        standard: "Receipt/inward, Issue/consumption, Return to store, Wastage, Damage.",
        example: "Issue / consumption",
        required: true,
      },
      {
        label: "Material",
        standard: "Catalogue item.",
        example: "OPC 53 grade cement",
        required: true,
      },
      { label: "Quantity", standard: "Up to 3 decimals.", example: "40", required: true },
      { label: "Reference", standard: "Challan/slip no.", example: "ISS-0412" },
      { label: "Reason", standard: "Why.", example: "Column casting C1–C8." },
    ],
    scenario: {
      story: "40 bags issued for column casting.",
      steps: [
        "Tap Record movement, choose Issue / consumption, cement, 40.",
        "Add reference and reason, Submit for review.",
      ],
    },
    dos: ["Enter movements the same day."],
    donts: ["Stock never goes below zero: record receipts first."],
    after: "Stock changes only when the entry is posted.",
  },

  // ---------------------------------------------------------------- Purchase
  {
    id: "po",
    module: "purchase",
    title: "Purchase order",
    where: "More → Purchase orders → choose site → New purchase order.",
    route: "/purchase",
    who: "Project manager, Storekeeper; a different person approves.",
    purpose: "What you buy, from whom, at what rate.",
    fields: [
      {
        label: "Supplier",
        standard: "From Suppliers.",
        example: "Kalinga Building Materials Pvt Ltd",
        required: true,
      },
      { label: "Order date", standard: DATE, example: "2026-11-07", required: true },
      { label: "Delivery by", standard: DATE, example: "2026-11-10" },
      {
        label: "Item: Catalogue item",
        standard: "Pick to add stock on receipt.",
        example: "OPC 53 grade cement",
      },
      {
        label: "Item: Qty / Unit",
        standard: "Number + unit.",
        example: "200 / bag",
        required: true,
      },
      { label: "Item: Rate ₹", standard: "Per unit, before GST.", example: "380", required: true },
      { label: "Item: GST %", standard: "Number.", example: "28", required: true },
      {
        label: "Other quotes",
        standard: "Supplier, total with GST, delivery days.",
        example: "Odisha Road Carriers, 99500, 5",
      },
      {
        label: "Terms",
        standard: "Delivery + payment.",
        example: "Delivery at site. Payment 30 days after bill and goods receipt.",
      },
    ],
    scenario: {
      story: "Patia orders 200 bags of cement and 2 MT of 12 mm steel.",
      steps: [
        "Tap New purchase order, choose Kalinga Building Materials Pvt Ltd.",
        "Item 1: OPC 53 grade cement, 200 bag, 380, GST 28.",
        "Add item: TMT bar 12 mm, 2 MT, 62000, GST 18.",
        "Record one other quote, check the total and Save purchase order.",
        "Open the order and Submit for approval.",
      ],
    },
    dos: [
      "Get at least two quotes for big orders.",
      "Use catalogue items so stock updates on receipt.",
    ],
    donts: ["Do not order before approval."],
    after: "Approved orders can receive goods (GRN).",
    ai: "Maa Tarini se 100 bag cement 380 rupaye, 2 ton saria 62000, Friday tak",
  },
  {
    id: "grn",
    module: "purchase",
    title: "Goods receipt (GRN)",
    where: "Purchase orders → open the approved order → receive goods.",
    route: "/purchase",
    who: "Storekeeper.",
    purpose: "What actually arrived, accepted or rejected.",
    fields: [
      { label: "Received on", standard: DATE, example: "2026-11-10", required: true },
      { label: "Challan no.", standard: "From the challan.", example: "KBM/CH/2231" },
      { label: "Vehicle no.", standard: "As on the truck.", example: "OD02AB1234" },
      {
        label: "Accepted / rejected quantity",
        standard: "Per line.",
        example: "195 accepted, 5 rejected",
      },
      { label: "Why rejected", standard: "Reason.", example: "5 bags torn and wet." },
    ],
    scenario: {
      story: "195 good bags arrive, 5 are wet.",
      steps: [
        "Open the PO, record 195 accepted and 5 rejected with the reason.",
        "Save goods receipt.",
      ],
    },
    dos: ["Count before signing the challan."],
    donts: ["Do not accept more than ordered."],
    after: "Accepted catalogue items go into stock; the bill is matched against it.",
  },

  // ---------------------------------------------------------------- Subcontract
  {
    id: "wo",
    module: "subcontract",
    title: "Work order",
    where: "More → Subcontractors → choose site → New work order.",
    route: "/subcontract",
    who: "Project manager; a different person approves.",
    purpose: "Work and rates agreed with a subcontractor.",
    fields: [
      {
        label: "Subcontractor",
        standard: "Supplier of type Subcontractor.",
        example: "Jagannath Masonry Works",
        required: true,
      },
      {
        label: "Work",
        standard: "Work + location.",
        example: "Brickwork and plaster, Block 1",
        required: true,
      },
      {
        label: "Scope and terms",
        standard: "What is included.",
        example: "Labour only; materials by JP Infracon.",
      },
      { label: "Start / Finish by", standard: DATE, example: "2026-11-07 / 2027-01-31" },
      { label: "GST % / Retention % / TDS %", standard: "Numbers.", example: "18 / 5 / 1" },
      { label: "Advance ₹ / Recover % per bill", standard: "Optional.", example: "50000 / 20" },
      {
        label: "Item: description, unit, qty, rate",
        standard: "BOQ line.",
        example: "230 mm brickwork, cum, 120, 1450",
      },
    ],
    scenario: {
      story: "Jagannath Masonry gets Block 1 brickwork.",
      steps: [
        "Tap New work order, choose the firm, write the work and scope.",
        "Add items, keep 18/5/1, save and submit.",
      ],
    },
    dos: ["Write what material is included in Scope."],
    donts: ["Do not start work before the WO is approved."],
    after: "Approved WOs take measurements and RA bills.",
    ai: "Raju ko ground floor plaster, 450 sqm 120 rupaye, 15 din mein",
  },
  {
    id: "measurement",
    module: "subcontract",
    title: "Measurement",
    where: "Work order page → Save measurement.",
    route: "/subcontract",
    who: "Site engineer measures; a different person checks.",
    purpose: "Quantity of work done, before billing.",
    fields: [
      { label: "Item", standard: "WO line.", example: "230 mm brickwork", required: true },
      { label: "Measured on", standard: DATE, example: "2026-11-20", required: true },
      { label: "Location", standard: "Where.", example: "Ground floor, grid A-D", required: true },
      {
        label: "Nos × L × B × D",
        standard: "Metres, up to 3 decimals.",
        example: "1 × 12.5 × 0.23 × 3.0",
      },
    ],
    scenario: {
      story: "The engineer measures one wall.",
      steps: [
        "Choose the item, date, location, enter 1 × 12.5 × 0.23 × 3.0, save.",
        "Another person taps Check.",
      ],
    },
    dos: ["Measure with the subcontractor present."],
    donts: ["Do not measure more than the WO quantity."],
    after: "Only checked measurements can be billed.",
  },
  {
    id: "sub-bill",
    module: "subcontract",
    title: "Subcontractor RA bill",
    where: "Work order page → Make and submit bill.",
    route: "/subcontract",
    who: "Project manager; a different person approves.",
    purpose: "A bill from checked measurements with GST, retention, TDS and recovery.",
    fields: [
      { label: "Bill date", standard: DATE, example: "2026-11-30", required: true },
      { label: "Measured up to", standard: DATE, example: "2026-11-30" },
      {
        label: "Other deduction ₹ / For what",
        standard: "Rupees + reason.",
        example: "2500 / Material issued: cement 5 bags",
      },
    ],
    scenario: {
      story: "November bill for Jagannath Masonry.",
      steps: [
        "Tap Make and submit bill, set dates and deductions.",
        "Approver checks and approves.",
      ],
    },
    dos: ["Recover material issued through Other deduction."],
    donts: ["Do not bill unchecked measurements."],
    after: "Approved bills are paid through Supplier payments.",
  },

  // ---------------------------------------------------------------- Finance
  {
    id: "supplier",
    module: "finance",
    title: "Supplier",
    where: "More → Finance → Suppliers → Add supplier.",
    route: "/finance",
    who: "Accounts, Project manager.",
    purpose: "Every firm you buy from or pay.",
    fields: [
      {
        label: "Legal name",
        standard: "As on GST certificate.",
        example: "Kalinga Building Materials Pvt Ltd",
        required: true,
      },
      { label: "Trade name", standard: "Shop name.", example: "Kalinga Materials" },
      { label: "Type", standard: "One type.", example: "Material Supplier", required: true },
      {
        label: "Contact person / Phone / Email",
        standard: "Contact.",
        example: "Bikash Mohanty / 9100000001",
      },
      { label: "Address", standard: "Full address.", example: "Rasulgarh, Bhubaneswar" },
      { label: "Payment terms (days)", standard: "Credit days.", example: "30" },
    ],
    scenario: {
      story: "Accounts adds the cement dealer.",
      steps: ["Tap Add supplier, fill legal name, type, contact and 30 days.", "Save."],
    },
    dos: ["Check the supplier list before adding to avoid duplicates."],
    donts: ["Do not store bank details here."],
    after: "The supplier can be used in POs, bills and payments.",
    ai: "Maa Tarini Traders, cement supplier, Bhubaneswar, 30 din credit",
  },
  {
    id: "invoice",
    module: "finance",
    title: "Supplier invoice",
    where: "Finance → Invoices → New invoice (or Scan a bill).",
    route: "/finance",
    who: "Accounts; a different person approves.",
    purpose: "The supplier's bill, line by line.",
    fields: [
      {
        label: "Active supplier",
        standard: "From Suppliers.",
        example: "Kalinga Building Materials Pvt Ltd",
        required: true,
      },
      {
        label: "Invoice number",
        standard: "Exactly as on the bill.",
        example: "KBM/2026/1184",
        required: true,
      },
      { label: "Invoice date", standard: DATE, example: "2026-11-10", required: true },
      { label: "Due date", standard: DATE, example: "2026-12-10" },
      {
        label: "Item description / Quantity / Unit / Line total (₹)",
        standard: "Each bill line.",
        example: "OPC 53 cement / 195 / bag / 74100",
        required: true,
      },
      { label: "Tax total (₹)", standard: "GST on the bill.", example: "20748" },
      { label: "Other charges (₹)", standard: "Freight etc.", example: "1500" },
      { label: "Purchase reference", standard: "PO number.", example: "PO-PATIA-A-002" },
    ],
    scenario: {
      story: "The cement bill arrives after the GRN.",
      steps: [
        "Tap New invoice, choose the supplier, copy number and dates.",
        "Add the line, GST and freight; check the total equals the paper bill; submit.",
      ],
    },
    dos: ["Totals must match the paper bill exactly."],
    donts: ["Do not enter the same bill number twice."],
    after: "Approved bills can be paid.",
  },
  {
    id: "scan-bill",
    module: "finance",
    title: "Scan a bill",
    where: "Finance → Scan a bill.",
    route: "/scan-bill",
    who: "Accounts, Supervisor.",
    purpose: "AI reads a bill photo into an invoice draft.",
    fields: [
      {
        label: "Site",
        standard: "Where the bill belongs.",
        example: "Patia Tower A",
        required: true,
      },
      {
        label: "Photo",
        standard: "Whole bill, flat, good light.",
        example: "(camera or gallery)",
        required: true,
      },
    ],
    scenario: {
      story: "The supervisor photographs a hardware bill.",
      steps: [
        "Tap Scan a bill, take the photo.",
        "Check every field the AI read, correct, then save the draft.",
      ],
    },
    dos: ["Check numbers against the paper."],
    donts: ["Do not save without reading what the AI filled."],
    after: "An invoice draft is created for submission.",
  },
  {
    id: "payment",
    module: "finance",
    title: "Supplier payment",
    where: "Finance → Payments → Record payment.",
    route: "/finance",
    who: "Accounts; a different person approves.",
    purpose: "A record that you paid a supplier, allocated to bills.",
    fields: [
      {
        label: "Supplier",
        standard: "Who was paid.",
        example: "Kalinga Building Materials Pvt Ltd",
        required: true,
      },
      { label: "Total payment amount (₹)", standard: "Rupees.", example: "50000", required: true },
      { label: "Payment date", standard: DATE, example: "2026-11-15", required: true },
      {
        label: "Category / Purpose",
        standard: "What for.",
        example: "Supplier invoice settlement",
        required: true,
      },
      {
        label: "Paid by person / Funding source",
        standard: "Who and from where.",
        example: "Demo Accountant / Current account",
      },
      { label: "External reference", standard: "UTR / cheque no.", example: "UTR 2026111500456" },
      {
        label: "Allocate (₹)",
        standard: "Per approved invoice.",
        example: "50000 to KBM/2026/1184",
      },
    ],
    scenario: {
      story: "A part payment of ₹50,000 against the cement bill.",
      steps: [
        "Tap Record payment, enter amount, date and UTR.",
        "Allocate to the invoice and submit.",
      ],
    },
    dos: ["Pay first in the bank, then record it here."],
    donts: ["The app does not move money; never treat this as a transfer."],
    after: "Posted payments reduce what you owe.",
  },
  {
    id: "petty-fund",
    module: "finance",
    title: "Site petty cash fund",
    where: "Finance → Petty Cash → New fund.",
    route: "/finance",
    who: "Accounts creates; the custodian accepts.",
    purpose: "A small cash float held by one named person at a site.",
    fields: [
      {
        label: "Fund name",
        standard: "Site + petty cash.",
        example: "Patia site cash",
        required: true,
      },
      {
        label: "Custodian",
        standard: "Who holds the cash.",
        example: "Demo Supervisor",
        required: true,
      },
      {
        label: "Authorised balance ceiling (₹)",
        standard: "Maximum cash held.",
        example: "25000",
        required: true,
      },
    ],
    scenario: {
      story: "Patia gets a ₹25,000 petty cash fund.",
      steps: [
        "Tap New fund, fill name, custodian and ceiling.",
        "The supervisor accepts it on their phone.",
      ],
    },
    dos: ["One fund per site."],
    donts: ["Do not mix personal money with the fund."],
    after: "Top-ups and expenses are recorded as movements.",
  },
  {
    id: "petty-movement",
    module: "finance",
    title: "Petty cash movement (expense / top-up)",
    where: "Finance → Petty Cash → Record movement.",
    route: "/finance",
    who: "Custodian records; a different person posts.",
    purpose: "Every rupee in or out of the site cash.",
    fields: [
      {
        label: "Type / Category",
        standard: "Expense, top-up, return; category.",
        example: "Expense / Consumables",
        required: true,
      },
      { label: "Amount (₹)", standard: "Rupees.", example: "1850", required: true },
      { label: "Date", standard: DATE, example: "2026-11-06", required: true },
      {
        label: "Payee",
        standard: "Person or shop paid.",
        example: "Mahavir Hardware",
        required: true,
      },
      {
        label: "Purpose",
        standard: "What for.",
        example: "Binding wire and nails",
        required: true,
      },
      {
        label: "Receipt photos / reference",
        standard: "Photo, or why none.",
        example: "Bill photo",
      },
    ],
    scenario: {
      story: "The supervisor buys binding wire for ₹1,850 in cash.",
      steps: [
        "Tap Record movement, choose Expense, fill amount, payee, purpose.",
        "Add the receipt photo, tick the confirmation and submit.",
      ],
    },
    dos: ["Photo every receipt the same day."],
    donts: ["Do not record an expense paid from your own pocket as fund cash."],
    after: "Posted entries change the fund balance.",
    ai: "450 rupees diesel generator ke liye, Mahavir petrol pump, cash",
  },

  // ---------------------------------------------------------------- CRM
  {
    id: "client",
    module: "crm",
    title: "New client",
    where: "Clients & leads → Clients → New client.",
    route: "/crm",
    who: "Owner, Director, Admin, Project manager.",
    purpose: "A person, company or department you work for.",
    fields: [
      {
        label: "Client name",
        standard: "Legal name.",
        example: "Bhubaneswar Development Authority",
        required: true,
      },
      { label: "Type", standard: "Government, Private, …", example: "Government" },
      {
        label: "Contact person / Mobile",
        standard: "Name + 10 digits.",
        example: "Mr. Das / 9437012345",
      },
      {
        label: "Address",
        standard: "Office address.",
        example: "Akash Shova Building, Bhubaneswar",
      },
      { label: "GSTIN (optional)", standard: "15 characters.", example: "21AAAAA0000A1Z5" },
    ],
    scenario: {
      story: "BDA becomes a client.",
      steps: ["Tap New client, fill the form, Save client."],
    },
    dos: ["Add GSTIN so bills show it."],
    donts: ["Do not create a client per project; one client, many projects."],
    after: "The client can be used in enquiries, quotations and contracts.",
    ai: "PWD Aska division, government, contact Mr. Das 94370 12345",
  },
  {
    id: "lead",
    module: "crm",
    title: "New enquiry",
    where: "Clients & leads → New enquiry.",
    route: "/crm",
    who: "Owner, Director, Admin, Project manager.",
    purpose: "A possible job, followed until won or lost.",
    fields: [
      {
        label: "What is the work?",
        standard: "Work + place.",
        example: "Boundary wall, school campus",
        required: true,
      },
      {
        label: "Client (optional)",
        standard: "Existing or New / not yet.",
        example: "New / not yet",
      },
      {
        label: "Contact name / Mobile",
        standard: "Who to call.",
        example: "Headmaster / 9437000303",
      },
      { label: "Location", standard: "Town.", example: "Govt High School, Patia" },
      { label: "Estimated value (₹)", standard: "Rupees.", example: "650000" },
      { label: "Source", standard: "How it came.", example: "Walk-in" },
      { label: "Next follow-up", standard: DATE, example: "2026-12-09" },
    ],
    scenario: {
      story: "A school asks for a boundary wall.",
      steps: [
        "Tap New enquiry, describe the work, contact and value.",
        "Set the follow-up date, Save enquiry.",
      ],
    },
    dos: ["Always set the next follow-up."],
    donts: ["Do not leave enquiries without a stage."],
    after: "It shows in the pipeline; follow-ups due appear on top.",
    ai: "Sahu ji ka G+2 ghar Aska mein, 25 lakh, referral se, Monday follow-up",
  },
  {
    id: "followup",
    module: "crm",
    title: "Enquiry follow-up and stage",
    where: "Clients & leads → open the enquiry.",
    route: "/crm",
    who: "Same as enquiry.",
    purpose: "Record each call or visit and move the stage.",
    fields: [
      {
        label: "Move to stage",
        standard: "Contacted, Site visit, Quotation sent, Negotiation, Won, Lost.",
        example: "Site visit",
      },
      {
        label: "What happened",
        standard: "One sentence.",
        example: "Visited site, measured 120 rmt.",
      },
      { label: "Next follow-up", standard: DATE, example: "2026-12-12" },
    ],
    scenario: {
      story: "After the site visit the lead moves on.",
      steps: ["Tap Move to Site visit.", "Add what happened and the next follow-up, Save."],
    },
    dos: ["Mark Lost with a reason; it teaches the team."],
    donts: ["Do not skip stages to look good."],
    after: "History stays on the enquiry.",
  },
  {
    id: "quotation",
    module: "crm",
    title: "Quotation",
    where: "Open the enquiry → make a quotation.",
    route: "/crm",
    who: "Owner, Director, Admin, Project manager.",
    purpose: "Itemised prices for the client.",
    fields: [
      {
        label: "Title",
        standard: "Work + place.",
        example: "Boundary wall for school campus",
        required: true,
      },
      { label: "Date (YYYY-MM-DD)", standard: DATE, example: "2026-12-10", required: true },
      { label: "Valid until", standard: DATE, example: "2027-01-09" },
      { label: "GST %", standard: "Number.", example: "18" },
      {
        label: "Item: code, description, unit, qty, rate",
        standard: "BOQ line.",
        example: "1, Brick wall 230 mm, rmt, 120, 2800",
      },
      {
        label: "Terms",
        standard: "Payment and validity.",
        example: "Running bills monthly, due in 30 days.",
      },
    ],
    scenario: {
      story: "Quotation for the school wall.",
      steps: [
        "Make a quotation from the enquiry.",
        "Add items: 120 rmt wall at 2800, 2 gates at 18000; check totals; save.",
      ],
    },
    dos: ["Number items like the client's BOQ."],
    donts: ["Do not change a sent quotation; make a new one."],
    after: "When accepted, the enquiry is Won and the quotation can become a contract.",
    ai: "School boundary wall, 120 rmt wall 2800 rupaye, 2 gate 18000",
  },

  // ---------------------------------------------------------------- Billing
  {
    id: "contract",
    module: "billing",
    title: "Client contract and items (BOQ)",
    where: "Client billing → choose project → contract.",
    route: "/billing",
    who: "Accounts, Project manager.",
    purpose: "The client contract and its BOQ for RA bills.",
    fields: [
      {
        label: "Client",
        standard: "From Clients.",
        example: "Bhubaneswar Development Authority",
        required: true,
      },
      {
        label: "Contract / work order no.",
        standard: "Client's reference.",
        example: "BDA/WO/2026/118",
      },
      {
        label: "Contract value (before GST)",
        standard: "Rupees.",
        example: "59275750",
        required: true,
      },
      { label: "GST % / Retention % / TDS %", standard: "Numbers.", example: "18 / 5 / 2" },
      {
        label: "Item code / Description / Unit / Contract qty / Rate ₹",
        standard: "BOQ line.",
        example: "1.1 / Earthwork in excavation / cum / 850 / 295",
      },
    ],
    scenario: {
      story: "BDA contract for Phase 1.",
      steps: ["Fill the contract and Save contract.", "Tap + Add contract item for each BOQ line."],
    },
    dos: ["Copy item codes from the agreement BOQ."],
    donts: ["Do not change rates after bills are made."],
    after: "RA bills can be made against the items.",
  },
  {
    id: "ra-bill",
    module: "billing",
    title: "Client RA bill",
    where: "Client billing → New RA bill.",
    route: "/billing",
    who: "Accounts; a director approves.",
    purpose: "Bill the client for work done this period.",
    fields: [
      { label: "Bill date", standard: DATE, example: "2026-11-07", required: true },
      { label: "Work from / Work to", standard: DATE, example: "2026-10-01 / 2026-10-31" },
      {
        label: "Quantity done this bill",
        standard: "Per item, within balance.",
        example: "1.1: 120 cum",
        required: true,
      },
      { label: "Other deduction ₹ / note", standard: "Rupees + reason.", example: "0" },
    ],
    scenario: {
      story: "October bill to BDA.",
      steps: [
        "Tap New RA bill, set the dates.",
        "Enter quantities per item, check totals, save and submit.",
      ],
    },
    dos: ["Bill only measured, approved work."],
    donts: ["Quantities cannot exceed the contract balance."],
    after: "After approval, record money received against it.",
    ai: "October ka bill, item 2.1 mein 35 cum, PCC 12 cum",
  },
  {
    id: "receipt",
    module: "billing",
    title: "Money received",
    where: "Client billing → open the approved bill → Money received.",
    route: "/billing",
    who: "Accounts.",
    purpose: "Records a client payment against a bill.",
    fields: [
      { label: "Amount ₹", standard: "Rupees received.", example: "500000", required: true },
      { label: "Received on", standard: DATE, example: "2026-11-25", required: true },
      { label: "Reference", standard: "UTR/cheque.", example: "UTR BDA2611250099" },
    ],
    scenario: {
      story: "BDA pays ₹5,00,000 against RA-01.",
      steps: ["Open RA-01, enter amount, date and UTR, save."],
    },
    dos: ["Record TDS deducted by the client in Accounts."],
    donts: ["Do not record money before it is in the bank."],
    after: "The bill shows Part paid or Paid; receivables update.",
  },

  // ---------------------------------------------------------------- Payroll
  {
    id: "pay-run",
    module: "payroll",
    title: "Pay run",
    where: "More → Payroll → choose site and month → Make pay run.",
    route: "/payroll",
    who: "Accounts; a different person approves.",
    purpose: "One month's wages for a site from approved attendance.",
    fields: [
      { label: "Month to pay", standard: "YYYY-MM.", example: "2026-10", required: true },
      { label: "Paid days (per line)", standard: "Leave empty for automatic.", example: "" },
      {
        label: "TDS / Advance recovery / Other deduction (₹)",
        standard: "Rupees.",
        example: "0 / 500 / 0",
      },
      {
        label: "Paid on / Mode / Reference",
        standard: "When paid.",
        example: "2026-11-07 / UPI / UTR...",
      },
    ],
    scenario: {
      story: "October wages for Patia.",
      steps: [
        "Check October attendance is approved.",
        "Tap Make pay run for 2026-10, open it, check each line.",
        "Submit for approval; after approval and payment tap Mark paid.",
      ],
    },
    dos: ["Download PF ECR and ESIC files after approval."],
    donts: ["Do not make the run before attendance is approved."],
    after: "Payslips and statutory files are ready.",
  },
  {
    id: "pay-details",
    module: "payroll",
    title: "Pay details (salary, PF, ESI)",
    where: "Payroll → Pay details → Set pay details.",
    route: "/payroll",
    who: "Accounts; a different person approves.",
    purpose: "Monthly salary parts and PF/ESI membership for one person.",
    fields: [
      { label: "Basic + DA a month (₹)", standard: "Empty for daily wages.", example: "15000" },
      { label: "HRA / Other allowance a month (₹)", standard: "Rupees.", example: "3000 / 2000" },
      { label: "PF member / UAN (12 digits)", standard: "12 digits.", example: "100200300400" },
      {
        label: "ESI member / ESI IP number (10 digits)",
        standard: "10 digits.",
        example: "3100123456",
      },
      { label: "From date", standard: DATE, example: "2026-10-01", required: true },
    ],
    scenario: {
      story: "Anil is a monthly engineer with PF and ESI.",
      steps: ["Tap Set pay details for Anil, fill salary, UAN, IP number and from date, save."],
    },
    dos: ["Copy UAN exactly from the EPFO card."],
    donts: ["Do not change past months; start from a new date."],
    after: "Approved details are used in the next pay run.",
  },
  {
    id: "advance",
    module: "payroll",
    title: "Worker advance (khaata)",
    where: "Payroll → Khaata → Give advance (or the worker's khaata).",
    route: "/payroll",
    who: "Supervisor/Accounts request; a different person approves.",
    purpose: "An advance to a worker, recovered from pay runs.",
    fields: [
      { label: "Amount (₹)", standard: "Rupees.", example: "2000", required: true },
      { label: "Date", standard: DATE, example: "2026-11-07", required: true },
      { label: "Mode", standard: "Cash, UPI, bank.", example: "UPI" },
      { label: "What is it for", standard: "Reason.", example: "Rent deposit" },
      { label: "Recover each month (₹)", standard: "Instalment.", example: "1000", required: true },
    ],
    scenario: {
      story: "Ramesh takes ₹2,000 for his rent deposit.",
      steps: [
        "Open Khaata, give advance 2000, UPI, Rent deposit, recover 1000.",
        "The approver approves.",
      ],
    },
    dos: ["Keep instalments small enough for the worker."],
    donts: ["Do not give a new advance before the old one is recovered without approval."],
    after: "Each pay run suggests the instalment and lowers the balance.",
    ai: "2000 rupaye cash diye ghar ke kaam ke liye, 500 har pay run katna",
  },

  // ---------------------------------------------------------------- Accounts
  {
    id: "deposit",
    module: "accounts",
    title: "Statutory deposit",
    where: "Accounts → Record a deposit.",
    route: "/accounts",
    who: "Accounts.",
    purpose: "PF, ESI, PT or TDS paid to the government.",
    fields: [
      {
        label: "What was paid",
        standard: "PF, ESI, PT, TDS contractor, TDS salary.",
        example: "PF",
        required: true,
      },
      { label: "For month", standard: "YYYY-MM.", example: "2026-10", required: true },
      { label: "Amount (₹)", standard: "Rupees.", example: "5563", required: true },
      { label: "Paid on", standard: DATE, example: "2026-11-12", required: true },
      {
        label: "Challan / TRRN number",
        standard: "From the challan.",
        example: "TRRN 2026110400123",
        required: true,
      },
    ],
    scenario: {
      story: "October PF paid on 12 November.",
      steps: ["Tap Record a deposit, choose PF, 2026-10, amount, date, TRRN, save."],
    },
    dos: ["Deposit by the 15th (PF/ESI) and 7th (TDS)."],
    donts: ["Reverse a wrong deposit with a reason; do not delete."],
    after: "The due shows Paid; overdue dues leave your inbox.",
  },

  // ---------------------------------------------------------------- Documents
  {
    id: "document",
    module: "documents",
    title: "Upload a document",
    where: "More → Project documents → Upload.",
    route: "/documents",
    who: "Everyone with document access.",
    purpose: "Drawings and files for a project, with versions.",
    fields: [
      {
        label: "File",
        standard: "PDF, photo, Word, Excel, CSV.",
        example: "GF-01.pdf",
        required: true,
      },
      {
        label: "Title",
        standard: "Name + drawing no.",
        example: "Block 1 ground floor plan (GF-01)",
        required: true,
      },
      { label: "Category", standard: "One category.", example: "Drawings", required: true },
      { label: "Belongs to", standard: "Whole project or a site.", example: "Patia Tower A" },
      {
        label: "Tags / Description (optional)",
        standard: "Search words.",
        example: "block A, ground floor, revision 2",
      },
    ],
    scenario: {
      story: "The architect sends revision 2 of the ground floor plan.",
      steps: [
        "Open the existing document, tap Upload a new version.",
        "Choose the file; the old version stays in history.",
      ],
    },
    dos: ["Upload new revisions as a new version, not a new document."],
    donts: ["Do not upload personal ID documents here."],
    after: "Everyone sees the current version; search finds text inside.",
  },

  // ---------------------------------------------------------------- More
  {
    id: "alerts",
    module: "more",
    title: "Alert settings",
    where: "More → Alert settings.",
    route: "/alert-settings",
    who: "Everyone for themselves; owners for company rules.",
    purpose: "How you get alerts: app, WhatsApp, SMS.",
    fields: [
      { label: "Mobile number", standard: "10 digits.", example: "9876543210" },
      {
        label: "Channels",
        standard: "App notifications, WhatsApp, SMS (urgent only).",
        example: "App + WhatsApp",
      },
      {
        label: "Company alert rules",
        standard: "Per category, roles and channels.",
        example: "Safety & quality: all roles",
      },
    ],
    scenario: {
      story: "The manager wants critical issues on WhatsApp.",
      steps: ["Enter mobile, switch WhatsApp on, Save.", "Tap Send me a test alert."],
    },
    dos: ["Send a test alert after any change."],
    donts: ["Do not switch off alerts for safety issues."],
    after: "Alerts follow your channels.",
  },
  {
    id: "export",
    module: "more",
    title: "Export data",
    where: "More → Export data.",
    route: "/exports",
    who: "Owner, Director, Admin, Accounts, Auditor.",
    purpose: "Records as a CSV for Excel or Google Sheets.",
    fields: [
      { label: "What", standard: "Record type.", example: "Supplier invoices", required: true },
      { label: "Where", standard: "All sites or one.", example: "All my sites" },
      { label: "Format", standard: "Excel (CSV) or PDF.", example: "Excel (CSV)" },
      { label: "When", standard: "Period.", example: "Last month" },
    ],
    scenario: {
      story: "Accounts sends last month's bills to the CA.",
      steps: ["Choose Supplier invoices, All my sites, Last month.", "Tap Create CSV and share."],
    },
    dos: ["Export shorter periods if over 5000 rows."],
    donts: ["Do not share exports outside the company without permission."],
    after: "The file downloads; the export is in the audit trail.",
  },
  {
    id: "report-problem",
    module: "more",
    title: "Report a problem",
    where: "More → Report a problem.",
    route: "/report-problem",
    who: "Everyone.",
    purpose: "Tell your admin and the developer what went wrong.",
    fields: [
      {
        label: "What is it about?",
        standard: "One choice.",
        example: "A figure looks wrong",
        required: true,
      },
      {
        label: "What happened?",
        standard: "Screen, what you did, what you saw.",
        example: "Payroll → Patia → October: net pay shows ₹0 for Anil.",
        required: true,
      },
    ],
    scenario: {
      story: "A supervisor sees a wrong total.",
      steps: ["Open Report a problem, choose the type, describe it, Send."],
    },
    dos: ["Name the screen and the record."],
    donts: ["Do not write passwords in the report."],
    after: "Admins see it in App problems.",
  },

  // ---------------------------------------------------------------- Worker app
  {
    id: "worker-signin",
    module: "worker",
    title: "Worker login and help",
    where: "Sign-in screen → Mistri / worker login (mobile + PIN).",
    route: "/",
    who: "Workers and mistri.",
    purpose: "Workers see their own pay, attendance and drawings and can call for help.",
    fields: [
      {
        label: "Your mobile number",
        standard: "10 digits.",
        example: "9876500001",
        required: true,
      },
      {
        label: "Your 6-digit PIN",
        standard: "From the supervisor.",
        example: "••••••",
        required: true,
      },
    ],
    scenario: {
      story: "Ramesh checks how much pay is still due.",
      steps: [
        "Tap Mistri / worker login, enter the mobile number.",
        "Type the PIN; the app opens at the sixth digit.",
        "Read or tap Listen; use Call supervisor or Tell a problem when needed.",
      ],
    },
    dos: ["Tap Forgot PIN? Tell supervisor if you forget."],
    donts: ["Do not tell your PIN to anyone."],
    after: "Sign out when someone else uses the phone.",
  },
];

export function manualFormById(id: string | null | undefined) {
  return MANUAL_FORMS.find((form) => form.id === id) ?? null;
}

export function manualFormsOf(moduleKey: string) {
  return MANUAL_FORMS.filter((form) => form.module === moduleKey);
}

/** Forms whose title, purpose or fields mention every word of the query. */
export function searchManual(query: string) {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length) return MANUAL_FORMS;
  return MANUAL_FORMS.filter((form) => {
    const text = [form.title, form.purpose, form.where, ...form.fields.map((f) => f.label)]
      .join(" ")
      .toLowerCase();
    return words.every((word) => text.includes(word));
  });
}

/** Which manual module a screen belongs to, for the book icon in every screen header. */
const ROUTE_MODULES: Record<string, string> = {
  index: "start",
  profile: "start",
  sites: "projects",
  site: "projects",
  projects: "projects",
  project: "projects",
  users: "users",
  invites: "users",
  "user-access": "users",
  delegation: "users",
  modules: "users",
  workforce: "workforce",
  people: "workforce",
  person: "workforce",
  crews: "workforce",
  tracking: "workforce",
  "project-budget": "budget",
  attendance: "attendance",
  reports: "reports",
  "report-editor": "reports",
  "site-reports": "reports",
  schedule: "schedule",
  requests: "requests",
  "site-requests": "requests",
  issues: "issues",
  issue: "issues",
  inventory: "inventory",
  purchase: "purchase",
  po: "purchase",
  "po-editor": "purchase",
  subcontract: "subcontract",
  "work-order": "subcontract",
  "wo-editor": "subcontract",
  "sub-bill": "subcontract",
  finance: "finance",
  "scan-bill": "finance",
  crm: "crm",
  lead: "crm",
  quotation: "crm",
  "quotation-editor": "crm",
  billing: "billing",
  bill: "billing",
  "bill-editor": "billing",
  payroll: "payroll",
  "pay-run": "payroll",
  khaata: "payroll",
  accounts: "accounts",
  documents: "documents",
  "document-detail": "documents",
  "alert-settings": "more",
  exports: "more",
  "report-problem": "more",
  more: "more",
  "worker-view": "worker",
};

/** The manual module for a route's segments (e.g. ["(tabs)", "reports"] → "reports"). */
export function manualModuleForSegments(segments: readonly string[]) {
  const named = segments.filter((part) => !part.startsWith("("));
  const first = named[0] ?? "index";
  return ROUTE_MODULES[first] ?? null;
}
