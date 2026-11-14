import AsyncStorage from "@react-native-async-storage/async-storage";
import type { QueryClient } from "@tanstack/react-query";
import { markSignedOut } from "@/lib/jp/session-expiry";

/** Where the React Query cache is saved on the phone or in the browser (see app/_layout.tsx). */
export const QUERY_CACHE_KEY = "jp-infracon.query-cache.v1";

/**
 * Forget everything of the person who was signed in: the in-memory cache, the copy saved on
 * the device, and the account check, so the sign-in screen shows at once and the next person
 * never sees the previous person's records.
 */
export async function forgetSignedInData(queryClient: QueryClient) {
  await queryClient.cancelQueries();
  queryClient.clear();
  markSignedOut(queryClient);
  try {
    await AsyncStorage.removeItem(QUERY_CACHE_KEY);
  } catch {
    // Nothing saved, or storage unavailable: the in-memory cache is already empty.
  }
}
