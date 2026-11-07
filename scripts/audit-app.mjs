// Walks every screen of the running demo server as each demo role and records what breaks:
// server errors returned to the app, page crashes, console errors and error text on screen.
//   node scripts/audit-app.mjs [baseUrl] [outDir]
// Start the demo server first (scripts/demo-server.ts). Writes audit.json and screenshots.
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { chromium, devices } from "@playwright/test";

const base = process.argv[2] ?? "http://localhost:3100";
const out = path.resolve(process.argv[3] ?? "audit-out");
mkdirSync(out, { recursive: true });
const PASSWORD = "JPDemo@12345";
const ROLES = ["owner", "director", "manager", "supervisor", "accounts", "store", "auditor"];
const ROUTES = [
  "/",
  "/sites",
  "/reports",
  "/requests",
  "/more",
  "/notifications",
  "/issues",
  "/attendance",
  "/schedule",
  "/workforce",
  "/people",
  "/inventory",
  "/finance",
  "/documents",
  "/project-budget",
  "/projects",
  "/users",
  "/invites",
  "/delegation",
  "/modules",
  "/alert-settings",
  "/exports",
  "/audit",
  "/profile",
  "/assistant",
  "/scan-bill",
  "/site-reports",
  "/site-requests",
  "/report-editor",
  "/crm",
  "/billing",
  "/purchase",
  "/subcontract",
  "/payroll",
  "/accounts",
  "/people",
  "/system-check",
];
const ERROR_TEXT =
  /(something went wrong|failed to|not found|unavailable|\berror\b|could not|cannot read|undefined|\bNaN\b|\[object Object\])/;

const browser = await chromium.launch();
const findings = [];

for (const role of ROLES) {
  const context = await browser.newContext({ ...devices["Pixel 7"] });
  const page = await context.newPage();
  let current = "login";
  const note = (kind, detail) => findings.push({ role, route: current, kind, detail });
  page.on("pageerror", (error) => note("crash", error.message.slice(0, 300)));
  page.on("console", (message) => {
    if (message.type() === "error") note("console", message.text().slice(0, 300));
  });
  page.on("response", async (response) => {
    if (!response.url().includes("/api/trpc")) return;
    try {
      const body = await response.json();
      for (const item of Array.isArray(body) ? body : [body]) {
        const error = item?.error?.json ?? item?.error;
        if (!error) continue;
        const proc = new URL(response.url()).pathname.replace("/api/trpc/", "");
        const code = error?.data?.code ?? "?";
        // Permission refusals are expected for some roles; record them separately.
        note(code === "FORBIDDEN" ? "forbidden" : "server", `${proc} → ${code}: ${error.message}`);
      }
    } catch {
      // Not JSON.
    }
  });

  await page.goto(base);
  await page.getByLabel("Username").fill(role);
  await page.getByLabel("Password").fill(PASSWORD);
  await page.getByRole("button", { name: /sign in/i }).click();
  await page.waitForTimeout(4000);

  for (const route of ROUTES) {
    current = route;
    try {
      await page.goto(base + route, { waitUntil: "networkidle", timeout: 30_000 });
    } catch {
      note("timeout", "page did not settle in 30 s");
    }
    await page.waitForTimeout(1500);
    const text = await page
      .locator("body")
      .innerText()
      .catch(() => "");
    for (const line of text.split("\n")) {
      if (ERROR_TEXT.test(line) && line.length < 220) note("screen-text", line.trim());
    }
    await page
      .screenshot({ path: path.join(out, `${role}${route.replace(/\//g, "_") || "_home"}.png`) })
      .catch(() => undefined);
    // Open the first record on list screens, so detail screens are checked too.
    const first = page
      .getByRole("button", { name: /^Open (?!notifications|my profile)/ })
      .filter({ visible: true })
      .first();
    if (await first.count()) {
      const label = await first.getAttribute("aria-label");
      current = `${route} → ${label}`;
      await first.click().catch(() => undefined);
      await page.waitForTimeout(3000);
      const detail = await page
        .locator("body")
        .innerText()
        .catch(() => "");
      if (detail.trim().length < 40) note("blank", "detail screen rendered nothing");
      for (const line of detail.split("\n"))
        if (ERROR_TEXT.test(line) && line.length < 220) note("screen-text", line.trim());
    }
  }
  await context.close();
}
await browser.close();

// Deduplicate identical findings per role/route.
const seen = new Set();
const unique = findings.filter((f) => {
  const key = `${f.role}|${f.route}|${f.kind}|${f.detail}`;
  if (seen.has(key)) return false;
  seen.add(key);
  return true;
});
writeFileSync(path.join(out, "audit.json"), JSON.stringify(unique, null, 2));
const counts = unique.reduce((acc, f) => ({ ...acc, [f.kind]: (acc[f.kind] ?? 0) + 1 }), {});
console.log(`Findings: ${unique.length}`, counts);
