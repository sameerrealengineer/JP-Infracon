import AsyncStorage from "@react-native-async-storage/async-storage";
import * as Location from "expo-location";
import * as TaskManager from "expo-task-manager";
import { Platform } from "react-native";
import { createClientMutationId } from "@/lib/jp/local-repository";
import { createBackgroundClient } from "@/lib/trpc";

/**
 * Site arrival/departure alerts. Runs only after the person switches it on, uses the phone's
 * built-in geofencing (low battery), and reports just "arrived/left site X" to the server.
 */
export const GEOFENCE_TASK = "jp-infracon-site-geofence";
const ENABLED_KEY = "jp-infracon.site-alerts.enabled";

if (Platform.OS !== "web" && !TaskManager.isTaskDefined(GEOFENCE_TASK)) {
  TaskManager.defineTask<{
    eventType: Location.GeofencingEventType;
    region: Location.LocationRegion;
  }>(GEOFENCE_TASK, async ({ data, error }) => {
    if (error || !data?.region?.identifier) return;
    const position = await Location.getLastKnownPositionAsync().catch(() => null);
    try {
      await createBackgroundClient().jp.presence.record.mutate({
        siteId: data.region.identifier,
        eventType: data.eventType === Location.GeofencingEventType.Enter ? "Arrived" : "Left",
        latitude: position?.coords.latitude,
        longitude: position?.coords.longitude,
        accuracyM: position?.coords.accuracy ?? undefined,
        occurredAt: new Date(),
        clientMutationId: createClientMutationId(),
      });
    } catch {
      // Offline or signed out: the event is skipped rather than guessed later.
    }
  });
}

export type Fence = { siteId: string; latitude: number; longitude: number; radiusM: number };

export async function siteAlertsEnabled(): Promise<boolean> {
  if (Platform.OS === "web") return false;
  try {
    return (
      (await AsyncStorage.getItem(ENABLED_KEY)) === "yes" &&
      (await Location.hasStartedGeofencingAsync(GEOFENCE_TASK))
    );
  } catch {
    return false;
  }
}

export async function startSiteAlerts(fences: Fence[]): Promise<void> {
  if (Platform.OS === "web") throw new Error("Site alerts work in the Android app only.");
  if (!fences.length)
    throw new Error(
      "None of your sites has a boundary yet. Ask an admin to set it on the site page.",
    );
  const foreground = await Location.requestForegroundPermissionsAsync();
  if (!foreground.granted) throw new Error("Location permission was not given.");
  const background = await Location.requestBackgroundPermissionsAsync();
  if (!background.granted)
    throw new Error(
      'Choose "Allow all the time" for location so arrivals are detected when the app is closed.',
    );
  await Location.startGeofencingAsync(
    GEOFENCE_TASK,
    fences.slice(0, 20).map((fence) => ({
      identifier: fence.siteId,
      latitude: fence.latitude,
      longitude: fence.longitude,
      radius: fence.radiusM,
      notifyOnEnter: true,
      notifyOnExit: true,
    })),
  );
  await AsyncStorage.setItem(ENABLED_KEY, "yes");
  await createBackgroundClient()
    .jp.presence.reportTracking.mutate({
      enabled: true,
      fenceCount: Math.min(fences.length, 20),
      platform: Platform.OS,
    })
    .catch(() => null);
}

export async function stopSiteAlerts(): Promise<void> {
  if (Platform.OS === "web") return;
  if (await Location.hasStartedGeofencingAsync(GEOFENCE_TASK).catch(() => false))
    await Location.stopGeofencingAsync(GEOFENCE_TASK);
  await AsyncStorage.setItem(ENABLED_KEY, "no");
  await createBackgroundClient()
    .jp.presence.reportTracking.mutate({ enabled: false, fenceCount: 0, platform: Platform.OS })
    .catch(() => null);
}

/** Current position for GPS-tagged photos; null when permission is refused or no fix. */
export async function currentPosition(): Promise<{
  latitude: number;
  longitude: number;
  accuracyM?: number;
} | null> {
  try {
    const permission = await Location.requestForegroundPermissionsAsync();
    if (!permission.granted) return null;
    const position = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High });
    return {
      latitude: position.coords.latitude,
      longitude: position.coords.longitude,
      accuracyM: position.coords.accuracy ?? undefined,
    };
  } catch {
    return null;
  }
}
