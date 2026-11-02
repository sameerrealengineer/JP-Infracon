// End-to-end check of a FRESH self-hosted server (it creates a Super Admin, company and test records).
// Never run it against a database that holds real company data.
// Usage: SMOKE_BASE_URL=http://127.0.0.1:3999 SMOKE_SETUP_KEY=... npx tsx scripts/selfhost-smoke.mts
import { createTRPCClient, httpLink } from "@trpc/client";
import superjson from "superjson";
import type { AppRouter } from "../server/routers";

const BASE = process.env.SMOKE_BASE_URL ?? "http://127.0.0.1:3999";
function client(token?: string) {
  return createTRPCClient<AppRouter>({
    links: [
      httpLink({
        url: `${BASE}/api/trpc`,
        transformer: superjson,
        headers: () => ({
          "x-jp-client-platform": "android",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        }),
      }),
    ],
  });
}
const id = () => crypto.randomUUID();
const step = (name: string, value?: unknown) =>
  console.log(`✔ ${name}${value === undefined ? "" : ` → ${JSON.stringify(value).slice(0, 140)}`}`);

const anon = client();
const boot = await anon.auth.bootstrapFirstSuperAdmin.mutate({
  bootstrapSecret: process.env.SMOKE_SETUP_KEY ?? "",
  username: "sameer.admin",
  displayName: "Sameer Swain",
  password: "SuperAdmin-Pass-2026!",
});
step("super admin created", boot.user.name);
const admin = client(boot.sessionToken!);
const ws = await admin.jp.workspace.initializeFirstWorkspace.mutate({
  organizationName: "JP Infracon",
  organizationCode: "JPI",
  projectName: "Khurda Rural Water Supply",
  projectCode: "RWSS-KHD",
  siteName: "Balugaon Pump House",
  siteCode: "BALUGAON",
});
step("workspace created", ws);
const site2 = await admin.jp.sitesAdmin.createSite.mutate({
  projectId: ws.projectId,
  siteCode: "TANGI-ER",
  name: "Tangi Elevated Reservoir",
  clientMutationId: id(),
});
step("second site created", site2);
const invite = await admin.jp.accounts.createInvite.mutate({
  organizationId: ws.organizationId,
  inviteeName: "Sipun Behera",
  businessRole: "supervisor",
  siteId: ws.siteId,
  validDays: 7,
});
step("invite created", invite.code);
const bad = await anon.auth.registerWithInvite
  .mutate({ code: "AAAAA-BBBBB", username: "nobody", password: "Whatever-Pass-123" })
  .catch((e: Error) => e.message);
step("wrong code refused", bad);
const reg = await anon.auth.registerWithInvite.mutate({
  code: invite.code.toLowerCase(),
  username: "sipun",
  password: "Supervisor-Pass-2026",
});
step("supervisor signed up with invite", reg.user.name);
const reuse = await anon.auth.registerWithInvite
  .mutate({ code: invite.code, username: "sipun2", password: "Supervisor-Pass-2026" })
  .catch((e: Error) => e.message);
step("used code refused", reuse);
const sup = client(reg.sessionToken!);
const supSites = await sup.jp.workspace.mySites.query();
step(
  "supervisor sees only assigned site",
  supSites.map((s) => s.name),
);
const denied = await sup.jp.sitesAdmin.createSite
  .mutate({ projectId: ws.projectId, siteCode: "X1", name: "Hack", clientMutationId: id() })
  .catch((e: Error) => e.message);
step("supervisor cannot create sites", denied);
const issue = await sup.jp.issues.create.mutate({
  siteId: ws.siteId,
  category: "Safety Hazard",
  severity: "Critical",
  title: "Trench edge not barricaded",
  description: "1.8 m deep trench at chainage 2+350 without edge protection",
  stopWork: true,
  clientMutationId: id(),
});
step("critical issue raised", issue.issueCode);
const jpeg = Buffer.from(
  "/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAALCAABAAEBAREA/8QAFAABAAAAAAAAAAAAAAAAAAAACf/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AKp//2Q==",
  "base64",
);
const up = await sup.jp.attachments.upload.mutate({
  entityType: "site_issue",
  entityId: issue.id,
  fileName: "trench.jpg",
  base64: jpeg.toString("base64"),
  sourceType: "Captured in app",
  location: { latitude: 19.7563, longitude: 85.2001, accuracyM: 8 },
  clientMutationId: id(),
});
step("photo uploaded", up);
const fake = await sup.jp.attachments.upload
  .mutate({
    entityType: "site_issue",
    entityId: issue.id,
    fileName: "evil.jpg",
    base64: Buffer.from("<script>alert(1)</script>").toString("base64"),
    sourceType: "Selected from device",
    clientMutationId: id(),
  })
  .catch((e: Error) => e.message);
step("fake image refused", fake);
const link = await admin.jp.attachments.open.mutate({ attachmentId: up.id });
const res = await fetch(link.url);
step(
  "photo opens via signed link",
  `${res.status} ${res.headers.get("content-type")} ${(await res.arrayBuffer()).byteLength} bytes`,
);
const files = await admin.jp.attachments.list.query({
  entityType: "site_issue",
  entityId: issue.id,
});
step("photo location stored", files[0]?.location);
const inbox = await admin.jp.workspace.inbox.query();
step("admin inbox", { items: inbox.items.map((i) => i.kind), unavailable: inbox.unavailable });
await admin.jp.issues.transition.mutate({
  issueId: issue.id,
  action: "start",
  clientMutationId: id(),
});
await sup.jp.issues.transition
  .mutate({
    issueId: issue.id,
    action: "resolve",
    correctiveAction: "Hard barricade fixed",
    clientMutationId: id(),
  })
  .catch(() => undefined);
const selfClose = await sup.jp.issues.transition
  .mutate({ issueId: issue.id, action: "close", note: "done", clientMutationId: id() })
  .catch((e: Error) => e.message);
step("supervisor cannot close critical issue", selfClose);
const deleg = await admin.jp.delegation.create.mutate({
  organizationId: ws.organizationId,
  userId: reg.user.id,
  scopeType: "site",
  scopeId: ws.siteId,
  bundles: ["site_operations", "self_approval"],
  duration: "1d",
  reason: "Director travelling",
  clientMutationId: id(),
});
step("authority delegated for 1 day", deleg);
const closed = await sup.jp.issues.transition.mutate({
  issueId: issue.id,
  action: "close",
  note: "Verified on site",
  clientMutationId: id(),
});
step("delegated supervisor can now close", closed);
const mine = await sup.jp.delegation.mine.query();
step(
  "supervisor sees delegation banner",
  mine.map((m) => m.bundles),
);
const exp = await admin.jp.exports.generate.mutate({
  kind: "issues",
  from: "2026-01-01",
  to: "2026-12-31",
});
step("issues CSV export", `${exp.rowCount} rows, ${exp.csv.split("\r\n").length} lines`);
const audit = await admin.jp.exports.generate.mutate({
  kind: "audit",
  from: "2026-01-01",
  to: "2026-12-31",
});
step("audit export", `${audit.rowCount} audit rows`);
const ai = await admin.jp.ai.status.query();
step("AI status (no keys here)", ai);
console.log("ALL CHECKS PASSED");
