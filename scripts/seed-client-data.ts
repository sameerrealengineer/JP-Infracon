/**
 * One-time start data for the client, run inside the API container after the Super Admin exists:
 *   SEED_SUPER_ADMIN=<username> node seed-client-data.mjs
 * Puts in the client's real site, people and suppliers plus SAMPLE records for every module
 * (server/seed/client-data.ts) through the real procedures. Stops if the site is already there.
 * Temporary passwords of the new logins go to SEED_LOGINS_FILE (mode 600), never to the log.
 */
import { writeFileSync } from "node:fs";
import { runClientSeed } from "../server/seed/run";

async function main() {
  const username = process.env.SEED_SUPER_ADMIN?.trim();
  const loginsFile = process.env.SEED_LOGINS_FILE ?? "/tmp/jp-seed-logins.txt";
  if (!username) throw new Error("Set SEED_SUPER_ADMIN to the Super Admin's username.");
  const result = await runClientSeed(username);
  if (result.logins.length)
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
  for (const note of result.notes) console.log(note);
  if (!result.notes.length) console.log("Everything was already there. Nothing was added.");
}

main().then(
  () => process.exit(0),
  (error) => {
    console.error(`Seed stopped: ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  },
);
