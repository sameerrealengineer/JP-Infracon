import type { QueryClient } from "@tanstack/react-query";
import { UNAUTHED_ERR_MSG } from "@shared/const";

/** The cache key tRPC uses for `auth.me` (the account check behind the sign-in gate). */
export const AUTH_ME_KEY = [["auth", "me"], { type: "query" }] as const;

/** True when the server refused a request because nobody is signed in (session ended or revoked). */
export function isSignedOutError(error: unknown): boolean {
  return error instanceof Error && error.message === UNAUTHED_ERR_MSG;
}

/**
 * Mark the phone as signed out, so the sign-in gate shows the sign-in screen at once instead of
 * screens whose every request now fails with "Please login".
 */
export function markSignedOut(queryClient: QueryClient) {
  queryClient.setQueryData(AUTH_ME_KEY, null);
}
