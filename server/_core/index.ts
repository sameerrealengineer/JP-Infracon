import "dotenv/config";
import express from "express";
import { createServer } from "http";
import { createExpressMiddleware } from "@trpc/server/adapters/express";
import { registerCredentialRoutes } from "./credential-routes";
import { registerStorageProxy } from "./storageProxy";
import { registerFileRoute } from "../s3-storage";
import { appRouter } from "../routers";
import { createContext } from "./context";
import { createCorsMiddleware } from "./cors";
import { runMigrations } from "./migrate";
import { registerWhatsAppBot } from "../jp/whatsapp-bot";
import { sql } from "drizzle-orm";
import { getDb } from "../db";

/** "ok" when a trivial query answers within 4 seconds, otherwise "down". */
async function databaseAnswers(): Promise<"ok" | "down"> {
  try {
    const db = await getDb();
    if (!db) return "down";
    await Promise.race([
      db.execute(sql`select 1`),
      new Promise((_, reject) => setTimeout(() => reject(new Error("timeout")), 4000)),
    ]);
    return "ok";
  } catch {
    return "down";
  }
}

async function startServer() {
  const app = express();
  const server = createServer(app);

  app.use(createCorsMiddleware());

  // Before the JSON parser: the bot checks its signature over the raw body.
  registerWhatsAppBot(app);

  app.use(express.json({ limit: "50mb" }));
  app.use(express.urlencoded({ limit: "50mb", extended: true }));

  registerStorageProxy(app);
  registerFileRoute(app);
  registerCredentialRoutes(app);

  // Healthy only when the database answers too, so Docker and the watchdog see a real outage.
  app.get("/api/health", async (_req, res) => {
    const database = process.env.DATABASE_URL ? await databaseAnswers() : "not configured";
    const ok = database !== "down";
    res.status(ok ? 200 : 503).json({ ok, database, timestamp: Date.now() });
  });

  app.use(
    "/api/trpc",
    createExpressMiddleware({
      router: appRouter,
      createContext,
      // Log why a request failed (procedure and reason only, never its input), so a feature
      // that "does not work" on a phone leaves a trace on the server.
      onError({ path, error }) {
        if (
          ["UNAUTHORIZED", "FORBIDDEN", "NOT_FOUND", "BAD_REQUEST", "CONFLICT"].includes(error.code)
        )
          return;
        console.error(`[api] ${path ?? "?"} ${error.code}: ${error.message.slice(0, 300)}`);
      },
    }),
  );

  if (process.env.RUN_MIGRATIONS === "true") await runMigrations();
  const port = parseInt(process.env.PORT || "3000");
  server.listen(port, () => {
    console.log("[api] server listening");
  });
}

startServer().catch((error) => {
  console.error(
    "[api] server failed to start",
    error instanceof Error
      ? `${error.message} ${String((error as { cause?: unknown }).cause ?? "")}`
      : "",
  );
  process.exit(1);
});
