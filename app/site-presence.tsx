import { useLocalSearchParams } from "expo-router";
import { useState } from "react";
import { Pressable, RefreshControl, ScrollView, Text, View } from "react-native";
import { AuthGate } from "@/components/jp/auth-gate";
import { commercialStyles as styles } from "@/components/jp/commercial-ui";
import {
  AppHeader,
  Card,
  ChipGroup,
  Field,
  InlineError,
  LoadingBlock,
  PrimaryButton,
  Screen,
  SectionHeader,
  StatusPill,
  formatDateTime,
} from "@/components/jp/ui";
import { useColors } from "@/hooks/use-colors";
import { useT } from "@/lib/i18n";
import { trpc } from "@/lib/trpc";

const DAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

/**
 * GPS alerts for a site: working hours and days (India time), which events alert, who is told
 * on WhatsApp/push/SMS, and which team members have site tracking switched on.
 */
export default function SitePresenceScreen() {
  const { t } = useT();
  const colors = useColors();
  const params = useLocalSearchParams<{ siteId?: string }>();
  const siteId = typeof params.siteId === "string" ? params.siteId : "";
  const utils = trpc.useUtils();
  const query = trpc.jp.presence.siteSettings.useQuery({ siteId }, { enabled: Boolean(siteId) });
  const save = trpc.jp.presence.saveSiteSettings.useMutation();
  const data = query.data;
  const [draft, setDraft] = useState<{
    workStart: string;
    workEnd: string;
    workDays: number[];
    alertOnLeave: boolean;
    alertOnArrive: boolean;
    recipients: number[];
  } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const form =
    draft ??
    (data
      ? {
          ...data.settings,
          recipients: data.recipients ?? [],
        }
      : null);
  const update = (patch: Partial<NonNullable<typeof form>>) => {
    if (form) setDraft({ ...form, ...patch });
  };
  const submit = async () => {
    if (!form) return;
    setError(null);
    setMessage(null);
    try {
      await save.mutateAsync({
        siteId,
        workStart: form.workStart,
        workEnd: form.workEnd,
        workDays: form.workDays,
        alertOnLeave: form.alertOnLeave,
        alertOnArrive: form.alertOnArrive,
        recipientUserIds: form.recipients,
      });
      setDraft(null);
      setMessage(t("Saved."));
      await utils.jp.presence.siteSettings.invalidate({ siteId });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Not saved.");
    }
  };

  return (
    <AuthGate>
      <Screen>
        <ScrollView
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={styles.content}
          refreshControl={
            <RefreshControl
              refreshing={query.isRefetching}
              onRefresh={() => void query.refetch()}
              tintColor={colors.primary}
            />
          }
        >
          <AppHeader
            eyebrow={t("GPS alerts")}
            title={data?.siteName ?? t("Site")}
            subtitle={t(
              "When someone leaves the site during working hours, the chosen people get a WhatsApp/app alert. Only arrived/left is shared, never a live location trail.",
            )}
          />
          {query.isLoading ? (
            <LoadingBlock label="Loading…" />
          ) : !data || !form ? (
            <InlineError
              message={query.error?.message ?? "Could not load."}
              onRetry={() => void query.refetch()}
            />
          ) : (
            <>
              {!data.hasBoundary ? (
                <Text style={[styles.meta, { color: colors.warning }]}>
                  {t("This site has no boundary yet. Set it on the site page first.")}
                </Text>
              ) : null}
              <Card>
                <View style={[styles.row, { gap: 10 }]}>
                  <View style={{ flex: 1 }}>
                    <Field
                      label={t("Work starts")}
                      value={form.workStart}
                      onChangeText={(value) => update({ workStart: value })}
                      hint="08:00"
                    />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Field
                      label={t("Work ends")}
                      value={form.workEnd}
                      onChangeText={(value) => update({ workEnd: value })}
                      hint="18:00"
                    />
                  </View>
                </View>
                <Text style={[styles.meta, { color: colors.foreground, fontWeight: "700" }]}>
                  {t("Working days")}
                </Text>
                <View style={[styles.row, { flexWrap: "wrap" }]}>
                  {DAY_NAMES.map((name, day) => {
                    const on = form.workDays.includes(day);
                    return (
                      <Pressable
                        key={name}
                        accessibilityRole="checkbox"
                        accessibilityState={{ checked: on }}
                        accessibilityLabel={name}
                        onPress={() =>
                          update({
                            workDays: on
                              ? form.workDays.filter((d) => d !== day)
                              : [...form.workDays, day].sort(),
                          })
                        }
                        style={{
                          paddingHorizontal: 12,
                          paddingVertical: 8,
                          borderRadius: 18,
                          borderWidth: 1,
                          borderColor: on ? colors.primary : colors.border,
                          backgroundColor: on ? colors.primary : colors.surface,
                        }}
                      >
                        <Text
                          style={{
                            color: on ? colors.background : colors.foreground,
                            fontWeight: "700",
                          }}
                        >
                          {t(name)}
                        </Text>
                      </Pressable>
                    );
                  })}
                </View>
                <ChipGroup
                  label={t("Alert when someone leaves the site")}
                  options={["Yes", "No"] as const}
                  value={form.alertOnLeave ? "Yes" : "No"}
                  onChange={(value) => update({ alertOnLeave: value === "Yes" })}
                  format={(v) => t(v)}
                />
                <ChipGroup
                  label={t("Alert when someone arrives")}
                  options={["Yes", "No"] as const}
                  value={form.alertOnArrive ? "Yes" : "No"}
                  onChange={(value) => update({ alertOnArrive: value === "Yes" })}
                  format={(v) => t(v)}
                />
              </Card>
              <SectionHeader
                title={t("Who is told")}
                caption={t(
                  "Nobody chosen: owner, directors, admins and the site's manager and supervisors.",
                )}
              />
              <Card>
                {data.choices.map((person) => {
                  const on = form.recipients.includes(person.userId);
                  return (
                    <Pressable
                      key={person.userId}
                      accessibilityRole="checkbox"
                      accessibilityState={{ checked: on }}
                      accessibilityLabel={`Tell ${person.name ?? "person"}`}
                      onPress={() =>
                        update({
                          recipients: on
                            ? form.recipients.filter((id) => id !== person.userId)
                            : [...form.recipients, person.userId],
                        })
                      }
                      style={[styles.row, { paddingVertical: 6 }]}
                    >
                      <Text style={{ fontSize: 18, color: on ? colors.primary : colors.muted }}>
                        {on ? "☑" : "☐"}
                      </Text>
                      <Text
                        style={[styles.meta, { color: colors.foreground, flex: 1, marginTop: 0 }]}
                      >
                        {person.name ?? "—"} · {t(person.role)}
                      </Text>
                    </Pressable>
                  );
                })}
                <Text style={[styles.meta, { color: colors.muted }]}>
                  {t(
                    "WhatsApp goes only to people who saved a mobile number and turned WhatsApp alerts on.",
                  )}
                </Text>
              </Card>
              {message ? (
                <Text style={[styles.meta, { color: colors.success }]}>{message}</Text>
              ) : null}
              {error ? <InlineError message={error} /> : null}
              <PrimaryButton
                icon="save"
                label={t("Save GPS alert settings")}
                loading={save.isPending}
                onPress={() => void submit()}
              />
              <SectionHeader
                title={t("Site team tracking")}
                caption={t(
                  "Each person switches it on in their app (Alert settings). It cannot be forced on a phone.",
                )}
              />
              {data.team.map((person) => (
                <Card key={person.userId} accent={person.tracking ? "success" : "warning"}>
                  <View style={styles.row}>
                    <Text style={[styles.title, { color: colors.foreground, flex: 1 }]}>
                      {person.name ?? "—"}
                    </Text>
                    <StatusPill
                      label={
                        person.tracking === null
                          ? t("Not reported")
                          : person.tracking
                            ? t("Tracking on")
                            : t("Tracking off")
                      }
                      tone={person.tracking ? "success" : "warning"}
                      compact
                    />
                  </View>
                  <Text style={[styles.meta, { color: colors.muted }]}>
                    {t(person.role)}
                    {person.lastEvent
                      ? ` · ${person.lastEvent.eventType === "Arrived" ? t("arrived") : t("left")} ${formatDateTime(person.lastEvent.occurredAt)}`
                      : ""}
                  </Text>
                </Card>
              ))}
            </>
          )}
        </ScrollView>
      </Screen>
    </AuthGate>
  );
}
