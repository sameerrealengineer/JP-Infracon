import type { SqlDriver } from "./engine";

/** The offline demo stores its data in SQLite on the phone; it is not available in a browser. */
export async function openDemoDriver(): Promise<SqlDriver> {
  throw new Error("The offline demo runs on Android. Install the demo APK to try it.");
}
