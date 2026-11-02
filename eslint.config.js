// https://docs.expo.dev/guides/using-eslint/
import { defineConfig } from "eslint/config";
import expoConfig from "eslint-config-expo/flat.js";

export default defineConfig([
  expoConfig,
  {
    ignores: ["dist/*"],
  },
  {
    // Server code runs on Node, where env vars are read at runtime, not inlined into an app bundle.
    files: ["server/**/*.ts"],
    rules: { "expo/no-dynamic-env-var": "off" },
  },
]);
