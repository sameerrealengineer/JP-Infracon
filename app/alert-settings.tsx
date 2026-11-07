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
  formatDateTime,
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
          <MyCategories />
          <CompanyRules />
          <DeliveryLog />
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

/** Alert categories this person gets; off = muted for them only. */
function MyCategories() {
  const mutes = trpc.jp.notifications.myMutes.useQuery();
  const setMutes = trpc.jp.notifications.setMutes.useMutation();
  const utils = trpc.useUtils();
  const [error, setError] = useState<string | null>(null);
  if (!mutes.data) return null;
  const muted = mutes.data.muted;
  const toggle = async (key: string) => {
    setError(null);
    try {
      await setMutes.mutateAsync({
        muted: muted.includes(key) ? muted.filter((k) => k !== key) : [...muted, key],
      });
      await utils.jp.notifications.myMutes.invalidate();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Not saved.");
    }
  };
  return (
    <>
      <SectionHeader title="Alerts I get" caption="Turn off what you do not need" />
      {mutes.data.categories.map((category) => (
        <Toggle
          key={category.key}
          checked={!muted.includes(category.key)}
          onToggle={() => void toggle(category.key)}
          title={category.title}
          detail={category.detail}
          available={!setMutes.isPending}
        />
      ))}
      {error ? <InlineError message={error} /> : null}
    </>
  );
}

type Rule = {
  category: string;
  role: string;
  push: boolean;
  whatsapp: boolean;
  sms: boolean;
  detail: "full" | "title";
};

const ROLE_LABEL: Record<string, string> = {
  owner: "Owner",
  director: "Director",
  admin: "Admin",
  project_manager: "Project manager",
  supervisor: "Supervisor",
  accounts: "Accounts",
  storekeeper: "Storekeeper",
  auditor: "Auditor",
};

/** Company rules: which roles get which category on which channel (leaders only). */
function CompanyRules() {
  const colors = useColors();
  const rules = trpc.jp.notifications.alertRules.useQuery();
  const save = trpc.jp.notifications.saveAlertRules.useMutation();
  const utils = trpc.useUtils();
  const [draft, setDraft] = useState<Rule[] | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  if (!rules.data?.canManage) return null;
  const current: Rule[] = draft ?? rules.data.rules;
  const patch = (category: string, role: string, change: Partial<Rule>) =>
    setDraft(
      current.map((rule) =>
        rule.category === category && rule.role === role ? { ...rule, ...change } : rule,
      ),
    );
  const submit = async () => {
    setMessage(null);
    try {
      await save.mutateAsync({ rules: current });
      setDraft(null);
      await utils.jp.notifications.alertRules.invalidate();
      setMessage({ ok: true, text: "Company alert rules saved." });
    } catch (cause) {
      setMessage({ ok: false, text: cause instanceof Error ? cause.message : "Not saved." });
    }
  };
  return (
    <>
      <SectionHeader
        title="Company alert rules"
        caption="Who gets what, on which channel. People can still turn channels off for themselves."
      />
      {rules.data.categories.map((category) => {
        const rows = current.filter((rule) => rule.category === category.key);
        const offCount = rows.filter((r) => !r.push || !r.whatsapp || !r.sms).length;
        const expanded = open === category.key;
        return (
          <Card key={category.key} style={{ marginBottom: 10 }}>
            <Pressable
              accessibilityRole="button"
              accessibilityState={{ expanded }}
              onPress={() => setOpen(expanded ? null : category.key)}
              style={styles.channelRow}
            >
              <View style={{ flex: 1 }}>
                <Text style={[styles.toggleTitle, { color: colors.foreground }]}>
                  {category.title}
                </Text>
                <Text style={[styles.meta, { color: colors.muted }]}>
                  {offCount ? `${offCount} roles limited` : "All roles, all channels"}
                </Text>
              </View>
              <MaterialIcons
                name={expanded ? "expand-less" : "expand-more"}
                size={24}
                color={colors.muted}
              />
            </Pressable>
            {expanded
              ? rows.map((rule) => (
                  <View key={rule.role} style={[styles.ruleRow, { borderTopColor: colors.border }]}>
                    <Text style={[styles.ruleRole, { color: colors.foreground }]}>
                      {ROLE_LABEL[rule.role] ?? rule.role}
                    </Text>
                    <View style={styles.ruleChips}>
                      {(["push", "whatsapp", "sms"] as const).map((channel) => (
                        <MiniChip
                          key={channel}
                          label={channel === "push" ? "App" : channel === "whatsapp" ? "WA" : "SMS"}
                          on={rule[channel]}
                          onPress={() =>
                            patch(rule.category, rule.role, { [channel]: !rule[channel] })
                          }
                          a11y={`${category.title}, ${ROLE_LABEL[rule.role]}: ${channel}`}
                        />
                      ))}
                      <MiniChip
                        label="Details"
                        on={rule.detail === "full"}
                        onPress={() =>
                          patch(rule.category, rule.role, {
                            detail: rule.detail === "full" ? "title" : "full",
                          })
                        }
                        a11y={`${category.title}, ${ROLE_LABEL[rule.role]}: details`}
                      />
                    </View>
                  </View>
                ))
              : null}
          </Card>
        );
      })}
      {draft ? (
        <PrimaryButton
          label="Save company rules"
          icon="save"
          loading={save.isPending}
          onPress={() => void submit()}
        />
      ) : null}
      {message ? (
        message.ok ? (
          <Text style={[styles.meta, { color: colors.success }]}>{message.text}</Text>
        ) : (
          <InlineError message={message.text} />
        )
      ) : null}
      <Text style={[styles.meta, { color: colors.muted }]}>
        SMS is only used for urgent alerts. &ldquo;Details&rdquo; off sends just the title on
        WhatsApp and SMS, with no photo or document.
      </Text>
    </>
  );
}

function MiniChip({
  label,
  on,
  onPress,
  a11y,
}: {
  label: string;
  on: boolean;
  onPress: () => void;
  a11y: string;
}) {
  const colors = useColors();
  return (
    <Pressable
      accessibilityRole="switch"
      accessibilityState={{ checked: on }}
      accessibilityLabel={a11y}
      onPress={onPress}
      hitSlop={4}
      style={[
        styles.mini,
        {
          backgroundColor: on ? colors.primary : colors.surface,
          borderColor: on ? colors.primary : colors.border,
        },
      ]}
    >
      <Text style={[styles.miniText, { color: on ? colors.background : colors.muted }]}>
        {label}
      </Text>
    </Pressable>
  );
}

/** What the company's alerts did recently: sent, failed or skipped (leaders only). */
function DeliveryLog() {
  const colors = useColors();
  const log = trpc.jp.notifications.recentDeliveries.useQuery();
  const rows = log.data?.rows ?? [];
  if (!rows.length) return null;
  return (
    <>
      <SectionHeader title="Recent deliveries" caption="Last 60 alert attempts" />
      <Card>
        {rows.slice(0, 20).map((row) => (
          <View key={row.id} style={[styles.logRow, { borderTopColor: colors.border }]}>
            <StatusPill
              label={row.status}
              tone={
                row.status === "Sent" ? "success" : row.status === "Failed" ? "error" : "warning"
              }
              compact
            />
            <View style={{ flex: 1 }}>
              <Text style={[styles.toggleTitle, { color: colors.foreground, fontSize: 13 }]}>
                {row.userName ?? "—"} · {row.channel}
              </Text>
              <Text style={[styles.meta, { color: colors.muted }]}>
                {row.eventKind} · {row.detail} · {formatDateTime(row.createdAt)}
              </Text>
            </View>
          </View>
        ))}
      </Card>
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
  ruleRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingVertical: 8,
    borderTopWidth: StyleSheet.hairlineWidth,
    marginTop: 4,
  },
  ruleRole: { width: 110, fontSize: 13, fontWeight: "700" },
  ruleChips: {
    flex: 1,
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 6,
    justifyContent: "flex-end",
  },
  mini: { borderWidth: 1, borderRadius: 10, paddingHorizontal: 9, paddingVertical: 5 },
  miniText: { fontSize: 11, fontWeight: "800" },
  logRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingVertical: 8,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  note: { fontSize: 11, lineHeight: 16, marginTop: 14, textAlign: "center" },
});
