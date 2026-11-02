import Constants from "expo-constants";
import * as Notifications from "expo-notifications";
import { useRouter } from "expo-router";
import { useEffect } from "react";
import { Platform } from "react-native";
import { trpc } from "@/lib/trpc";

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
  }),
});

/**
 * After sign-in, asks for notification permission once and registers this phone's Expo push token
 * with the server. Tapping an alert opens the screen it points to. Does nothing on web.
 */
export function usePushRegistration(enabled: boolean) {
  const router = useRouter();
  const register = trpc.jp.notifications.registerDevice.useMutation();

  useEffect(() => {
    if (!enabled || Platform.OS === "web") return;
    let cancelled = false;
    (async () => {
      try {
        if (Platform.OS === "android")
          await Notifications.setNotificationChannelAsync("alerts", {
            name: "Site alerts",
            importance: Notifications.AndroidImportance.MAX,
            vibrationPattern: [0, 250, 150, 250],
            lightColor: "#D9B76A",
          });
        const current = await Notifications.getPermissionsAsync();
        const status = current.granted ? current : await Notifications.requestPermissionsAsync();
        if (!status.granted || cancelled) return;
        const projectId =
          (Constants.expoConfig?.extra as { eas?: { projectId?: string } } | undefined)?.eas
            ?.projectId ?? Constants.easConfig?.projectId;
        if (!projectId) return; // Push needs an EAS project id (set when the APK is built with EAS).
        const token = await Notifications.getExpoPushTokenAsync({ projectId });
        if (!cancelled)
          await register.mutateAsync({
            token: token.data,
            platform: Platform.OS as "android" | "ios",
          });
      } catch {
        // Push is best effort; the in-app inbox still shows everything.
      }
    })();
    return () => {
      cancelled = true;
    };
    // Register once per sign-in.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled]);

  useEffect(() => {
    if (Platform.OS === "web") return;
    const subscription = Notifications.addNotificationResponseReceivedListener((response) => {
      const route = response.notification.request.content.data?.route;
      if (typeof route === "string" && route.startsWith("/")) router.push(route as never);
    });
    return () => subscription.remove();
  }, [router]);
}
