/**
 * One-time start data for the client, run inside the API container after the Super Admin exists:
 *   SEED_SUPER_ADMIN=<username> node seed-client-data.mjs
 * Puts in the client's real site, people and suppliers plus SAMPLE records for every module
 * (server/seed/client-data.ts) through the real procedures. Stops if the site is already there.
 * Temporary passwords of the new logins go to SEED_LOGINS_FILE (mode 600), never to the log.
 */
import { writeFileSync } from "node:fs";
import { eq } from "drizzle-orm";
import { sites } from "../drizzle/schema";
import { getDb } from "../server/db";
import { SEED_SITE_CODE, seedClientData } from "../server/seed/client-data";
import { callerForUserId, userIdByUsername } from "../server/seed/caller";

async function main() {
  const username = process.env.SEED_SUPER_ADMIN?.trim();
  const loginsFile = process.env.SEED_LOGINS_FILE ?? "/tmp/jp-seed-logins.txt";
  if (!username) throw new Error("Set SEED_SUPER_ADMIN to the Super Admin's username.");
  const db = await getDb();
  if (!db) throw new Error("The database is not available.");
  const [existing] = await db
    .select({ id: sites.id })
    .from(sites)
    .where(eq(sites.siteCode, SEED_SITE_CODE))
    .limit(1);
  if (existing) {
    console.log(`Site ${SEED_SITE_CODE} already exists. Nothing was added.`);
    return;
  }
  const userId = await userIdByUsername(username);
  if (!userId) throw new Error(`No account with username "${username}".`);
  const boss = await callerForUserId(userId);
  const me = await boss.auth.me();
  if (me?.platformRole !== "super_admin") throw new Error(`"${username}" is not the Super Admin.`);
  const result = await seedClientData({ boss, callerFor: callerForUserId });
  writeFileSync(
    loginsFile,
    [
      "JP Infracon: new logins (give each person their own; they must change it at first sign-in)",
      ...result.logins.map(
        (login) =>
          `${login.name} (${login.role}): username ${login.username}  temporary password ${login.temporaryPassword}`,
      ),
      "",
    ].join("\n"),
    { mode: 0o600 },
  );
  console.log(`Done. Site ${SEED_SITE_CODE} with people, suppliers and SAMPLE records.`);
  console.log(
    `New logins: ${result.logins.map((login) => login.username).join(", ")} (passwords in the logins file).`,
  );
}

main().then(
  () => process.exit(0),
  (error) => {
    console.error(`Seed stopped: ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  },
);
