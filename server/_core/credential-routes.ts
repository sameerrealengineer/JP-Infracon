import type { Express, Request, Response } from "express";
import { currentSessionCookie, getSessionCookieName, getSessionCookieOptions } from "./cookies";
import { revokeSession } from "./credential-auth";
import { sdk } from "./sdk";

export function registerCredentialRoutes(app: Express) {
  app.post("/api/auth/logout", async (req: Request, res: Response) => {
    const authHeader = req.headers.authorization || req.headers.Authorization;
    const token =
      typeof authHeader === "string" && authHeader.startsWith("Bearer ")
        ? authHeader.slice("Bearer ".length).trim()
        : currentSessionCookie(req);
    if (token) {
      const session = await sdk.verifySession(token);
      if (session?.sessionId) await revokeSession(session.sessionId);
    }
    res.clearCookie(getSessionCookieName(req), {
      ...getSessionCookieOptions(req),
      maxAge: -1,
    });
    res.json({ success: true });
  });
}
