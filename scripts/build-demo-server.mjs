// Bundles scripts/demo-server.ts into dist-demo/demo-server.mjs, swapping the server's MySQL,
// session and storage modules for the demo versions (as metro.config.js does for the phone).
import path from "node:path";
import { build } from "esbuild";

const root = path.resolve(import.meta.dirname, "..");
const swaps = new Map([
  [path.join(root, "server/db.ts"), path.join(root, "lib/demo/server/db.ts")],
  [path.join(root, "server/_core/sdk.ts"), path.join(root, "lib/demo/server/sdk.ts")],
  [path.join(root, "server/storage.ts"), path.join(root, "lib/demo/server/storage.ts")],
]);

await build({
  entryPoints: [path.join(root, "scripts/demo-server.ts")],
  outfile: path.join(root, "dist-demo/demo-server.mjs"),
  bundle: true,
  platform: "node",
  target: "node22",
  format: "esm",
  external: ["node:sqlite"],
  banner: {
    js: "import { createRequire as __cr } from 'module'; const require = __cr(import.meta.url);",
  },
  plugins: [
    {
      name: "demo-swaps",
      setup(b) {
        b.onResolve({ filter: /(^|\/)(db|sdk|storage)(\.js|\.ts)?$/ }, async (args) => {
          if (args.pluginData?.swapped) return undefined;
          const result = await b.resolve(args.path, {
            resolveDir: args.resolveDir,
            kind: args.kind,
            importer: args.importer,
            pluginData: { swapped: true },
          });
          const target = swaps.get(result.path);
          return target ? { path: target } : undefined;
        });
      },
    },
  ],
  logLevel: "warning",
});
console.log("Built dist-demo/demo-server.mjs");
