import { useLocalSearchParams } from "expo-router";

/**
 * The `siteId` a screen was opened with (for example from a site's page), or "".
 * Screens use it as the first choice, so a module opened from Site B shows Site B.
 */
export function useSiteParam(): string {
  const { siteId } = useLocalSearchParams<{ siteId?: string | string[] }>();
  return typeof siteId === "string" ? siteId : "";
}
