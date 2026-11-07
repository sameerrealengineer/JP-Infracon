import AsyncStorage from "@react-native-async-storage/async-storage";
import Constants from "expo-constants";
import { Platform } from "react-native";
import { createBackgroundClient } from "@/lib/trpc";

/**
 * Sends app errors to the server so an admin sees them under "App problems". Never throws and
 * never blocks the app. Without a connection the report waits on the phone (a few at most) and
 * goes with the next one.
 */

const QUEUE_KEY = "jp-infracon.error-queue.v1";
const MAX_QUEUED = 15;

type Pending = {
  message: string;
  stack: string | null;
  screen: string | null;
  appVersion: string | null;
  platform: string;
};

let client: ReturnType<typeof createBackgroundClient> | null = null;
let currentScreen: string | null = null;
let sending = false;

/** The screen shown now, so a report says where it happened. */
export function setErrorScreen(path: string | null) {
  currentScreen = path ? path.slice(0, 160) : null;
}

function appVersion() {
  const version = Constants.expoConfig?.version ?? null;
  const build =
    Constants.expoConfig?.android?.versionCode ?? Constants.expoConfig?.ios?.buildNumber ?? null;
  return version ? `${version}${build ? ` (${build})` : ""}` : null;
}

async function readQueue(): Promise<Pending[]> {
  try {
    const raw = await AsyncStorage.getItem(QUEUE_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? (parsed as Pending[]) : [];
  } catch {
    return [];
  }
}

async function writeQueue(items: Pending[]) {
  try {
    if (items.length)
      await AsyncStorage.setItem(QUEUE_KEY, JSON.stringify(items.slice(-MAX_QUEUED)));
    else await AsyncStorage.removeItem(QUEUE_KEY);
  } catch {
    // Storage full or unavailable: the report is dropped, the app goes on.
  }
}

async function send(item: Pending) {
  client ??= createBackgroundClient();
  await client.jp.feedback.appError.mutate(item);
}

/** Sends this error (and any waiting ones). Safe to call from anywhere. */
export function reportAppError(error: unknown, screen?: string | null) {
  const err = error instanceof Error ? error : new Error(String(error));
  const item: Pending = {
    message: (err.message || err.name || "Unknown error").slice(0, 1000),
    stack: err.stack ? err.stack.slice(0, 20_000) : null,
    screen: screen ?? currentScreen,
    appVersion: appVersion(),
    platform: Platform.OS,
  };
  void (async () => {
    const queue = [...(await readQueue()), item];
    if (sending) return writeQueue(queue);
    sending = true;
    const left: Pending[] = [];
    for (const pending of queue)
      try {
        if (left.length) left.push(pending);
        else await send(pending);
      } catch {
        left.push(pending);
      }
    await writeQueue(left);
    sending = false;
  })().catch(() => {
    sending = false;
  });
}

/** Sends reports left from an earlier run (call once at start). */
export function flushErrorQueue() {
  void readQueue().then((queue) => {
    if (!queue.length) return;
    const [first, ...rest] = queue;
    void writeQueue(rest).then(() =>
      reportAppError(
        Object.assign(new Error(first.message), { stack: first.stack ?? undefined }),
        first.screen,
      ),
    );
  });
}

let installed = false;

/** Catches errors no screen handled (on phones and on the web) and reports them. */
export function installGlobalErrorReporting() {
  if (installed) return;
  installed = true;
  const globalWithErrors = globalThis as unknown as {
    ErrorUtils?: {
      getGlobalHandler: () => (error: unknown, isFatal?: boolean) => void;
      setGlobalHandler: (handler: (error: unknown, isFatal?: boolean) => void) => void;
    };
    addEventListener?: (type: string, listener: (event: unknown) => void) => void;
  };
  const errorUtils = globalWithErrors.ErrorUtils;
  if (errorUtils) {
    const previous = errorUtils.getGlobalHandler();
    errorUtils.setGlobalHandler((error, isFatal) => {
      reportAppError(error);
      previous(error, isFatal);
    });
  }
  if (Platform.OS === "web" && globalWithErrors.addEventListener) {
    globalWithErrors.addEventListener("error", (event) =>
      reportAppError(
        (event as { error?: unknown; message?: string }).error ??
          (event as { message?: string }).message,
      ),
    );
    globalWithErrors.addEventListener("unhandledrejection", (event) =>
      reportAppError((event as { reason?: unknown }).reason),
    );
  }
  flushErrorQueue();
}
