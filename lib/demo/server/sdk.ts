/**
 * Offline demo stand in for `server/_core/sdk.ts`. Sessions are plain tokens checked against
 * the `authSessions` table on the phone (no JWT library, no identity service).
 */
import { and, eq, gt, isNull } from "drizzle-orm";
import { authSessions, userCredentials, type User } from "../../../drizzle/schema";
import { getDb, getUserByOpenId, upsertUser } from "./db";

export type SessionPayload = { openId: string; appId: string; name: string; sessionId?: string };

export type AuthenticatedUser = User & {
  taskUid?: string;
  isCron?: boolean;
  mustChangePassword?: boolean;
};

type DemoRequest = { headers: Record<string, string | string[] | undefined> };

const PREFIX = "jpdemo.";

function forbidden(message: string) {
  const error = new Error(message);
  error.name = "ForbiddenError";
  return error;
}

class DemoSdk {
  async createSessionToken(
    openId: string,
    options: { expiresInMs?: number; name?: string; sessionId?: string } = {},
  ): Promise<string> {
    return this.signSession({
      openId,
      appId: "jp-demo",
      name: options.name || "",
      sessionId: options.sessionId,
    });
  }

  async signSession(payload: SessionPayload): Promise<string> {
    return PREFIX + encodeURIComponent(JSON.stringify(payload));
  }

  async verifySession(token: string | undefined | null) {
    if (!token?.startsWith(PREFIX)) return null;
    try {
      const payload = JSON.parse(decodeURIComponent(token.slice(PREFIX.length))) as SessionPayload;
      if (!payload.openId) return null;
      return { ...payload, name: payload.name || payload.openId };
    } catch {
      return null;
    }
  }

  async authenticateRequest(req: DemoRequest): Promise<AuthenticatedUser> {
    const header = req.headers.authorization ?? req.headers.Authorization;
    const token =
      typeof header === "string" && header.startsWith("Bearer ")
        ? header.slice(7).trim()
        : undefined;
    const session = await this.verifySession(token);
    if (!session?.sessionId) throw forbidden("Invalid or expired application session");
    const user = await getUserByOpenId(session.openId);
    if (!user) throw forbidden("User not found");
    const db = await getDb();
    const [active] = await db
      .select({ id: authSessions.id })
      .from(authSessions)
      .where(
        and(
          eq(authSessions.id, session.sessionId),
          eq(authSessions.userId, user.id),
          isNull(authSessions.revokedAt),
          gt(authSessions.expiresAt, new Date()),
        ),
      )
      .limit(1);
    if (!active || user.accountStatus !== "Active")
      throw forbidden("Invalid or expired application session");
    const [credential] = await db
      .select({ mustChangePassword: userCredentials.mustChangePassword })
      .from(userCredentials)
      .where(eq(userCredentials.userId, user.id))
      .limit(1);
    if (!credential) throw forbidden("Invalid or expired application session");
    await upsertUser({ openId: user.openId, lastSignedIn: new Date() });
    return { ...user, mustChangePassword: credential.mustChangePassword === 1 };
  }
}

export const sdk = new DemoSdk();
