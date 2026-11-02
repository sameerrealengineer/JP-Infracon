import { parse as parseCookieHeader } from "cookie";
import type { CookieOptions, Request } from "express";
import { SESSION_COOKIE_SUFFIX } from "../../shared/const.js";

function isSecureRequest(req: Request) {
  if (req.protocol === "https") return true;
  const forwardedProto = req.headers["x-forwarded-proto"];
  if (!forwardedProto) return false;
  const protoList = Array.isArray(forwardedProto) ? forwardedProto : forwardedProto.split(",");
  return protoList.some((proto) => proto.trim().toLowerCase() === "https");
}

export function getSessionCookieOptions(
  req: Request,
): Pick<CookieOptions, "httpOnly" | "path" | "sameSite" | "secure"> {
  const secure = isSecureRequest(req);
  return {
    httpOnly: true,
    path: "/",
    sameSite: secure ? "none" : "lax",
    secure,
  };
}

export function getSessionCookieName(req: Request): string {
  return isSecureRequest(req)
    ? `__Host-jp_session_${SESSION_COOKIE_SUFFIX}`
    : `jp_local_session_${SESSION_COOKIE_SUFFIX}`;
}

export function currentSessionCookie(req: Request): string | undefined {
  if (!req.headers.cookie) return undefined;
  return parseCookieHeader(req.headers.cookie)[getSessionCookieName(req)];
}
