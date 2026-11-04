/**
 * Online demo server: the real API (every permission, maker-checker and ledger rule) over a
 * SQLite file filled with the same sample data as the offline demo APK, plus the web app, on one
 * address. No MySQL, no real company data. Built by scripts/build-demo-server.mjs, which swaps
 * the database, session and storage modules for the lib/demo versions.
 *   node dist-demo/demo-server.mjs            (PORT=3100, DEMO_DB_FILE=./demo.db, WEB_DIR=./dist-web)
 * Delete the database file to start again with fresh sample data.
 */
import { createReadStream, existsSync, statSync } from "node:fs";
import path from "node:path";
import express from "express";
import { createExpressMiddleware } from "@trpc/server/adapters/express";
import { appRouter } from "../server/routers";
import { createContext } from "../server/_core/context";
import { setDemoDriver } from "../lib/demo/runtime";
import { createNodeDriver } from "../lib/demo/testing/node-driver";
import { ensureDemoData } from "../lib/demo/backend";

const port = Number(process.env.PORT ?? 3100);
const dbFile = process.env.DEMO_DB_FILE ?? "demo.db";
const webDir = path.resolve(process.env.WEB_DIR ?? "dist-web");

const TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript",
  ".css": "text/css",
  ".json": "application/json",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".ico": "image/x-icon",
  ".ttf": "font/ttf",
  ".svg": "image/svg+xml",
};

/** "/finance" is exported as finance.html and "/site/<id>" as site/[id].html. */
function webFile(urlPath: string) {
  const clean = path.normalize(decodeURIComponent(urlPath)).replace(/^(\.\.[/\\])+/, "");
  const candidates = [
    clean,
    `${clean}.html`,
    path.join(clean, "index.html"),
    path.join(path.dirname(clean), "[id].html"),
  ];
  for (const candidate of candidates) {
    const file = path.join(webDir, candidate);
    if (file.startsWith(webDir) && existsSync(file) && statSync(file).isFile()) return file;
  }
  return path.join(webDir, "index.html");
}

async function main() {
  await setDemoDriver(createNodeDriver(dbFile));
  await ensureDemoData();

  const app = express();
  app.use(express.json({ limit: "50mb" }));
  // The web app keeps its session in a cookie; the demo session check reads the header.
  app.use((req, _res, next) => {
    if (!req.headers.authorization && req.headers.cookie) {
      const match = req.headers.cookie.match(
        /(?:^|;\s*)(?:__Host-)?jp_[a-z_]*session_[^=]*=([^;]+)/,
      );
      if (match) req.headers.authorization = `Bearer ${decodeURIComponent(match[1])}`;
    }
    next();
  });
  app.get("/api/health", (_req, res) => {
    res.json({ ok: true, demo: true });
  });
  app.use("/api/trpc", createExpressMiddleware({ router: appRouter, createContext }));
  if (existsSync(webDir))
    app.get(/.*/, (req, res) => {
      const file = webFile(req.path);
      res.type(TYPES[path.extname(file)] ?? "application/octet-stream");
      createReadStream(file).pipe(res);
    });
  app.listen(port, () => console.log(`[demo] JP Infracon demo on http://localhost:${port}`));
}

main().catch((error) => {
  console.error("[demo] failed to start", error instanceof Error ? error.message : error);
  process.exit(1);
});
