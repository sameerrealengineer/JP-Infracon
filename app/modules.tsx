import { useT } from "@/lib/i18n";
import MaterialIcons from "@expo/vector-icons/MaterialIcons";
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
import { trpc } from "@/lib/trpc";

type Suggestion = {
  source: "ai" | "rules";
  summary: string;
  turnOn: ModuleKey[];
  turnOff: ModuleKey[];
  reasons: { module: ModuleKey; reason: string }[];
};

export default function ModulesScreen() {
  const { t } = useT();
  const colors = useColors();
  const utils = trpc.useUtils();
  const settings = trpc.jp.modules.settings.useQuery();
  const update = trpc.jp.modules.update.useMutation();
  const suggest = trpc.jp.modules.suggest.useMutation();
  const [draft, setDraft] = useState<Record<string, boolean> | null>(null);
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
            eyebrow="Settings"
            title={t("Modules")}
            subtitle="Use only what your company needs. A module turned off is hidden for everyone; its records stay safe and come back when you turn it on."
          />
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
                    Only the owner, a director or an admin can change modules.
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
