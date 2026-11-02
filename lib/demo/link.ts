import type { TRPCLink } from "@trpc/client";
import type { AppRouter } from "@/server/routers";

/**
 * Normal builds: the offline demo backend is not bundled. With EXPO_PUBLIC_JP_DEMO=1,
 * `metro.config.js` replaces this file with `lib/demo/backend.ts`.
 */
export function createDemoLink(
  _getToken: () => Promise<string | null | undefined>,
  _platform: string,
): TRPCLink<AppRouter> {
  throw new Error("This build talks to the JP Infracon server; the offline demo is not included.");
}
