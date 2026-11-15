import { eq } from "drizzle-orm";
import { userCredentials, users } from "../../drizzle/schema";
import { getDb } from "../db";
import { appRouter } from "../routers";
import type { SeedCaller } from "./client-data";

/**
 * Calls the API as a stored account, inside the server process (no password, no HTTP). Used only
 * by the one-time seed run on the server; it never runs from a request.
 */
export async function callerForUserId(userId: number): Promise<SeedCaller> {
  const db = await getDb();
  if (!db) throw new Error("The database is not available.");
  const [user] = await db.select().from(users).where(eq(users.id, userId)).limit(1);
  if (!user) throw new Error(`No account with id ${userId}.`);
  const req = {
    headers: { "x-jp-client-platform": "seed", "x-jp-inbox": "3" },
    ip: "127.0.0.1",
    socket: { remoteAddress: "127.0.0.1" },
    protocol: "https",
    get: () => undefined,
  };
  const res = { cookie: () => res, clearCookie: () => res };
  return appRouter.createCaller({
    req,
    res,
    user: { ...user, mustChangePassword: false },
  } as unknown as Parameters<typeof appRouter.createCaller>[0]);
}

/** The account id for a username, or null. */
export async function userIdByUsername(username: string): Promise<number | null> {
  const db = await getDb();
  if (!db) throw new Error("The database is not available.");
  const [row] = await db
    .select({ userId: userCredentials.userId })
    .from(userCredentials)
    .where(eq(userCredentials.username, username.trim().toLowerCase()))
    .limit(1);
  return row?.userId ?? null;
}
