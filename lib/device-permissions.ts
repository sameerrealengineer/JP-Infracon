import { getRecordingPermissionsAsync, requestRecordingPermissionsAsync } from "expo-audio";
import * as ImagePicker from "expo-image-picker";
import * as Linking from "expo-linking";
import * as Location from "expo-location";
import * as Notifications from "expo-notifications";
import { Platform } from "react-native";
import {
  browserStatus,
  nativeStatus,
  type AppPlatform,
  type PermissionKey,
  type PermissionStatus,
} from "@/lib/jp/permission-plan";

/**
 * Reads and asks the phone (Android) or the browser (web app) for each permission the app needs.
 * The rules for which ones and in what order live in lib/jp/permission-plan.ts.
 */
export function appPlatform(): AppPlatform {
  return Platform.OS === "android" ? "android" : Platform.OS === "ios" ? "ios" : "web";
}

/**
 * Browser notification permission, read without waiting: Safari allows the prompt only while the
 * tap is still fresh, so nothing may be awaited before it. Being subscribed for push is a
 * separate step (Alerts settings); the permission itself is what this screen asks for.
 */
function webNotificationStatus(): PermissionStatus {
  if (typeof window === "undefined") return "unavailable";
  const ios = /iPhone|iPad|iPod/.test(navigator.userAgent);
  const standalone =
    window.matchMedia?.("(display-mode: standalone)").matches ||
    (navigator as unknown as { standalone?: boolean }).standalone === true;
  if (ios && !standalone) return "needsHomeScreen";
  if (!("Notification" in window)) return "unavailable";
  if (Notification.permission === "granted") return "granted";
  if (Notification.permission === "denied") return "blocked";
  return "ask";
}

async function askWebNotifications(subscribe?: () => Promise<void>): Promise<PermissionStatus> {
  const before = webNotificationStatus();
  if (before !== "ask" && before !== "granted") return before;
  try {
    // Asks (subscribeWebPush calls Notification.requestPermission first) and saves the push
    // address on the server when the server has push keys.
    if (subscribe) await subscribe();
    else if (before === "ask") await Notification.requestPermission();
  } catch {
    // No push address (for example no push service in this browser): the permission still counts.
  }
  return webNotificationStatus();
}

async function browserQuery(name: string): Promise<PermissionStatus | null> {
  try {
    const result = await navigator.permissions?.query({ name: name as PermissionName });
    return result ? browserStatus(result.state) : null;
  } catch {
    // Safari and Firefox do not answer for every name; the prompt still works.
    return null;
  }
}

function hasMedia() {
  return typeof navigator !== "undefined" && Boolean(navigator.mediaDevices?.getUserMedia);
}

async function webMedia(kind: "audio" | "video"): Promise<PermissionStatus> {
  if (!hasMedia()) return "unavailable";
  try {
    const stream = await navigator.mediaDevices.getUserMedia(
      kind === "audio" ? { audio: true } : { video: true },
    );
    stream.getTracks().forEach((track) => track.stop());
    return "granted";
  } catch (cause) {
    const name = (cause as { name?: string })?.name;
    if (name === "NotFoundError" || name === "OverconstrainedError") return "unavailable";
    return "blocked";
  }
}

function webLocation(): Promise<PermissionStatus> {
  if (typeof navigator === "undefined" || !navigator.geolocation)
    return Promise.resolve("unavailable");
  return new Promise((resolve) =>
    navigator.geolocation.getCurrentPosition(
      () => resolve("granted"),
      // 1 = refused; 2/3 = allowed but no fix right now.
      (error) => resolve(error.code === 1 ? "blocked" : "granted"),
      { timeout: 15000, maximumAge: 60000 },
    ),
  );
}

type Listener = (key: PermissionKey, status: PermissionStatus) => void;
const listeners = new Set<Listener>();

/** Called after every request, so push registration can start once notifications are allowed. */
export function onPermissionChange(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Current status without asking. */
export async function checkPermission(key: PermissionKey): Promise<PermissionStatus> {
  try {
    if (Platform.OS === "web") {
      if (key === "notifications") return webNotificationStatus();
      if (key === "microphone")
        return hasMedia() ? ((await browserQuery("microphone")) ?? "ask") : "unavailable";
      if (key === "camera")
        return hasMedia() ? ((await browserQuery("camera")) ?? "ask") : "unavailable";
      if (key === "location")
        return navigator.geolocation
          ? ((await browserQuery("geolocation")) ?? "ask")
          : "unavailable";
      return "unavailable";
    }
    if (key === "notifications") return nativeStatus(await Notifications.getPermissionsAsync());
    if (key === "microphone") return nativeStatus(await getRecordingPermissionsAsync());
    if (key === "camera") return nativeStatus(await ImagePicker.getCameraPermissionsAsync());
    if (key === "photos") return nativeStatus(await ImagePicker.getMediaLibraryPermissionsAsync());
    if (key === "location") return nativeStatus(await Location.getForegroundPermissionsAsync());
    return nativeStatus(await Location.getBackgroundPermissionsAsync());
  } catch {
    return "ask";
  }
}

/**
 * Asks for one permission. On web, notifications need `subscribeWebNotifications` (it saves the
 * browser's push address on the server) and must be the first thing run after the tap.
 */
export async function requestPermission(
  key: PermissionKey,
  options: { subscribeWebNotifications?: () => Promise<void> } = {},
): Promise<PermissionStatus> {
  const status = await askPermission(key, options);
  listeners.forEach((listener) => listener(key, status));
  return status;
}

async function askPermission(
  key: PermissionKey,
  options: { subscribeWebNotifications?: () => Promise<void> },
): Promise<PermissionStatus> {
  try {
    if (Platform.OS === "web") {
      if (key === "notifications")
        return await askWebNotifications(options.subscribeWebNotifications);
      if (key === "microphone") return await webMedia("audio");
      if (key === "camera") return await webMedia("video");
      if (key === "location") return await webLocation();
      return "unavailable";
    }
    if (key === "notifications") {
      // Android 13+ shows the prompt only once a channel exists.
      if (Platform.OS === "android")
        await Notifications.setNotificationChannelAsync("alerts", {
          name: "Site alerts",
          importance: Notifications.AndroidImportance.MAX,
          vibrationPattern: [0, 250, 150, 250],
          lightColor: "#D9B76A",
        });
      return nativeStatus(await Notifications.requestPermissionsAsync());
    }
    if (key === "microphone") return nativeStatus(await requestRecordingPermissionsAsync());
    if (key === "camera") return nativeStatus(await ImagePicker.requestCameraPermissionsAsync());
    if (key === "photos")
      return nativeStatus(await ImagePicker.requestMediaLibraryPermissionsAsync());
    if (key === "location") return nativeStatus(await Location.requestForegroundPermissionsAsync());
    // "All the time" can only be asked once normal location is allowed.
    const foreground = await Location.getForegroundPermissionsAsync();
    if (!foreground.granted) return "ask";
    return nativeStatus(await Location.requestBackgroundPermissionsAsync());
  } catch {
    return Platform.OS === "web" ? "blocked" : "ask";
  }
}

/** Opens this app's page in the phone settings (Android/iPhone app). */
export async function openAppSettings(): Promise<boolean> {
  if (Platform.OS === "web") return false;
  try {
    await Linking.openSettings();
    return true;
  } catch {
    return false;
  }
}
