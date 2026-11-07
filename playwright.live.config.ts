import { defineConfig, devices } from "@playwright/test";

/**
 * Live end-to-end tests: the real web app against the online demo server (real API, real
 * permission and money rules, SQLite sample data). Start it first:
 *   DEMO_DB_FILE=/tmp/jp-live.db PORT=3100 node dist-demo/demo-server.mjs
 * then: npx playwright test -c playwright.live.config.ts
 * Delete the database file between runs for fresh sample data.
 */
export default defineConfig({
  testDir: "e2e-live",
  fullyParallel: false,
  workers: 1,
  reporter: "line",
  expect: { timeout: 20_000 },
  timeout: 120_000,
  use: {
    baseURL: process.env.LIVE_BASE_URL ?? "http://localhost:3100",
    trace: "retain-on-failure",
  },
  projects: [{ name: "phone", use: { ...devices["Pixel 7"], browserName: "chromium" } }],
});
