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

  app.get("/api/health", (_req, res) => {
    res.json({ ok: true, timestamp: Date.now() });
  });

  app.use(
    "/api/trpc",
    createExpressMiddleware({
      router: appRouter,
      createContext,
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
