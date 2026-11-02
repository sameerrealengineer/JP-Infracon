import MaterialIcons from "@expo/vector-icons/MaterialIcons";
import { useEffect, useState } from "react";
import { Platform, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { AuthGate } from "@/components/jp/auth-gate";
import {
  AppHeader,
  Card,
  Field,
  InlineError,
  LoadingBlock,
  PrimaryButton,
  Screen,
  SecondaryButton,
  SectionHeader,
  StatusPill,
} from "@/components/jp/ui";
import { useColors } from "@/hooks/use-colors";
import { trpc } from "@/lib/trpc";
import { siteAlertsEnabled, startSiteAlerts, stopSiteAlerts } from "@/lib/geofence-task";

type Draft = { phone: string; whatsappOptIn: boolean; smsOptIn: boolean; pushOptIn: boolean };

export default function AlertSettingsScreen() {
  const prefs = trpc.jp.notifications.preferences.useQuery();
  return (
    <AuthGate>
      <Screen>
        <ScrollView
          showsVerticalScrollIndicator={false}
          contentContainerStyle={{ paddingBottom: 40 }}
          keyboardShouldPersistTaps="handled"
        >
          <AppHeader
            eyebrow="Alerts"
            title="How we reach you"
            subtitle="Critical safety issues, stop-work flags, assignments and delegated authority — by app notification, WhatsApp or SMS."
          />
          {prefs.error ? (
            <InlineError message={prefs.error.message} onRetry={() => void prefs.refetch()} />
          ) : null}
          {prefs.isLoading ? <LoadingBlock /> : null}
          {prefs.data ? (
            <Form key={prefs.dataUpdatedAt} initial={prefs.data} channels={prefs.data.channels} />
          ) : null}
          <SiteArrivalAlerts />
        </ScrollView>
      </Screen>
    </AuthGate>
  );
}

function Form({
  initial,
  channels,
}: {
  initial: Draft;
  channels: { whatsapp: string | null; sms: string | null; push: string };
}) {
  const colors = useColors();
  const utils = trpc.useUtils();
  const update = trpc.jp.notifications.updatePreferences.useMutation();
  const test = trpc.jp.notifications.sendTest.useMutation();
  const [draft, setDraft] = useState<Draft>(initial);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);

  const save = async () => {
    setMessage(null);
    try {
      await update.mutateAsync(draft);
      await utils.jp.notifications.preferences.invalidate();
      setMessage({ ok: true, text: "Saved." });
    } catch (cause) {
      setMessage({ ok: false, text: cause instanceof Error ? cause.message : "Not saved." });
    }
  };
  const runTest = async () => {
    setMessage(null);
    try {
      const result = await test.mutateAsync();
      setMessage({
        ok: true,
        text: result.results.length
          ? result.results.map((row) => `${row.channel}: ${row.status}`).join(" · ")
          : "No channel is enabled for you yet.",
      });
    } catch (cause) {
      setMessage({ ok: false, text: cause instanceof Error ? cause.message : "Test failed." });
    }
  };

  return (
    <>
      <Field
        label="Mobile number"
        value={draft.phone}
        onChangeText={(phone) => setDraft((current) => ({ ...current, phone }))}
        keyboardType="phone-pad"
        placeholder="98765 43210"
        hint="Used only for the alerts you switch on below."
      />
      <Toggle
        checked={draft.pushOptIn}
        onToggle={() => setDraft((current) => ({ ...current, pushOptIn: !current.pushOptIn }))}
        title="App notifications"
        detail="Free. Works once the app is installed from the APK."
        available
      />
      <Toggle
        checked={draft.whatsappOptIn}
        onToggle={() =>
          setDraft((current) => ({ ...current, whatsappOptIn: !current.whatsappOptIn }))
        }
        title="WhatsApp"
        detail={
          channels.whatsapp
            ? `Sent through ${channels.whatsapp === "cloud" ? "WhatsApp Business Cloud API" : channels.whatsapp === "waha" ? "WAHA (open source)" : "Evolution API (open source)"}.`
            : "Not set up by your administrator yet."
        }
        available={Boolean(channels.whatsapp)}
      />
      <Toggle
        checked={draft.smsOptIn}
        onToggle={() => setDraft((current) => ({ ...current, smsOptIn: !current.smsOptIn }))}
        title="SMS (urgent only)"
        detail={
          channels.sms
            ? `Sent through ${channels.sms === "textbee" ? "textbee" : "SMS Gateway for Android"} (open source) for critical and stop-work alerts.`
            : "Not set up by your administrator yet."
        }
        available={Boolean(channels.sms)}
      />
      {message ? (
        message.ok ? (
          <Card accent="success" style={{ marginBottom: 12 }}>
            <Text style={{ color: colors.foreground, fontWeight: "700" }}>{message.text}</Text>
          </Card>
        ) : (
          <InlineError message={message.text} title="Not done" />
        )
      ) : null}
      <PrimaryButton
        icon="save"
        label="Save"
        loading={update.isPending}
        onPress={() => void save()}
      />
      <View style={{ height: 10 }} />
      <SecondaryButton
        icon="campaign"
        label={test.isPending ? "Sending…" : "Send me a test alert"}
        onPress={() => void runTest()}
      />

      <SectionHeader title="Channels on this server" />
      <Card>
        <View style={{ flex: 1, gap: 8 }}>
          <View style={styles.channelRow}>
            <Text style={[styles.meta, { color: colors.foreground, flex: 1 }]}>
              App notifications (Expo push)
            </Text>
            <StatusPill label="Ready" tone="success" compact />
          </View>
          <View style={styles.channelRow}>
            <Text style={[styles.meta, { color: colors.foreground, flex: 1 }]}>WhatsApp</Text>
            <StatusPill
              label={channels.whatsapp ?? "Not set up"}
              tone={channels.whatsapp ? "success" : "warning"}
              compact
            />
          </View>
          <View style={styles.channelRow}>
            <Text style={[styles.meta, { color: colors.foreground, flex: 1 }]}>SMS</Text>
            <StatusPill
              label={channels.sms ?? "Not set up"}
              tone={channels.sms ? "success" : "warning"}
              compact
            />
          </View>
        </View>
      </Card>
      <Text style={[styles.note, { color: colors.muted }]}>
        Alerts never include money amounts or ID numbers. Unofficial WhatsApp gateways (WAHA,
        Evolution API) can get a number blocked by WhatsApp; use a separate business number.
      </Text>
    </>
  );
}

function SiteArrivalAlerts() {
  const colors = useColors();
  const fences = trpc.jp.presence.myFences.useQuery();
  const [enabled, setEnabled] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let active = true;
    void siteAlertsEnabled().then((value) => {
      if (active) setEnabled(value);
    });
    return () => {
      active = false;
    };
  }, []);
  if (Platform.OS === "web") return null;
  const toggle = async () => {
    setBusy(true);
    setError(null);
    try {
      if (enabled) {
        await stopSiteAlerts();
        setEnabled(false);
      } else {
        await startSiteAlerts(fences.data ?? []);
        setEnabled(true);
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not change site alerts.");
    } finally {
      setBusy(false);
    }
  };
  return (
    <>
      <SectionHeader
        title="Site arrival & departure"
        caption="Optional · uses this phone's location"
      />
      <Toggle
        checked={Boolean(enabled)}
        onToggle={() => void toggle()}
        title={busy ? "Updating…" : "Tell my team when I reach or leave a site"}
        detail={`${fences.data?.length ?? 0} of your sites have a boundary. Only "arrived/left site" is shared — never a live location trail. Turn off any time.`}
        available={!busy}
      />
      {error ? <InlineError message={error} title="Site alerts" /> : null}
      {enabled ? (
        <Text style={[styles.meta, { color: colors.success }]}>
          On — your phone watches your site boundaries.
        </Text>
      ) : null}
    </>
  );
}

function Toggle({
  checked,
  onToggle,
  title,
  detail,
  available,
}: {
  checked: boolean;
  onToggle: () => void;
  title: string;
  detail: string;
  available: boolean;
}) {
  const colors = useColors();
  const on = checked && available;
  return (
    <Pressable
      accessibilityRole="switch"
      accessibilityState={{ checked: on, disabled: !available }}
      accessibilityLabel={title}
      disabled={!available}
      onPress={onToggle}
      style={[
        styles.toggle,
        { borderColor: on ? colors.primary : colors.border, opacity: available ? 1 : 0.55 },
      ]}
    >
      <MaterialIcons
        name={on ? "toggle-on" : "toggle-off"}
        size={34}
        color={on ? colors.success : colors.muted}
      />
      <View style={{ flex: 1 }}>
        <Text style={[styles.toggleTitle, { color: colors.foreground }]}>{title}</Text>
        <Text style={[styles.meta, { color: colors.muted }]}>{detail}</Text>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  toggle: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    borderWidth: 1.5,
    borderRadius: 16,
    padding: 12,
    marginBottom: 10,
  },
  toggleTitle: { fontSize: 14, fontWeight: "800" },
  meta: { fontSize: 12, lineHeight: 17, marginTop: 2 },
  channelRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  note: { fontSize: 11, lineHeight: 16, marginTop: 14, textAlign: "center" },
});
