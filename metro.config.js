const path = require("path");
const { getDefaultConfig } = require("expo/metro-config");
const { withNativeWind } = require("nativewind/metro");

const config = getDefaultConfig(__dirname);

module.exports = withOfflineDemo(
  withNativeWind(config, {
    input: "./global.css",
  }),
);

/**
 * Offline demo build (EXPO_PUBLIC_JP_DEMO=1): the app answers its own API calls with the real
 * server code. These swaps replace the parts that need a server machine (MySQL, JWT sessions,
 * cloud storage, node:crypto) with the phone versions in lib/demo/. Normal builds are untouched.
 */
function withOfflineDemo(metroConfig) {
  if (process.env.EXPO_PUBLIC_JP_DEMO !== "1") return metroConfig;
  const root = __dirname;
  const at = (file) => path.join(root, file);
  const swaps = new Map([
    [at("server/db.ts"), at("lib/demo/server/db.ts")],
    [at("server/_core/sdk.ts"), at("lib/demo/server/sdk.ts")],
    [at("server/storage.ts"), at("lib/demo/server/storage.ts")],
    [at("lib/demo/link.ts"), at("lib/demo/backend.ts")],
  ]);
  const upstream = metroConfig.resolver.resolveRequest;
  metroConfig.resolver.resolveRequest = (context, moduleName, platform) => {
    if (moduleName === "node:crypto" || moduleName === "crypto")
      return { type: "sourceFile", filePath: at("lib/demo/shims/crypto.ts") };
    const resolve = (name) =>
      upstream
        ? upstream(context, name, platform)
        : context.resolveRequest(context, name, platform);
    let resolved;
    try {
      resolved = resolve(moduleName);
    } catch (error) {
      // Server code imports TypeScript files with a .js suffix (Node ESM style).
      if (!/\.js$/.test(moduleName)) throw error;
      resolved = resolve(moduleName.replace(/\.js$/, ""));
    }
    if (resolved.type === "sourceFile" && swaps.has(resolved.filePath))
      return { type: "sourceFile", filePath: swaps.get(resolved.filePath) };
    return resolved;
  };
  return metroConfig;
}
