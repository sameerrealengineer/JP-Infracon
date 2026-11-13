/**
 * Which phone/browser permissions the app asks for up front (right after sign-in), so camera,
 * microphone, location, files and alerts already work the first time a form needs them.
 */
export type PermissionKey =
  | "notifications"
  | "microphone"
  | "camera"
  | "photos"
  | "location"
  | "backgroundLocation";

/**
 * granted: allowed. ask: not decided yet, or refused once and can be asked again.
 * blocked: refused for good; only the phone/browser settings can turn it on.
 * unavailable: this device or browser has no such feature.
 * needsHomeScreen: iPhone web only; alerts work once the app is opened from the home screen.
 */
export type PermissionStatus = "granted" | "ask" | "blocked" | "unavailable" | "needsHomeScreen";

export type AppPlatform = "android" | "ios" | "web";

/** Stored on the device once the person has been through the permission screen. */
export const PERMISSIONS_ASKED_KEY = "jp-infracon.permissions-asked.v1";

export const PERMISSION_TEXT: Record<PermissionKey, { title: string; why: string }> = {
  notifications: {
    title: "Notifications",
    why: "Approvals, issues, payments and site alerts reach you at once.",
  },
  microphone: {
    title: "Microphone",
    why: "Speak to fill forms, voice notes and live talk with the assistant.",
  },
  camera: {
    title: "Camera",
    why: "Site photos, bill scans and evidence for reports and issues.",
  },
  photos: {
    title: "Photos and files",
    why: "Attach photos, PDFs and documents from the phone.",
  },
  location: {
    title: "Location",
    why: "GPS on site photos and attendance at the right site.",
  },
  backgroundLocation: {
    title: 'Location "Allow all the time"',
    why: "Site arrival and leaving alerts when the app is closed. Choose “Allow all the time”.",
  },
};

/**
 * The permissions to show, in the order they are asked. On web, notifications go first because
 * browsers allow that prompt only straight after a tap; files need no permission in a browser,
 * and background location does not exist there.
 */
export function permissionList(platform: AppPlatform): PermissionKey[] {
  if (platform === "web") return ["notifications", "microphone", "camera", "location"];
  if (platform === "ios") return ["notifications", "microphone", "camera", "photos", "location"];
  // Android asks "all the time" location only after normal location is allowed.
  return ["notifications", "microphone", "camera", "photos", "location", "backgroundLocation"];
}

/** Permissions that a tap on "Allow all" can still ask for. */
export function stillToAsk(
  list: PermissionKey[],
  statuses: Partial<Record<PermissionKey, PermissionStatus>>,
): PermissionKey[] {
  return list.filter((key) => (statuses[key] ?? "ask") === "ask");
}

/** Permissions the person has to turn on in settings themselves. */
export function blockedPermissions(
  list: PermissionKey[],
  statuses: Partial<Record<PermissionKey, PermissionStatus>>,
): PermissionKey[] {
  return list.filter((key) => statuses[key] === "blocked");
}

/**
 * Maps a native permission answer to a status. A refusal that the system will not show again
 * (canAskAgain false) is blocked: only the app settings can change it.
 */
export function nativeStatus(response: {
  granted: boolean;
  status?: string;
  canAskAgain?: boolean;
}): PermissionStatus {
  if (response.granted) return "granted";
  if (response.canAskAgain === false) return "blocked";
  return "ask";
}

/** Maps the browser Permissions API state ("granted" | "denied" | "prompt") to a status. */
export function browserStatus(state: string | undefined): PermissionStatus {
  if (state === "granted") return "granted";
  if (state === "denied") return "blocked";
  return "ask";
}
