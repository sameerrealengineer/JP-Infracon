import { useSyncExternalStore } from "react";
import { useColorScheme as useRNColorScheme } from "react-native";

const subscribeNever = () => () => {};

/**
 * To support static rendering, this value needs to be re-calculated on the client side for web.
 * The server snapshot is "not hydrated", so the first client render matches the static HTML.
 */
export function useColorScheme() {
  const hasHydrated = useSyncExternalStore(
    subscribeNever,
    () => true,
    () => false,
  );

  const colorScheme = useRNColorScheme();

  if (hasHydrated) {
    return colorScheme;
  }

  return "light";
}
