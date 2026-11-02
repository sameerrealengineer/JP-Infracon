import { createDemoDb, ensureSchema, type DemoDb, type SqlDriver } from "./sql/engine";
import { openDemoDriver } from "./sql/driver";

let current: Promise<DemoDb> | null = null;

/** Points the demo backend at a SQLite connection (tests pass an in-memory one). */
export function setDemoDriver(driver: SqlDriver): Promise<DemoDb> {
  current = (async () => {
    await ensureSchema(driver);
    return createDemoDb(driver);
  })();
  return current;
}

/** The demo database; opens the phone's SQLite file on first use. */
export function getDemoDb(): Promise<DemoDb> {
  if (!current) {
    current = openDemoDriver().then(setDemoDriver);
    current.catch(() => {
      current = null;
    });
  }
  return current;
}
