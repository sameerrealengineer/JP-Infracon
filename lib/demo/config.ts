/**
 * Offline demo build switch. Build the demo APK with EXPO_PUBLIC_JP_DEMO=1 (see `eas.json`,
 * profile `demo`). Without it the app talks to the real API and none of this is used.
 */
export const DEMO_MODE = process.env.EXPO_PUBLIC_JP_DEMO === "1";

/** Shared password of every demo account. Demo only: these accounts exist only on the phone. */
export const DEMO_PASSWORD = "JPDemo@12345";
/** Worker (mistri) login in the demo: Ramesh Behera, mason. Demo data only. */
export const DEMO_WORKER = { mobile: "9876500001", pin: "482913" } as const;

export type DemoAccount = {
  username: string;
  displayName: string;
  role:
    | "owner"
    | "director"
    | "project_manager"
    | "supervisor"
    | "accounts"
    | "storekeeper"
    | "auditor";
  label: string;
};

/** One account per role, so a tester can see each person's view and the maker-checker steps. */
export const DEMO_ACCOUNTS: readonly DemoAccount[] = [
  { username: "owner", displayName: "Demo Owner", role: "owner", label: "Owner (Super Admin)" },
  { username: "director", displayName: "Demo Director", role: "director", label: "Director" },
  {
    username: "manager",
    displayName: "Demo Project Manager",
    role: "project_manager",
    label: "Project manager",
  },
  {
    username: "supervisor",
    displayName: "Demo Supervisor",
    role: "supervisor",
    label: "Site supervisor",
  },
  { username: "accounts", displayName: "Demo Accountant", role: "accounts", label: "Accounts" },
  { username: "store", displayName: "Demo Storekeeper", role: "storekeeper", label: "Storekeeper" },
  { username: "auditor", displayName: "Demo Auditor", role: "auditor", label: "Auditor" },
];
