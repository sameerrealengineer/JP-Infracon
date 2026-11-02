import { fileURLToPath } from "node:url";
import { configDefaults, defineConfig } from "vitest/config";

const root = fileURLToPath(new URL(".", import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      "@/": root,
      "@shared/": `${root}shared/`,
    },
  },
  test: {
    // Playwright specs live in e2e/ and run with `pnpm test:e2e`, not Vitest.
    exclude: [...configDefaults.exclude, "e2e/**"],
  },
});
