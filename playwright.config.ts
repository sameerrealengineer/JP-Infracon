import { defineConfig, devices } from "@playwright/test";

const port = 8091;

export default defineConfig({
  testDir: "e2e",
  fullyParallel: true,
  reporter: "line",
  // The web bundle can take several seconds to start on a busy machine; allow for it.
  expect: { timeout: 15_000 },
  timeout: 60_000,
  use: {
    baseURL: `http://localhost:${port}`,
    trace: "retain-on-failure",
  },
  // Android first, portrait: test at a phone viewport.
  projects: [{ name: "phone", use: { ...devices["Pixel 7"], browserName: "chromium" } }],
  webServer: {
    command: `npx expo export --platform web --output-dir dist-web && node e2e/serve-export.mjs dist-web ${port}`,
    url: `http://localhost:${port}`,
    timeout: 240_000,
    reuseExistingServer: !process.env.CI,
  },
});
