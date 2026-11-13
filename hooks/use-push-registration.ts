import Constants from "expo-constants";
import * as Notifications from "expo-notifications";
import { useRouter } from "expo-router";
import { useEffect, useState } from "react";
import { Platform } from "react-native";
import { onPermissionChange } from "@/lib/device-permissions";
import { siteAlertsEnabled } from "@/lib/geofence-task";
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
 * After sign-in (and whenever notifications are allowed on the permission screen) registers this phone's Expo push token
 * with the server. Tapping an alert opens the screen it points to. Does nothing on web.
 */
export function usePushRegistration(enabled: boolean) {
  const router = useRouter();
  const register = trpc.jp.notifications.registerDevice.useMutation();
  const reportTracking = trpc.jp.presence.reportTracking.useMutation();
  const fences = trpc.jp.presence.myFences.useQuery(undefined, {
    enabled: enabled && Platform.OS !== "web",
  });
  const fenceCount = fences.data?.length;
  const [allowedAt, setAllowedAt] = useState(0);

  // Tell the server whether this phone watches site boundaries, so leaders see who is not.
  useEffect(() => {
    if (!enabled || Platform.OS === "web" || fenceCount === undefined) return;
    void siteAlertsEnabled().then((on) =>
      reportTracking
        .mutateAsync({ enabled: on, fenceCount: on ? fenceCount : 0, platform: Platform.OS })
        .catch(() => null),
    );
    // Once per sign-in, after the site boundaries are known.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, fenceCount]);

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
        // The permission screen asks; here the token is only registered once it is allowed.
        const status = await Notifications.getPermissionsAsync();
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
    const stop = onPermissionChange((key, granted) => {
      if (key === "notifications" && granted === "granted") setAllowedAt(Date.now());
    });
    return () => {
      cancelled = true;
      stop();
    };
    // Register once per sign-in, and again when notifications are allowed.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, allowedAt]);

  useEffect(() => {
    if (Platform.OS === "web") return;
    const subscription = Notifications.addNotificationResponseReceivedListener((response) => {
      const route = response.notification.request.content.data?.route;
      if (typeof route === "string" && route.startsWith("/")) router.push(route as never);
    });
    return () => subscription.remove();
  }, [router]);
}
