import { createContext } from "../../server/_core/context";

/** A request context like the API builds from an HTTP request, for a session token. */
export async function buildDemoContext(token: string | null | undefined, platform = "android") {
  const req = {
    headers: {
      "x-jp-client-platform": platform,
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    ip: "127.0.0.1",
    socket: { remoteAddress: "127.0.0.1" },
    protocol: "https",
    get: () => undefined,
  };
  const res = { cookie: () => res, clearCookie: () => res };
  return createContext({ req, res, info: {} } as unknown as Parameters<typeof createContext>[0]);
}
