/**
 * The offline demo backend: the real `appRouter` from `server/`, answered inside the app.
 * `metro.config.js` swaps the server's database, session, storage and crypto modules for the
 * phone versions in `lib/demo/`, so every rule (permissions, maker-checker, ledgers, audit) is
 * the same code the API runs.
 */
import "./polyfills";
import { unstable_localLink } from "@trpc/client";
import superjson from "superjson";
import { appRouter, type AppRouter } from "../../server/routers";
import { buildDemoContext } from "./context";
import { getDemoDb } from "./runtime";
import { seedDemoData } from "./seed";

let ready: Promise<void> | null = null;

/** Opens the demo database and fills it with sample data the first time. */
export function ensureDemoData(): Promise<void> {
  if (!ready) {
    ready = (async () => {
      const db = await getDemoDb();
      await seedDemoData(db);
    })();
    ready.catch(() => {
      ready = null;
    });
  }
  return ready;
}

export type TokenSource = () => Promise<string | null | undefined>;

/** Context for each in-app call, after the demo data is ready. */
export function createDemoContext(getToken: TokenSource, platform: string) {
  return async () => {
    await ensureDemoData();
    return buildDemoContext(await getToken(), platform);
  };
}

export function createDemoLink(getToken: TokenSource, platform: string) {
  return unstable_localLink<AppRouter>({
    router: appRouter,
    createContext: createDemoContext(getToken, platform),
    transformer: superjson,
  });
}

/** Direct server calls as a given session, for seeding and tests. */
export async function demoCaller(getToken: TokenSource, platform = "android") {
  return appRouter.createCaller(await createDemoContext(getToken, platform)());
}
