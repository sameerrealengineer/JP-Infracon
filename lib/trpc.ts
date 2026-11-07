import { createTRPCReact } from "@trpc/react-query";
import {
  createTRPCClient as createVanillaTRPCClient,
  httpBatchLink,
  type TRPCLink,
} from "@trpc/client";
import { observable } from "@trpc/server/observable";
import superjson from "superjson";
import { Platform } from "react-native";
import type { AppRouter } from "@/server/routers";
import { getApiBaseUrl } from "@/constants/api";
import * as Auth from "@/lib/_core/auth";
import { DEMO_MODE } from "@/lib/demo/config";
import { createDemoLink } from "@/lib/demo/link";
import { transportError } from "@/lib/jp/app-reports";
import { translateNow } from "@/lib/i18n";

/**
 * When the server could not answer properly (no internet, server restarting, a web page in
 * place of data), every screen shows one plain message in the person's language instead of a
 * technical one. Normal server answers keep their own message.
 */
export const friendlyErrorLink: TRPCLink<AppRouter> =
  () =>
  ({ next, op }) =>
    observable((observer) =>
      next(op).subscribe({
        next: (value) => observer.next(value),
        complete: () => observer.complete(),
        error: (error) => {
          if (!error.data) {
            const response = (error.meta as { response?: { status?: number } } | undefined)
              ?.response;
            const found = transportError({ message: error.message, status: response?.status });
            if (found)
              try {
                error.message = translateNow(found.text, found.vars);
              } catch {
                // Keep the original message.
              }
          }
          observer.error(error);
        },
      }),
    );

/**
 * tRPC React client for type-safe API calls.
 *
 * IMPORTANT (tRPC v11): The `transformer` must be inside `httpBatchLink`,
 * NOT at the root createClient level. This ensures client and server
 * use the same serialization format (superjson).
 */
export const trpc = createTRPCReact<AppRouter>();

/**
 * Creates the tRPC client with proper configuration.
 * Call this once in your app's root layout.
 */
export function createTRPCClient() {
  // Offline demo: calls are answered on the phone (see lib/demo/backend.ts).
  if (DEMO_MODE)
    return trpc.createClient({ links: [createDemoLink(Auth.getSessionToken, Platform.OS)] });
  return trpc.createClient({
    links: [
      friendlyErrorLink,
      httpBatchLink({
        url: `${getApiBaseUrl()}/api/trpc`,
        // tRPC v11: transformer MUST be inside httpBatchLink, not at root
        transformer: superjson,
        async headers() {
          const token = await Auth.getSessionToken();
          return {
            "x-jp-client-platform": Platform.OS,
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
          };
        },
        // Custom fetch: resolves the server address per request (it can be changed at sign-in)
        // and includes credentials for cookie-based auth.
        fetch(url, options) {
          return fetch(resolveTrpcUrl(url), {
            ...options,
            credentials: "include",
          });
        },
      }),
    ],
  });
}

/** Plain (non-React) client for background tasks such as geofence events. */
export function createBackgroundClient() {
  if (DEMO_MODE)
    return createVanillaTRPCClient<AppRouter>({
      links: [createDemoLink(Auth.getSessionToken, Platform.OS)],
    });
  return createVanillaTRPCClient<AppRouter>({
    links: [
      friendlyErrorLink,
      httpBatchLink({
        url: `${getApiBaseUrl()}/api/trpc`,
        transformer: superjson,
        async headers() {
          const token = await Auth.getSessionToken();
          return {
            "x-jp-client-platform": Platform.OS,
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
          };
        },
        fetch(url, options) {
          return fetch(resolveTrpcUrl(url), options);
        },
      }),
    ],
  });
}

function resolveTrpcUrl(url: string | URL | Request): string {
  const text = typeof url === "string" ? url : url instanceof URL ? url.href : url.url;
  const index = text.indexOf("/api/trpc");
  return index === -1 ? text : `${getApiBaseUrl()}${text.slice(index)}`;
}
