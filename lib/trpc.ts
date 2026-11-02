import { createTRPCReact } from "@trpc/react-query";
import { createTRPCClient as createVanillaTRPCClient, httpBatchLink } from "@trpc/client";
import superjson from "superjson";
import { Platform } from "react-native";
import type { AppRouter } from "@/server/routers";
import { getApiBaseUrl } from "@/constants/api";
import * as Auth from "@/lib/_core/auth";

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
  return trpc.createClient({
    links: [
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
  return createVanillaTRPCClient<AppRouter>({
    links: [
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
