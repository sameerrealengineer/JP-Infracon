import MaterialIcons from "@expo/vector-icons/MaterialIcons";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { useEffect, useState, type ComponentProps } from "react";
import { Platform, Pressable, StyleSheet, Text, View } from "react-native";
import { Card, PrimaryButton, SecondaryButton, StatusPill, type Tone } from "@/components/jp/ui";
import { useColors } from "@/hooks/use-colors";
import {
  appPlatform,
  checkPermission,
  openAppSettings,
  requestPermission,
} from "@/lib/device-permissions";
import { useT } from "@/lib/i18n";
import {
  PERMISSIONS_ASKED_KEY,
  PERMISSION_TEXT,
  blockedPermissions,
  permissionList,
  stillToAsk,
  type PermissionKey,
  type PermissionStatus,
} from "@/lib/jp/permission-plan";
import { trpc } from "@/lib/trpc";
import { subscribeWebPush } from "@/lib/web-push-client";

type IconName = ComponentProps<typeof MaterialIcons>["name"];

const ICONS: Record<PermissionKey, IconName> = {
  notifications: "notifications-active",
  microphone: "mic",
  camera: "photo-camera",
  photos: "perm-media",
  location: "location-on",
  backgroundLocation: "share-location",
};

const STATUS: Record<PermissionStatus, { label: string; tone: Tone }> = {
  granted: { label: "Allowed", tone: "success" },
  ask: { label: "Not yet", tone: "warning" },
  blocked: { label: "Blocked", tone: "error" },
  unavailable: { label: "Not on this device", tone: "info" },
  needsHomeScreen: { label: "Needs home screen", tone: "info" },
};

/** Marks the permission screen as done on this device, so it is not shown again at sign-in. */
export async function markPermissionsAsked() {
  try {
    await AsyncStorage.setItem(PERMISSIONS_ASKED_KEY, new Date().toISOString());
  } catch {
    // The screen can come back once; nothing is lost.
  }
}

/**
 * Asks for every permission the app needs (notifications, microphone, camera, photos and files,
 * location, and on Android location "all the time") in one go, with one "Allow all" button, and
 * shows each one's state. Blocked ones get a button to the phone settings.
 */
export function PermissionsSetup({ onContinue }: { onContinue?: () => void }) {
  const colors = useColors();
  const { t } = useT();
  const platform = appPlatform();
  const list = permissionList(platform);
  const webPushKey = trpc.jp.notifications.webPushKey.useQuery(undefined, {
    enabled: platform === "web",
  });
  const registerWebPush = trpc.jp.notifications.registerWebPush.useMutation();
  const [statuses, setStatuses] = useState<Partial<Record<PermissionKey, PermissionStatus>>>({});
  const [busy, setBusy] = useState<PermissionKey | "all" | null>(null);

  const refresh = async () => {
    const entries = await Promise.all(
      list.map(async (key) => [key, await checkPermission(key)] as const),
    );
    setStatuses(Object.fromEntries(entries));
  };

  useEffect(() => {
    let active = true;
    void Promise.all(list.map(async (key) => [key, await checkPermission(key)] as const)).then(
      (entries) => {
        if (active) setStatuses(Object.fromEntries(entries));
      },
    );
    return () => {
      active = false;
    };
    // The list depends only on the platform, which never changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const publicKey = webPushKey.data?.publicKey ?? null;
  const subscribeWebNotifications = publicKey
    ? async () => {
        await registerWebPush.mutateAsync(await subscribeWebPush(publicKey));
      }
    : undefined;

  const ask = async (key: PermissionKey) => {
    const status = await requestPermission(key, { subscribeWebNotifications });
    setStatuses((current) => ({ ...current, [key]: status }));
    return status;
  };

  const askOne = async (key: PermissionKey) => {
    setBusy(key);
    try {
      await ask(key);
    } finally {
      setBusy(null);
    }
  };

  const allowAll = async () => {
    setBusy("all");
    try {
      // One after another: phones and browsers show one prompt at a time.
      for (const key of stillToAsk(list, statuses)) await ask(key);
      await refresh();
    } finally {
      setBusy(null);
    }
  };

  const toAsk = stillToAsk(list, statuses);
  const blocked = blockedPermissions(list, statuses);
  const ready = Object.keys(statuses).length > 0;

  return (
    <View style={{ gap: 12 }}>
      <Text style={[styles.lead, { color: colors.muted }]}>
        {t(
          "Allow these once now, so photos, voice, GPS, files and alerts work every time without asking in the middle of your work.",
        )}
      </Text>
      {list.map((key) => {
        const status = statuses[key];
        const text = PERMISSION_TEXT[key];
        return (
          <Card key={key} accessibilityLabel={t(text.title)}>
            <View style={styles.row}>
              <View style={[styles.icon, { backgroundColor: `${colors.primary}14` }]}>
                <MaterialIcons name={ICONS[key]} size={24} color={colors.primary} />
              </View>
              <View style={{ flex: 1, gap: 4 }}>
                <Text style={[styles.title, { color: colors.foreground }]}>{t(text.title)}</Text>
                <Text style={[styles.why, { color: colors.muted }]}>{t(text.why)}</Text>
                {status ? (
                  <View style={{ flexDirection: "row" }}>
                    <StatusPill
                      label={t(STATUS[status].label)}
                      tone={STATUS[status].tone}
                      compact
                    />
                  </View>
                ) : null}
                {status === "needsHomeScreen" ? (
                  <Text style={[styles.why, { color: colors.muted }]}>
                    {t(
                      "On iPhone: Safari → Share → Add to Home Screen, then open JP Infracon from the home screen and come back here.",
                    )}
                  </Text>
                ) : null}
              </View>
              {status === "ask" ? (
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={`${t("Allow")} ${t(text.title)}`}
                  disabled={busy !== null}
                  onPress={() => void askOne(key)}
                  style={[styles.allow, { backgroundColor: colors.primary }]}
                >
                  <Text style={styles.allowText}>{t("Allow")}</Text>
                </Pressable>
              ) : null}
            </View>
          </Card>
        );
      })}

      {blocked.length ? (
        <Card accent="warning">
          <Text style={[styles.why, { color: colors.foreground }]}>
            {Platform.OS === "web"
              ? t(
                  "Some are blocked in this browser. Tap the lock or ⓘ next to the address, allow them, then reload. iPhone: Settings → Safari (or Settings → JP Infracon) → allow Camera, Microphone and Location.",
                )
              : t(
                  "Some are blocked. Open the app settings → Permissions, allow them, then come back.",
                )}
          </Text>
          {Platform.OS !== "web" ? (
            <View style={{ marginTop: 10 }}>
              <SecondaryButton
                icon="settings"
                label={t("Open app settings")}
                onPress={() => void openAppSettings()}
              />
            </View>
          ) : null}
        </Card>
      ) : null}

      <PrimaryButton
        icon="verified-user"
        label={toAsk.length ? t("Allow all") : t("Check again")}
        loading={busy === "all"}
        disabled={!ready || busy !== null}
        onPress={() => void (toAsk.length ? allowAll() : refresh())}
      />
      {onContinue ? (
        <SecondaryButton
          icon="arrow-forward"
          label={toAsk.length || blocked.length ? t("Continue for now") : t("Continue")}
          disabled={busy !== null}
          onPress={() => {
            void markPermissionsAsked().then(onContinue);
          }}
        />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  lead: { fontSize: 15, lineHeight: 22 },
  row: { flexDirection: "row", alignItems: "center", gap: 12 },
  icon: { width: 46, height: 46, borderRadius: 23, alignItems: "center", justifyContent: "center" },
  title: { fontSize: 16, fontWeight: "800" },
  why: { fontSize: 13, lineHeight: 19 },
  allow: { paddingHorizontal: 16, paddingVertical: 10, borderRadius: 20 },
  allowText: { color: "#fff", fontSize: 14, fontWeight: "800" },
});
