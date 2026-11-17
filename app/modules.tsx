import { useT } from "@/lib/i18n";
import MaterialIcons from "@expo/vector-icons/MaterialIcons";
import { useLocalSearchParams } from "expo-router";
import { useState } from "react";
import { RefreshControl, ScrollView, StyleSheet, Switch, Text, View } from "react-native";

import { AuthGate } from "@/components/jp/auth-gate";
import {
  AppHeader,
  Card,
  EmptyState,
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
import type { ModuleKey } from "@/lib/jp/modules";
import { JOURNEY } from "@/lib/jp/journey";
import { trpc } from "@/lib/trpc";

type Suggestion = {
  source: "ai" | "rules";
  summary: string;
  turnOn: ModuleKey[];
  turnOff: ModuleKey[];
  reasons: { module: ModuleKey; reason: string }[];
};

/** The journey step a module belongs to (null for extras). */
function stepOf(key: string) {
  return JOURNEY.find((step) => (step.modules as readonly string[]).includes(key))?.level ?? null;
}

export default function ModulesScreen() {
  const { t } = useT();
  const colors = useColors();
  const utils = trpc.useUtils();
  const settings = trpc.jp.modules.settings.useQuery();
  const journey = trpc.jp.journey.status.useQuery(undefined, { retry: false });
  const setMode = trpc.jp.journey.setMode.useMutation();
  const update = trpc.jp.modules.update.useMutation();
  const suggest = trpc.jp.modules.suggest.useMutation();
  // The assistant can propose a change (?turnOn=crm&turnOff=issues); it shows as unsaved
  // switches here and the leader saves it themselves.
  const params = useLocalSearchParams<{ turnOn?: string; turnOff?: string }>();
  const [draft, setDraft] = useState<Record<string, boolean> | null>(() => {
    const on = typeof params.turnOn === "string" ? params.turnOn.split(",").filter(Boolean) : [];
    const off = typeof params.turnOff === "string" ? params.turnOff.split(",").filter(Boolean) : [];
    if (!on.length && !off.length) return null;
    return Object.fromEntries([
      ...off.map((key) => [key, false] as const),
      ...on.map((key) => [key, true] as const),
    ]);
  });
  const [about, setAbout] = useState("");
  const [suggestion, setSuggestion] = useState<Suggestion | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const data = settings.data;
  const enabled = (key: string) =>
    draft?.[key] ?? data?.modules.find((row) => row.key === key)?.enabled ?? true;
  const changed =
    !!draft &&
    !!data &&
    data.modules.some((row) => draft[row.key] !== undefined && draft[row.key] !== row.enabled);

  const save = async () => {
    if (!data) return;
    setError(null);
    try {
      await update.mutateAsync({
        disabled: data.modules.filter((row) => !enabled(row.key)).map((row) => row.key),
        reason: suggestion
          ? `Following ${suggestion.source === "ai" ? "AI" : "usage"} suggestion`
          : null,
      });
      setDraft(null);
      setMessage("Saved. Everyone sees the change the next time their app refreshes.");
      await Promise.all([settings.refetch(), utils.jp.workspace.myCapabilities.invalidate()]);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Not saved.");
    }
  };

  const ask = async () => {
    setError(null);
    setMessage(null);
    try {
      setSuggestion(await suggest.mutateAsync({ about }));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "No suggestion right now.");
    }
  };

  const applySuggestion = () => {
    if (!suggestion) return;
    const next: Record<string, boolean> = { ...(draft ?? {}) };
    for (const key of suggestion.turnOn) next[key] = true;
    for (const key of suggestion.turnOff) next[key] = false;
    setDraft(next);
    setMessage("Suggestion applied below. Check it, then tap Save.");
  };

  const title = (key: string) => data?.modules.find((row) => row.key === key)?.title ?? key;

  return (
    <AuthGate>
      <Screen>
        <ScrollView
          showsVerticalScrollIndicator={false}
          contentContainerStyle={styles.content}
          keyboardShouldPersistTaps="handled"
          refreshControl={
            <RefreshControl
              refreshing={settings.isRefetching}
              onRefresh={() => void settings.refetch()}
              tintColor={colors.primary}
            />
          }
        >
          <AppHeader
            manual="modules"
            eyebrow="Settings"
            title={t("Modules")}
            subtitle="Use only what your company needs. A module turned off is hidden for everyone; its records stay safe and come back when you turn it on."
          />
          {journey.data?.canManage ? (
            <Card>
              <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
                <View style={{ flex: 1 }}>
                  <Text style={{ color: colors.foreground, fontSize: 15, fontWeight: "800" }}>
                    {t("Step-by-step mode")}
                  </Text>
                  <Text style={{ color: colors.muted, fontSize: 12, lineHeight: 18 }}>
                    {journey.data.mode === "guided"
                      ? t(
                          "On: modules open one step at a time as your team uses the app (step {level} of {total}).",
                          {
                            level: journey.data.level,
                            total: journey.data.total,
                          },
                        )
                      : t("Off: every module switched on below is open now.")}
                  </Text>
                </View>
                <Switch
                  accessibilityLabel={t("Step-by-step mode")}
                  value={journey.data.mode === "guided"}
                  disabled={setMode.isPending}
                  onValueChange={(on) =>
                    void setMode
                      .mutateAsync({ mode: on ? "guided" : "all" })
                      .then(() => utils.invalidate())
                  }
                />
              </View>
            </Card>
          ) : null}
          {settings.error ? (
            <InlineError message={settings.error.message} onRetry={() => void settings.refetch()} />
          ) : null}
          {settings.isLoading ? <LoadingBlock label="Loading modules…" /> : null}
          {data && data.modules.length === 0 ? (
            <EmptyState
              icon="business"
              title="Set up your company first"
              detail="Modules belong to a company."
            />
          ) : null}
          {data && data.modules.length > 0 ? (
            <>
              {data.canManage ? (
                <Card>
                  <View style={styles.aiHead}>
                    <MaterialIcons name="auto-awesome" size={20} color={colors.accent} />
                    <Text style={[styles.aiTitle, { color: colors.foreground }]}>
                      {t("Ask AI which modules you need")}
                    </Text>
                  </View>
                  <Field
                    label="Tell about your work (optional)"
                    value={about}
                    onChangeText={setAbout}
                    multiline
                    maxLength={1500}
                    placeholder="e.g. Government building works, 2 sites, 40 labourers, we buy cement and steel ourselves, accounts done by CA"
                  />
                  <SecondaryButton
                    icon="psychology"
                    label={suggest.isPending ? "Thinking…" : t("Suggest modules")}
                    disabled={suggest.isPending}
                    onPress={() => void ask()}
                  />
                  {suggestion ? (
                    <View style={styles.suggestion}>
                      <Text style={[styles.body, { color: colors.foreground }]}>
                        {suggestion.summary ||
                          (suggestion.turnOn.length + suggestion.turnOff.length === 0
                            ? "No change needed."
                            : "Suggested changes:")}
                      </Text>
                      {suggestion.turnOn.map((key) => (
                        <Text key={`on-${key}`} style={[styles.body, { color: colors.success }]}>
                          ＋ Turn on {title(key)}
                        </Text>
                      ))}
                      {suggestion.turnOff.map((key) => (
                        <Text key={`off-${key}`} style={[styles.body, { color: colors.error }]}>
                          － Turn off {title(key)}
                        </Text>
                      ))}
                      {suggestion.reasons.map((row) => (
                        <Text
                          key={`why-${row.module}`}
                          style={[styles.meta, { color: colors.muted }]}
                        >
                          {title(row.module)}: {row.reason}
                        </Text>
                      ))}
                      <Text style={[styles.meta, { color: colors.muted }]}>
                        {suggestion.source === "ai"
                          ? "Suggested by AI from your words and the last 30 days of use."
                          : "Suggested from the last 30 days of use (AI is not set up)."}
                      </Text>
                      {suggestion.turnOn.length + suggestion.turnOff.length > 0 ? (
                        <SecondaryButton
                          icon="done-all"
                          label={t("Use this suggestion")}
                          onPress={applySuggestion}
                        />
                      ) : null}
                    </View>
                  ) : null}
                </Card>
              ) : (
                <Card>
                  <Text style={[styles.body, { color: colors.muted }]}>
                    {t("Only the owner, a director or an admin can change modules.")}
                  </Text>
                </Card>
              )}

              <SectionHeader
                title={data.companyName ?? "Company"}
                caption="Always on: sites, people and audit trail"
              />
              {data.modules.map((row) => {
                const on = enabled(row.key);
                return (
                  <Card key={row.key}>
                    <View style={styles.row}>
                      <View style={styles.flex}>
                        <Text style={[styles.title, { color: colors.foreground }]}>
                          {row.title}
                        </Text>
                        <Text style={[styles.meta, { color: colors.muted }]}>{row.detail}</Text>
                        {journey.data?.mode === "guided" && !row.enabled && stepOf(row.key) ? (
                          <Text style={[styles.meta, { color: colors.accent }]}>
                            {stepOf(row.key)! > journey.data.level
                              ? t("🔒 Opens at step {level}; switch on to open now", {
                                  level: stepOf(row.key)!,
                                })
                              : ""}
                          </Text>
                        ) : null}
                        <Text style={[styles.meta, { color: colors.muted }]}>
                          {row.actionsLast30Days
                            ? `${row.actionsLast30Days} actions in the last 30 days`
                            : "Not used in the last 30 days"}
                        </Text>
                      </View>
                      <Switch
                        value={on}
                        disabled={!data.canManage}
                        onValueChange={(value) =>
                          setDraft((prev) => ({ ...(prev ?? {}), [row.key]: value }))
                        }
                        accessibilityLabel={`${row.title} ${on ? "on" : "off"}`}
                        trackColor={{ true: colors.success, false: colors.border }}
                      />
                    </View>
                    {draft?.[row.key] !== undefined && draft[row.key] !== row.enabled ? (
                      <StatusPill
                        label={on ? "Will turn on" : "Will turn off"}
                        tone="warning"
                        compact
                      />
                    ) : null}
                  </Card>
                );
              })}
              {message ? (
                <Text style={[styles.body, { color: colors.success }]}>{message}</Text>
              ) : null}
              {error ? <InlineError message={error} /> : null}
              {data.canManage ? (
                <PrimaryButton
                  icon="save"
                  label={update.isPending ? "Saving…" : t("Save modules")}
                  disabled={!changed || update.isPending}
                  onPress={() => void save()}
                />
              ) : null}
            </>
          ) : null}
        </ScrollView>
      </Screen>
    </AuthGate>
  );
}

const styles = StyleSheet.create({
  content: { paddingBottom: 120, gap: 12 },
  aiHead: { flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 6 },
  aiTitle: { fontSize: 15, fontWeight: "800", flex: 1 },
  suggestion: { gap: 6, marginTop: 10 },
  row: { flexDirection: "row", alignItems: "center", gap: 12 },
  flex: { flex: 1 },
  title: { fontSize: 15, fontWeight: "800" },
  body: { fontSize: 14, lineHeight: 20 },
  meta: { fontSize: 12, lineHeight: 17, marginTop: 2 },
});
